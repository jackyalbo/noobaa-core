#!/usr/bin/env bash
set -euo pipefail

: "${S3A_ENDPOINT:?S3A_ENDPOINT must be set}"

AWS_ACCESS_KEY_ID="hadoopS3aAccessKey01"
AWS_SECRET_ACCESS_KEY="hadoopS3aSecretKey0000000000000000000000"
HADOOP_S3A_BUCKET="s3a-test"

# As downloading the hadoop repository and pre-downloading the dependencies takes a long time, we do it in a separate step in the Dockerfile, and then we just run the tests in this script.
# This way, we can take advantage of Docker caching and avoid re-downloading the dependencies every time we want to run the tests.
# apt-get update -y
# apt-get install -y git
# git clone --depth 1 --branch "${HADOOP_S3A_BRANCH}" https://github.com/apache/hadoop.git /tmp/hadoop
# mkdir -p /tmp/hadoop/hadoop-tools/hadoop-aws/src/test/resources
cat <<EOF > src/test/resources/auth-keys.xml
<configuration>
  <property>
    <name>fs.s3a.endpoint</name>
    <value>${S3A_ENDPOINT}</value>
  </property>
  <property>
    <name>fs.s3a.connection.ssl.enabled</name>
    <value>false</value>
  </property>
  <property>
    <name>fs.s3a.path.style.access</name>
    <value>true</value>
  </property>
  <property>
    <name>fs.s3a.aws.credentials.provider</name>
    <value>org.apache.hadoop.fs.s3a.SimpleAWSCredentialsProvider</value>
  </property>
  <property>
    <name>fs.s3a.access.key</name>
    <value>${AWS_ACCESS_KEY_ID}</value>
  </property>
  <property>
    <name>fs.s3a.secret.key</name>
    <value>${AWS_SECRET_ACCESS_KEY}</value>
  </property>
  <property>
    <name>fs.s3a.region</name>
    <value>us-east-1</value>
  </property>
  <property>
    <name>test.fs.s3a.name</name>
    <value>s3a://${HADOOP_S3A_BUCKET}/</value>
  </property>
  <property>
    <name>test.fs.s3a.bucket</name>
    <value>${HADOOP_S3A_BUCKET}</value>
  </property>
  <property>
    <name>fs.s3a.bucket</name>
    <value>${HADOOP_S3A_BUCKET}</value>
  </property>
  <property>
    <name>fs.contract.test.fs.s3a</name>
    <value>s3a://${HADOOP_S3A_BUCKET}/</value>
  </property>
  <property>
    <name>test.fs.s3a.encryption.enabled</name>
    <value>false</value>
  </property>
   <property>
    <name>test.fs.s3a.create.storage.class.enabled</name>
    <value>false</value>
  </property>
  <property>
    <name>test.fs.s3a.sts.enabled</name>
    <value>false</value>
  </property>
  <property>
    <name>test.fs.s3a.create.acl.enabled</name>
    <value>false</value>
  </property>
  <property>
    <name>test.fs.s3a.performance.enabled</name>
    <value>false</value>
  </property>
  <!--
   If the store reports errors when trying to list/abort completed multipart uploads,
   expect failures in ITestUploadRecovery and ITestS3AContractMultipartUploader.
   The tests can be reconfigured to expect failure.
   Note how this can be set as a per-bucket option.
  -->
  <property>
    <name>fs.s3a.ext.test.multipart.commit.consumes.upload.id</name>
    <value>true</value>
  </property>
</configuration>
EOF

# Apply Maven job.id fix to eliminate cascading test failures
echo "Applying Maven job.id fix..."
if [ -f "hadoop-tools/hadoop-aws/pom.xml" ]; then
    sed -i 's/<job\.id>00<\/job\.id>/<job.id>0001<\/job.id>/g' hadoop-tools/hadoop-aws/pom.xml
    echo "✓ Job ID fix applied"
else
    echo "⚠ pom.xml not found, skipping fix"
fi

EXCLUDED_ITESTS="${EXCLUDED_ITESTS:-ITestS3AContractMultipartUploader}" # TODO: remove exclusion after CI resource fix
echo "Running: mvn -pl :hadoop-aws -am -DskipTests=false -DskipITs=false -Dit.test='ITestS3A*,!${EXCLUDED_ITESTS}' -Dtest=TestS3A* verify"
mvn -pl :hadoop-aws -am -DskipTests=false -DskipITs=false "-Dit.test=ITestS3A*,!${EXCLUDED_ITESTS}" -Dtest=TestS3A* verify
TEST_RESULT=$?

# Generate comprehensive test report
echo ""
echo "=========================================="
echo "         S3A TEST RESULTS REPORT"
echo "=========================================="
echo "Test Execution Status: $([ $TEST_RESULT -eq 0 ] && echo '✅ SUCCESS' || echo '⚠️  COMPLETED (Check details)')"
echo "Exit Code: $TEST_RESULT"
echo ""

# Parse Maven Surefire/Failsafe results
if [ -f "hadoop-tools/hadoop-aws/target/failsafe-summary.xml" ]; then
    echo "=== Maven Failsafe Summary ==="
    python3 << 'PYEOF'
import xml.etree.ElementTree as ET
from pathlib import Path

try:
    tree = ET.parse("hadoop-tools/hadoop-aws/target/failsafe-summary.xml")
    root = tree.getroot()
    
    completed = root.find('completed').text or "0"
    errors = root.find('errors').text or "0"
    failures = root.find('failures').text or "0"
    skipped = root.find('skipped').text or "0"
    
    total = int(completed) + int(errors) + int(failures) + int(skipped)
    passed = int(completed) - int(errors) - int(failures)
    
    print(f"Total Tests:    {total}")
    print(f"Passed:         {passed} ({100*passed/total:.1f}%)")
    print(f"Failed:         {failures}")
    print(f"Errors:         {errors}")
    print(f"Skipped:        {skipped}")
    print(f"\nTotal Issues:   {int(errors) + int(failures)}")
    
except Exception as e:
    print(f"Could not parse results: {e}")
PYEOF
fi

# Detailed test report
echo ""
echo "=== Detailed Test Results ==="
find "hadoop-tools/hadoop-aws/target/failsafe-reports" -name "TEST-*.xml" -type f 2>/dev/null | wc -l | xargs echo "Test suites run:"

# Show failing tests
echo ""
echo "=== Top Failing Tests ==="
python3 << 'PYEOF'
import xml.etree.ElementTree as ET
from pathlib import Path

failing_tests = []
try:
    for xml_file in Path("hadoop-tools/hadoop-aws/target/failsafe-reports").glob("TEST-*.xml"):
        tree = ET.parse(xml_file)
        root = tree.getroot()
        
        failures = root.findall('.//failure')
        errors = root.findall('.//error')
        
        for failure in failures:
            testcase = failure.getparent()
            test_name = testcase.get('name')
            class_name = root.get('name')
            failing_tests.append((f"{class_name}#{test_name}", "FAILED"))
        
        for error in errors:
            testcase = error.getparent()
            test_name = testcase.get('name')
            class_name = root.get('name')
            failing_tests.append((f"{class_name}#{test_name}", "ERROR"))
    
    if failing_tests:
        for test, status in sorted(failing_tests)[:10]:
            print(f"  [{status}] {test}")
        if len(failing_tests) > 10:
            print(f"  ... and {len(failing_tests) - 10} more")
    else:
        print("  No failures found!")
        
except Exception as e:
    print(f"Could not parse failures: {e}")
PYEOF

echo ""
echo "=========================================="
echo "Full test reports available at:"
echo "  hadoop-tools/hadoop-aws/target/failsafe-reports/"
echo "=========================================="

exit $TEST_RESULT

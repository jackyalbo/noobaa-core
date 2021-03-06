#!/bin/sh
#
# Create a new Job in OCP that runs the jbb-validate container once. This
# script will wait for completion of the validation, and uses the result of the
# container to report the status.
#
# Usage:
# - arguments to the script can be "validate" or "deploy"
# - the GIT_REF environment variable is injected in the batch job so that it
#   can use a particular GitHub PR
#

# error out in case a command fails
set -e

CMD="${1}"
GIT_REF=${GIT_REF:-"master"}

get_pod_status() {
	oc get "pod/${1}" --no-headers -o=jsonpath='{.status.phase}'
}

case "${CMD}" in
	"validate")
		;;
	"deploy")
		;;
	*)
		echo "no such command: ${CMD}"
		exit 1
		;;
esac

# make sure there is a valid OCP session
oc version

# the deploy directory where this script is located, contains files we need
cd "$(dirname "${0}")"

# unique ID for the session
SESSION=$(uuidgen)

oc process -f "jjb-${CMD}.yaml" -p=SESSION="${SESSION}" -p=GIT_REF="${GIT_REF}"
oc process -f "jjb-${CMD}.yaml" -p=SESSION="${SESSION}" -p=GIT_REF="${GIT_REF}" | oc create -f -

# loop until pod is available
while true
do
	jjb_pod=$(oc get pods --no-headers -l "jjb/session=${SESSION}" -o=jsonpath='{.items[0].metadata.name}')
	ret=${?}

	# break the loop when the command returned success and jjb_pod is not empty
	[ ${ret} = 0 ] && [ -n "${jjb_pod}" ] && break
	sleep 1
done

# loop until the pod has finished
while true
do
	status=$(get_pod_status "${jjb_pod}")
	ret=${?}

	# TODO: is Running as a status sufficient, did it terminate yet?
	[ ${ret} = 0 ] && { [ "${status}" = "Succeeded" ] || [ "${status}" = "Failed" ]; } && break
	sleep 0.5
done

# show the log of the finished pod
oc logs "${jjb_pod}"

# delete the job, so a next run can create it again
oc process -f "jjb-${CMD}.yaml" -p=SESSION="${SESSION}" | oc delete --wait -f -
# depending on the OpenShift version, the pod gets deleted automatically
oc delete --ignore-not-found pod "${jjb_pod}"

# return the exit status of the pod
[ "${status}" = 'Succeeded' ]

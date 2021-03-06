#!/bin/bash

set -e -o pipefail

function usage() {
    echo "Options:"
    echo "--help|-h                 specify the flags"
    echo "--ref                     specify the reference of pr"
    echo "--workdir                 specify the working directory"
    echo "--gitrepo                 specify the git repository"
    echo "--base                    specify the base branch to checkout"
    echo " "
    echo "Sample Usage:"
    echo "./prepare.sh --gitrepo=https://github.com/example --workdir=/opt/build --ref=pull/123/head"
    exit 0
}

# FIXME: unfortunately minikube does not work with podman (yet)
function install_docker()
{
    curl https://download.docker.com/linux/centos/docker-ce.repo -o /etc/yum.repos.d/docker-ce.repo
    # update all packages to prevent missing dependencies
    dnf -y update
    # install and enable docker
    dnf -y --nobest install docker-ce
    # fix network access from within docker containers (IP conflict in CI environment)
    [ -d /etc/docker ] || mkdir /etc/docker
    echo '{ "bip": "192.168.234.5/24" }' > /etc/docker/daemon.json
    systemctl enable --now docker
}

# In case no value is specified, default values will be used.
gitrepo="https://github.com/noobaa/noobaa-core"
workdir="tip/"
ref="master"
base="master"

ARGUMENT_LIST=(
    "ref"
    "workdir"
    "gitrepo"
    "base"
)

opts=$(getopt \
    --longoptions "$(printf "%s:," "${ARGUMENT_LIST[@]}")help" \
    --name "$(basename "${0}")" \
    --options "" \
    -- "$@"
)
ret=$?

if [ ${ret} -ne 0 ]
then
    echo "Try '--help' for more information."
    exit 1
fi

eval set -- "${opts}"

while true; do
    case "${1}" in
    --help)
        usage
        ;;
    --gitrepo)
        shift
        gitrepo=${1}
        ;;
    --workdir)
        shift
        workdir=${1}
        ;;
    --ref)
        shift
        ref=${1}
        echo "${ref}"
        ;;
    --base)
        shift
        base=${1}
        ;;
    --)
        shift
        break
        ;;
    esac
    shift
done

set -x

dnf -y install git make
install_docker

git clone --depth=1 --branch="${base}" "${gitrepo}" "${workdir}"
cd "${workdir}"
git fetch origin "${ref}:tip/${ref}"
git checkout "tip/${ref}"

#!/bin/bash

trap cleanup INT

function cleanup {
	echo "Cleaning up..."
	exit 0
}

REPO_ROOT="$(git rev-parse --show-toplevel)"

IS_DEV="true" \
GITSTORE_BASE_URI="$REPO_ROOT/data/" \
OAUTH_FAKE_USER="arnavs3@illinois.edu" \
$REPO_ROOT/bin/core -server
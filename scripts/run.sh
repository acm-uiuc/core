#!/bin/bash

trap cleanup INT

function cleanup {
	echo "Cleaning up..."
	exit 0
}

REPO_ROOT="$(git rev-parse --show-toplevel)"

$REPO_ROOT/bin/core -server
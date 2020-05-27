# Development
This document details how to setup your development for working on Core. This includes covering the required compile time and run time dependencies and also includes instructions on how to build and setup the service in development mode.

## Dependencies
Core was designed to have a minimum number of dependencies. The only two dependencies which need to be installed are the Go compiler and MySQL. Fetching of Go libraries will be handles automatically by the compiler at compile time.

### Go Compiler
Core is build in Go and need the Go toolchain to be installed. Up to date instructions for your platform can be found on the [official go website](https://golang.org/doc/install). Core requires a minimum of Go version 1.14. Since Core links in some native libraries GCC is required. Core recommends a minimum GCC version of 7.5.

### MySQL
Core stores all of it's persistant user data in MySQL. Up to date instructions for your platform can be found on the [official mysql website](https://dev.mysql.com/doc/mysql-installation-excerpt/8.0/en/). Core recommends a minimum MySQL version of 8.0. Once MySQL is installed an created a user with the username `devuser` and the password `devpass` should be created and provided sufficient permission to create, drop, and modify databases. These credentials will be used for all database operations in development mode. The database instance should be bound to `localhost:3306`. This is the default location that Core will try to operate against in development mode.

## Environment Setup
A make target is provided to reset the development environment and setup the database schema. This can be done automatically by running `make dev-reset` from the root of the repository. It should be noted that this is a destructive operation and remove any data present in the Core database.

## Running Core in Development Mode
Before running Core in development mode, you should build the latest changes. Building the latest changes can be done by running `make all` from the root of the repository. Once built, Core can be run in development mode. A make target is provided to run Core in development mode and can be invoked by running `make dev-run` from the root of the repository. This will start Core's webserver and bind it to `localhost:8000`. All endpoint and web site endpoints described in `design.md` can now be accessed.

Running in development mode sets some environment variables including, `OAUTH_FAKE_USER="arnavs3@illinois.edu"`, which makes the site work as if you this user. This variable can be modified in `scripts/run-dev.sh` if needed. When filling out the join form in development mode you should use the netid: `arnavs3`.

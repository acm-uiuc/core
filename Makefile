# =============================================================================
# VARIABLES
# =============================================================================

# AWS Account IDs
PROD_AWS_ACCOUNT := 298118738376
DEV_AWS_ACCOUNT  := 427040638965

# Tools & Shell Commands (immediate expansion)
SHELL            := /bin/bash
GIT_HASH         := $(shell git rev-parse --short HEAD)
CURRENT_AWS_ACCT := $(shell aws sts get-caller-identity --query Account --output text)
CURL             := curl -f

# Directories
API_SRC_DIR          := src/api
TERRAFORM_PROD_DIR   := terraform/envs/prod
TERRAFORM_QA_DIR     := terraform/envs/qa
DIST_LAMBDA_DIR      := dist/lambda
DIST_SQS_CONSUMER_DIR := dist/sqsConsumer

# Build Parameters
NODE_BUILDER_IMAGE := public.ecr.aws/sam/build-nodejs22.x:latest
NPM_INSTALL_PARAMS := --omit=dev --target_arch=arm64 --target_platform=linux --target_libc=glibc

# Platforms for Terraform provider locking
TF_LOCK_PLATFORMS := -platform=windows_amd64 -platform=darwin_amd64 -platform=darwin_arm64 -platform=linux_amd64 -platform=linux_arm64

# =============================================================================
# PHONY TARGETS & DEFAULT GOAL
# =============================================================================

.PHONY: help all clean build build_swagger local deploy_prod deploy_dev init_terraform \
        install test_all test_unit test_live_integration test_e2e test_post_deploy \
        check_account_prod check_account_dev dev_health_check prod_health_check \
        lock_terraform validate_terraform

# Set the default goal to 'help'
.DEFAULT_GOAL := help

# =============================================================================
# HELPER DEFINITION
# =============================================================================

# Define a reusable function for building Node.js packages in Docker.
# Argument 1: The directory to process (e.g., dist/lambda)
define build-lambda-package
    @echo "--- Building Node.js package in $(1) ---"
    docker run --rm -v "$(shell pwd)/$(1)":/var/task $(NODE_BUILDER_IMAGE) \
    sh -c "npm install $(NPM_INSTALL_PARAMS) && \
        rm -rf node_modules/aws-crt/dist/bin/{darwin*,linux-x64*,linux-arm64-musl} && \
        rm -rf node_modules/argon2/prebuilds/{darwin*,freebsd*,linux-arm,linux-x64*,win32-x64*} && \
        rm -rf node_modules/argon2/prebuilds/linux-arm64/argon2.armv8.musl.node"
endef

# =============================================================================
# CORE TARGETS
# =============================================================================

help: ## ✨ Show this help message
	@awk 'BEGIN {FS = ":.*?## "} /^[a-zA-Z_0-9-]+:.*?## / {printf "\033[36m%-25s\033[0m %s\n", $$1, $$2}' $(MAKEFILE_LIST)

all: install build test_all ## 🚀 Install, build, and run all tests

install: ## 📦 Install all project dependencies using Yarn
	yarn -D

clean: ## 🧹 Remove all build artifacts and node_modules
	rm -rf .aws-sam node_modules/ src/api/node_modules/ src/ui/node_modules/ \
	       dist/ dist_ui/ dist_devel/ coverage/

build_swagger: ## 📝 Generate Swagger/OpenAPI specification
	@(cd $(API_SRC_DIR); npx tsx --experimental-loader=./mockLoader.mjs createSwagger.ts)

build: install build_swagger ## 🛠️ Build the entire application
	@echo "--- Building project source ---"
	yarn build
	cp -r $(API_SRC_DIR)/resources/ dist/api/resources
	rm -rf dist/lambda/sqs
	$(call build-lambda-package,$(DIST_LAMBDA_DIR))
	$(call build-lambda-package,$(DIST_SQS_CONSUMER_DIR))

local: install ## 🏃 Run the development server locally
	VITE_BUILD_HASH=$(GIT_HASH) yarn run dev

# =============================================================================
# DEPLOYMENT & TERRAFORM
# =============================================================================

deploy_prod: check_account_prod ## 🚀 Deploy to PRODUCTION environment
	@echo "--- Deploying Terraform to Production ---"
	terraform -chdir=$(TERRAFORM_PROD_DIR) apply -auto-approve

deploy_dev: check_account_dev ## 🚀 Deploy to DEVELOPMENT (QA) environment
	@echo "--- Deploying Terraform to Development (QA) ---"
	terraform -chdir=$(TERRAFORM_QA_DIR) apply -auto-approve

init_terraform: ##  Terraform: Initialize all environments
	@echo "--- Initializing Terraform for Production ---"
	terraform -chdir=$(TERRAFORM_PROD_DIR) init
	@echo "--- Initializing Terraform for Development (QA) ---"
	terraform -chdir=$(TERRAFORM_QA_DIR) init

validate_terraform: ## Terraform: Format and validate all environments
	@echo "--- Validating Production Terraform ---"
	terraform -chdir=$(TERRAFORM_PROD_DIR) fmt -check
	terraform -chdir=$(TERRAFORM_PROD_DIR) validate
	@echo "--- Validating Development (QA) Terraform ---"
	terraform -chdir=$(TERRAFORM_QA_DIR) fmt -check
	terraform -chdir=$(TERRAFORM_QA_DIR) validate

lock_terraform: ## Terraform: Update provider dependency locks for all platforms
	@echo "--- Locking Terraform providers for Production ---"
	terraform -chdir=$(TERRAFORM_PROD_DIR) providers lock $(TF_LOCK_PLATFORMS)
	@echo "--- Locking Terraform providers for Development (QA) ---"
	terraform -chdir=$(TERRAFORM_QA_DIR) providers lock $(TF_LOCK_PLATFORMS)

# =============================================================================
# TESTING & QA
# =============================================================================

test_all: test_unit test_e2e ## ✅ Run all unit and e2e tests

test_unit: install ## ✅ Run linters, formatters, and unit tests
	yarn lint
	yarn prettier
	$(MAKE) validate_terraform
	yarn test:unit

test_live_integration: install ## ✅ Run post-deployment integration tests
	yarn test:live

test_e2e: install ## ✅ Run Playwright end-to-end tests
	yarn playwright install
	yarn test:e2e

test_post_deploy: test_live_integration test_e2e ## ✅ Run all post-deployment tests

# =============================================================================
# HEALTH CHECKS & GUARDS
# =============================================================================

check_account_prod: ## 🔒 Verify execution in the PRODUCTION AWS account
ifneq ($(CURRENT_AWS_ACCT),$(PROD_AWS_ACCOUNT))
	$(error ERROR: Not in PROD account. Expected $(PROD_AWS_ACCOUNT), but in $(CURRENT_AWS_ACCT))
endif

check_account_dev: ## 🔒 Verify execution in the DEVELOPMENT AWS account
ifneq ($(CURRENT_AWS_ACCT),$(DEV_AWS_ACCOUNT))
	$(error ERROR: Not in DEV account. Expected $(DEV_AWS_ACCOUNT), but in $(CURRENT_AWS_ACCT))
endif

dev_health_check: ## ❤️ Check health of the DEVELOPMENT environment
	@echo "--- Pinging Development (QA) Environment ---"
	$(CURL) https://core.aws.qa.acmuiuc.org/api/v1/healthz
	$(CURL) https://core.aws.qa.acmuiuc.org/

prod_health_check: ## ❤️ Check health of the PRODUCTION environment
	@echo "--- Pinging Production Environment ---"
	$(CURL) https://core.acm.illinois.edu/api/v1/healthz
	$(CURL) https://core.acm.illinois.edu

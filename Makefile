prod_aws_account = 298118738376
dev_aws_account = 427040638965
current_aws_account := $(shell aws sts get-caller-identity --query Account --output text)

src_directory_root = src/
dist_ui_directory_root = dist_ui/
integration_test_directory_root = tests/live_integration/
npm_install_params = --omit=dev --target_arch=arm64 --target_platform=linux --target_libc=glibc --cpu arm64 --os linux --arch=arm64
GIT_HASH := $(shell git rev-parse --short HEAD)

.PHONY: clean

check_account_prod:
ifneq ($(current_aws_account),$(prod_aws_account))
	$(error Error: running in account $(current_aws_account), expected account ID $(prod_aws_account))
endif

check_account_dev:
ifneq ($(current_aws_account),$(dev_aws_account))
	$(error Error: running in account $(current_aws_account), expected account ID $(dev_aws_account))
endif


clean:
	rm -rf .aws-sam
	rm -rf node_modules/
	rm -rf src/api/node_modules/
	rm -rf src/ui/node_modules/
	rm -rf dist/
	rm -rf dist_ui/
	rm -rf dist_devel/
	rm -rf coverage/

build_swagger:
	cd src/api && npx tsx --experimental-loader=./mockLoader.mjs createSwagger.ts && cd ../..

build: src/
	yarn -D
	yarn build
	make build_swagger
	cp -r src/api/resources/ dist/api/resources
	rm -rf dist/lambda/sqs
	docker run --rm -v "$(shell pwd)/dist/lambda":/var/task public.ecr.aws/sam/build-nodejs22.x:latest \
	sh -c "npm install $(npm_install_params) && \
			rm -rf node_modules/aws-crt/dist/bin/{darwin*,linux-x64*,linux-arm64-musl} && \
			rm -rf node_modules/argon2/prebuilds/{darwin*,freebsd*,linux-arm,linux-x64*,win32-x64*} && \
			rm -rf node_modules/argon2/prebuilds/linux-arm64/argon2.armv8.musl.node"

	docker run --rm -v "$(shell pwd)/dist/sqsConsumer":/var/task public.ecr.aws/sam/build-nodejs22.x:latest \
	sh -c "npm install $(npm_install_params) && \
				rm -rf node_modules/aws-crt/dist/bin/{darwin*,linux-x64*,linux-arm64-musl} && \
				rm -rf node_modules/argon2/prebuilds/{darwin*,freebsd*,linux-arm,linux-x64*,win32-x64*} && \
				rm -rf node_modules/argon2/prebuilds/linux-arm64/argon2.armv8.musl.node"

local:
	VITE_BUILD_HASH=$(GIT_HASH) yarn run dev

deploy_prod: check_account_prod
	@echo "Deploying Terraform..."
	terraform -chdir=terraform/envs/prod init -lockfile=readonly
	terraform -chdir=terraform/envs/prod apply -auto-approve

deploy_dev: check_account_dev
	@echo "Deploying Terraform..."
	terraform -chdir=terraform/envs/qa init -lockfile=readonly
	terraform -chdir=terraform/envs/qa apply -refresh-only
	terraform -chdir=terraform/envs/qa apply -auto-approve

init_terraform:
	terraform -chdir=terraform/envs/qa init
	terraform -chdir=terraform/envs/prod init

install:
	yarn -D

test_live_integration: install
	yarn test:live

test_unit: install
	yarn lint
	terraform -chdir=terraform/envs/qa init -reconfigure -backend=false -upgrade
	terraform -chdir=terraform/envs/qa fmt -check
	terraform -chdir=terraform/envs/qa validate
	terraform -chdir=terraform/envs/prod init -reconfigure -backend=false
	terraform -chdir=terraform/envs/prod fmt -check
	terraform -chdir=terraform/envs/prod validate
	yarn prettier
	yarn test:unit

test_e2e: install
	yarn playwright install
	yarn test:e2e

test_post_deploy: test_live_integration test_e2e

dev_health_check:
	curl -f https://core.aws.qa.acmuiuc.org/api/v1/healthz && curl -f https://core.aws.qa.acmuiuc.org/

prod_health_check:
	curl -f https://core.acm.illinois.edu/api/v1/healthz && curl -f https://core.acm.illinois.edu

lock_terraform:
	terraform -chdir=terraform/envs/qa providers lock -platform=windows_amd64 -platform=darwin_amd64 -platform=darwin_arm64 -platform=linux_amd64 -platform=linux_arm64
	terraform -chdir=terraform/envs/prod providers lock -platform=windows_amd64 -platform=darwin_amd64 -platform=darwin_arm64 -platform=linux_amd64 -platform=linux_arm64

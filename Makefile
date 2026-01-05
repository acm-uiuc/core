prod_aws_account = 298118738376
dev_aws_account = 427040638965
current_aws_account := $(shell aws sts get-caller-identity --query Account --output text)
current_active_region = "us-east-2"

src_directory_root = src/
dist_ui_directory_root = dist_ui/
integration_test_directory_root = tests/live_integration/
yarn_install_params = --production --frozen-lockfile
yarn_env = npm_config_arch=arm64 npm_config_platform=linux npm_config_libc=glibc
GIT_HASH := $(shell git rev-parse --short HEAD)

.PHONY: clean


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
	yarn
	yarn build
	make build_swagger
	cp -r src/api/resources/ dist/api/resources
	rm -rf dist/lambda/sqs
	docker run --rm -v "$(shell pwd)/dist/lambda":/var/task public.ecr.aws/sam/build-nodejs24.x:latest \
	sh -c "npm i -g yarn && $(yarn_env) yarn $(yarn_install_params) && \
			rm -rf node_modules/aws-crt/dist/bin/{darwin*,linux-x64*,linux-arm64-musl} && \
			rm -rf node_modules/argon2/prebuilds/{darwin*,freebsd*,linux-arm,linux-x64*,win32-x64*} && \
			rm -rf node_modules/argon2/prebuilds/linux-arm64/argon2.armv8.musl.node"

	docker run --rm -v "$(shell pwd)/dist/sqsConsumer":/var/task public.ecr.aws/sam/build-nodejs24.x:latest \
	sh -c "npm i -g yarn && $(yarn_env) yarn $(yarn_install_params) && \
				rm -rf node_modules/aws-crt/dist/bin/{darwin*,linux-x64*,linux-arm64-musl} && \
				rm -rf node_modules/argon2/prebuilds/{darwin*,freebsd*,linux-arm,linux-x64*,win32-x64*} && \
				rm -rf node_modules/argon2/prebuilds/linux-arm64/argon2.armv8.musl.node"

local:
	mkdir -p dist_devel/
	VITE_BUILD_HASH=$(GIT_HASH) yarn run dev

deploy_prod:
	@echo "Deploying Terraform..."
	terraform -chdir=terraform/envs/prod init -lockfile=readonly
	terraform -chdir=terraform/envs/prod plan -out=tfplan -var="current_active_region=$(current_active_region)"
	terraform -chdir=terraform/envs/prod apply -auto-approve tfplan
	rm terraform/envs/prod/tfplan

deploy_qa:
	@echo "Deploying Terraform..."
	terraform -chdir=terraform/envs/qa init -lockfile=readonly
	terraform -chdir=terraform/envs/qa plan -out=tfplan -var="current_active_region=$(current_active_region)"
	terraform -chdir=terraform/envs/qa apply -auto-approve tfplan
	rm terraform/envs/qa/tfplan

init_terraform:
	terraform -chdir=terraform/envs/qa init
	terraform -chdir=terraform/envs/prod init

install:
	yarn

test_live_integration: install
	yarn test:live

test_unit: install
	yarn lint
	terraform -chdir=terraform/envs/qa init -reconfigure -backend=false -upgrade
	terraform -chdir=terraform/envs/qa fmt -check
	terraform -chdir=terraform/envs/qa validate
	terraform -chdir=terraform/envs/prod init -reconfigure -backend=false -upgrade
	terraform -chdir=terraform/envs/prod fmt -check
	terraform -chdir=terraform/envs/prod validate
	yarn prettier
	yarn test:unit

test_e2e: install
	yarn playwright install
	yarn test:e2e

dev_health_check:
	curl -f https://core.aws.qa.acmuiuc.org/api/v1/healthz && curl -f https://core.aws.qa.acmuiuc.org/

prod_health_check:
	curl -f https://core.acm.illinois.edu/api/v1/healthz && curl -f https://core.acm.illinois.edu

lock_terraform:
	terraform -chdir=terraform/envs/qa providers lock -platform=windows_amd64 -platform=darwin_amd64 -platform=darwin_arm64 -platform=linux_amd64 -platform=linux_arm64
	terraform -chdir=terraform/envs/prod providers lock -platform=windows_amd64 -platform=darwin_amd64 -platform=darwin_arm64 -platform=linux_amd64 -platform=linux_arm64

upgrade_terraform:
	terraform -chdir=terraform/envs/qa init -reconfigure -backend=false -upgrade
	terraform -chdir=terraform/envs/prod init -reconfigure -backend=false -upgrade

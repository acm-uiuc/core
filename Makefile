run_env = ParameterKey=RunEnvironment,ParameterValue
set_application_prefix = ParameterKey=ApplicationPrefix,ParameterValue
set_application_name = ParameterKey=ApplicationFriendlyName,ParameterValue

prod_aws_account = 298118738376
dev_aws_account = 427040638965
current_aws_account := $(shell aws sts get-caller-identity --query Account --output text)

src_directory_root = src/
dist_ui_directory_root = dist_ui/
dist_docs_directory_root = dist/swagger/
integration_test_directory_root = tests/live_integration/

# CHANGE ME (as needed)
application_key=infra-core-api
application_name="InfraCoreApi"
techlead="tarasha2@illinois.edu"
region="us-east-1"

# DO NOT CHANGE
common_params = --no-confirm-changeset \
								--no-fail-on-empty-changeset \
								--capabilities CAPABILITY_IAM CAPABILITY_NAMED_IAM CAPABILITY_AUTO_EXPAND \
								--region $(region) \
								--stack-name $(application_key) \
				--tags "project=$(application_key)" "techlead=$(techlead)" \
				--s3-prefix $(application_key) \
				--resolve-s3

s3_bucket_prefix = "$(current_aws_account)-$(region)-$(application_key)"
ui_s3_bucket = "$(s3_bucket_prefix)-ui"
docs_s3_bucket = "$(s3_bucket_prefix)-docs"


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

build: src/ cloudformation/
	yarn -D
	VITE_BUILD_HASH=$(GIT_HASH) yarn build
	cp -r src/api/resources/ dist/api/resources
	rm -rf dist/lambda/sqs
	sam build --template-file cloudformation/main.yml --use-container
	mkdir -p .aws-sam/build/AppApiLambdaFunction/node_modules/aws-crt/
	cp -r node_modules/aws-crt/dist .aws-sam/build/AppApiLambdaFunction/node_modules/aws-crt

local:
	VITE_BUILD_HASH=$(GIT_HASH) yarn run dev


postdeploy:
	@echo "Syncing S3 UI bucket..."
	aws s3 sync $(dist_ui_directory_root) s3://$(ui_s3_bucket)/ --delete
	make invalidate_cloudfront

deploy_prod: check_account_prod
	@echo "Deploying CloudFormation stack..."
	sam deploy $(common_params) --parameter-overrides $(run_env)=prod $(set_application_prefix)=$(application_key) $(set_application_name)="$(application_name)" S3BucketPrefix="$(s3_bucket_prefix)"
	make postdeploy

deploy_dev: check_account_dev
	@echo "Deploying CloudFormation stack..."
	sam deploy $(common_params) --parameter-overrides $(run_env)=dev $(set_application_prefix)=$(application_key) $(set_application_name)="$(application_name)" S3BucketPrefix="$(s3_bucket_prefix)"
	make postdeploy

invalidate_cloudfront:
	@echo "Creating CloudFront invalidation..."
	$(eval DISTRIBUTION_ID := $(shell aws cloudformation describe-stacks --stack-name $(application_key) --query "Stacks[0].Outputs[?OutputKey=='CloudfrontDistributionId'].OutputValue" --output text))
	$(eval DISTRIBUTION_ID_2 := $(shell aws cloudformation describe-stacks --stack-name $(application_key) --query "Stacks[0].Outputs[?OutputKey=='CloudfrontIcalDistributionId'].OutputValue" --output text))
	$(eval INVALIDATION_ID := $(shell aws cloudfront create-invalidation --distribution-id $(DISTRIBUTION_ID) --paths "/*" --query 'Invalidation.Id' --output text --no-cli-page))
	$(eval INVALIDATION_ID_2 := $(shell aws cloudfront create-invalidation --distribution-id $(DISTRIBUTION_ID_2) --paths "/*" --query 'Invalidation.Id' --output text --no-cli-page))
	@echo "Triggered invalidation jobs $(INVALIDATION_ID) and $(INVALIDATION_ID_2)..."
	@echo "Waiting on job $(INVALIDATION_ID)..."
	aws cloudfront wait invalidation-completed --distribution-id $(DISTRIBUTION_ID) --id $(INVALIDATION_ID)
	@echo "Waiting on job $(INVALIDATION_ID_2)..."
	aws cloudfront wait invalidation-completed --distribution-id $(DISTRIBUTION_ID_2) --id $(INVALIDATION_ID_2)
	@echo "CloudFront invalidation completed!"

install:
	yarn -D
	pip install cfn-lint

test_live_integration: install
	yarn test:live

test_unit: install
	yarn lint
	cfn-lint cloudformation/**/*
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

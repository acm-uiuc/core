run_env = ParameterKey=RunEnvironment,ParameterValue
set_application_prefix = ParameterKey=ApplicationPrefix,ParameterValue
set_application_name = ParameterKey=ApplicationFriendlyName,ParameterValue

prod_aws_account = 298118738376
dev_aws_account = 427040638965

src_directory_root = src/
integration_test_directory_root = tests/live_integration/

# CHANGE ME (as needed)
application_key=infra-core-api
application_name="InfraCoreApi"
techlead="dsingh14@illinois.edu"
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

.PHONY: build clean

check_account_prod:
	@aws_account_id=$$(aws sts get-caller-identity --query Account --output text); \
	if [ "$$aws_account_id" != "$(prod_aws_account)" ]; then \
		echo "Error: running in incorrect account $$aws_account_id, expected account ID $(prod_aws_account)"; \
		exit 1; \
	fi
check_account_dev:
	@aws_account_id=$$(aws sts get-caller-identity --query Account --output text); \
	if [ "$$aws_account_id" != "$(dev_aws_account)" ]; then \
		echo "Error: running in incorrect account $$aws_account_id, expected account ID $(dev_aws_account)"; \
		exit 1; \
	fi

clean:
	rm -rf .aws-sam
	rm -rf node_modules/
	rm -rf src/api/node_modules/
	rm -rf src/ui/node_modules/
	rm -rf dist/
	rm -rf dist_ui/

build: src/ cloudformation/ docs/
	yarn -D
	yarn build
	sam build --template-file cloudformation/main.yml

local:
	yarn run dev

deploy_prod: check_account_prod build
	aws sts get-caller-identity --query Account --output text
	sam deploy $(common_params) --parameter-overrides $(run_env)=prod $(set_application_prefix)=$(application_key) $(set_application_name)="$(application_name)"

deploy_dev: check_account_dev build
	sam deploy $(common_params) --parameter-overrides $(run_env)=dev $(set_application_prefix)=$(application_key) $(set_application_name)="$(application_name)"

install_test_deps:
	yarn -D

test_live_integration: install_test_deps
	yarn test:live

test_unit: install_test_deps
	yarn typecheck
	yarn lint
	yarn prettier
	yarn test:unit

test_e2e: install_test_deps
	yarn test:e2e

dev_health_check:
	curl -f https://$(application_key).aws.qa.acmuiuc.org/api/v1/healthz && curl -f https://manage.qa.acmuiuc.org

prod_health_check:
	curl -f https://$(application_key).aws.acmuiuc.org/api/v1/healthz && curl -f https://manage.acm.illinois.edu

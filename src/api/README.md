# ACM @ UIUC Core API

## Run Locally

1. Log into AWS with `aws configure sso` so you can access AWS resources.
2. `yarn`
3. `make local`

## Build for AWS Lambda

1. `make build`

## Deploy to AWS env

1. Get AWS credentials with `aws configure sso`
2. Ensure AWS profile is set to the right account (QA or PROD).
3. Run `make deploy_qa` or `make deploy_prod`.

You will not be able to deploy manually with Admin permissions. You must make a PR and go through CI/CD pipeline.

## Configuring AWS

SSO URL: `https://acmillinois.awsapps.com/start/#`

```
aws configure sso
```

Log in with SSO. Then, export the `AWS_PROFILE` that the above command outputted.

```bash
export AWS_PROFILE=ABC-DEV
```

# ACM @ UIUC Core API

## Run Locally
1. Copy `.env.sample` as `.env` and set the `JwtSigningKey` to a random string.
2. Enable Tailscale VPN so you can reach the development database in AWS
3. Log into AWS with `aws configure sso` so you can retrieve the AWS secret and configuration.
4. `yarn -D`
5. `make check_account_dev` - If this fails make sure that AWS is configured.
6. `make local`

## Build for AWS Lambda
1. `make clean`
2. `make build`

## Deploy to AWS env

1. Get AWS credentials with `aws configure sso`
2. Ensure AWS profile is set to the right account (DEV or PROD).
3. Run `make deploy_dev` or `make deploy_prod`.

## Generating JWT token

Create a `.env` file containing your `AadClientSecret`.

```bash
node --env-file=.env get_msft_jwt.js
```

## Configuring AWS

SSO URL: `https://acmillinois.awsapps.com/start/#`

```
aws configure sso
```

Log in with SSO. Then, export the `AWS_PROFILE` that the above command outputted. 

```bash
export AWS_PROFILE=ABC-DEV
```

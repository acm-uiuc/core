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

## Production InfraTeamMember synchronization

Successful additions/removals to the configured Entra group enqueue isolated
`syncCloudflareMember` jobs alongside notification jobs. Cloudflare failures
retry only that SQS record under the existing retry/DLQ policy; they do not
replay the Entra mutation. Existing accepted/pending members and already-absent
removals are idempotent. Rejected invitations require operator intervention.
Development/QA does not enqueue these jobs.

Production invitations default to **Workers Platform (Read-only)**, using ACM
member-role ID `e58cefd75d7adae0b761796c28815e5c`. This is platform-wide read
access, including R2 and domain/DNS visibility, not Workers-only access; it
does not grant edits or deployments. Existing accepted/pending members retain
their assigned roles; an add job does not reconcile or downgrade those roles.

Before production deployment:

1. Commit the real nonsecret `CloudflareInfraTeamGroupId` (Entra group UUID)
   as a variable default in `terraform/envs/prod/variables.tf`, matching the
   existing production AWS configuration. `CloudflareAccountId` and
   `CloudflareMemberRoleIds` already default to ACM's account and its
   **Workers Platform (Read-only)** member role, respectively. Member-role IDs
   are distinct from API-token permission IDs.
2. Create a target-account bootstrap API token with **Account API Tokens Write**
   (dashboard: **Account API Tokens: Edit**). Its owner needs API Token
   Provisioning capability or Super Administrator status and authority to grant
   **Account Settings Write**. Set only the GitHub `AWS PROD` environment secret
   `CLOUDFLARE_TERRAFORM_API_TOKEN`. Keep it active for future Terraform refresh,
   plan, and apply runs; the deploy step supplies it as `CLOUDFLARE_API_TOKEN`.
3. Run the production plan with `current_active_region=us-east-2`. Expect one
   account-owned token named `infra-core-api member sync`, limited to
   **Account Settings Write**, and four SSM parameters across `us-east-2` and
   `us-west-2`: `/infra-core-api/cloudflare_infra_team_group_id` (`String`) and
   `/infra-core-api/cloudflare_member_config` (`SecureString`). The compact
   member config contains only `account_id`, `api_token`, and sorted `role_ids`.
   The runtime token is sensitive in Terraform state and encrypted in SSM;
   do not create it or the SSM parameters manually.

After deployment, add then remove a designated test email through Manage
Authentication. Check the route's `202` response, the corresponding
`syncCloudflareMember` success logs, pending/accepted Cloudflare membership
with the configured roles after addition, and absence after removal.

# Bootstrapping a deployment

The accounts and settings a new deployment of askme needs before its first deploy. These are made once, by hand. The repo refers to each by the name given here, and holds no values. To run the checks on a laptop, see [setup.md](setup.md).

## Accounts and settings

1. **AWS.** Use an AWS account that holds askme and nothing else, in `us-east-1`. CloudWatch's billing metric and CloudFront's certificates exist only there. Switch on the account's billing alerts, or AWS publishes no billing metric and the spend alarm never fires ([ADR 17](adr/0017-spend-reads-the-bill.md)). A new account may allow only 10 concurrent Lambda executions where AWS's default is 1,000, so ask AWS to raise it.
2. **Parameters.** In Parameter Store, Standard tier, in `us-east-1`:
   - `/askme/alerts/email`, a String, for the address alerts go to.
   - `/askme/alerts/monthly-spend`, a String, for the monthly spend in US dollars that sets off the spend alarm.
   - `/askme/openrouter/api-key`, a SecureString, for the service's model key, which has a spending limit.
3. **The deploy role.** Apply [infra/github-oidc.cfn.yml](../infra/github-oidc.cfn.yml) once by hand, as the stack `askme` in `us-east-1`, with the capability `CAPABILITY_NAMED_IAM`. Give it the parameters `GitHubOwnerId` and `GitHubRepoId`, the numeric ids any Actions run shows as `github.repository_owner_id` and `github.repository_id`. It makes GitHub's OIDC provider and the role `askme-github-deploy`, which only a job on main can assume. Each deploy applies it again after that.
4. **GitHub.** Set the repo variables `AWS_DEPLOY_ROLE_ARN`, `AWS_REGION`, `CLERK_PUBLISHABLE_KEY` and `CLERK_ISSUER`, and the repo secret `SERVERLESS_ACCESS_KEY`. Give main a ruleset that requires a pull request and the `gate` check. A daily conformance check reads the ruleset back.
5. **Clerk.** Make a development instance, and set it up as the next section says.
6. **OpenRouter.** Two keys in a workspace of askme's own: the service's key above, and an eval key with a small limit. In a Claude cloud environment, add the eval key as a network secret for `openrouter.ai`, with the header `Authorization` and the prefix `Bearer`.
7. **The first deploy.** Merge to main. The deploy run's summary gives both addresses. Put them at the top of the README, or the live check after each deploy fails. Then confirm the alert email, as below.

## Clerk dashboard settings

These are under Configure, then Developers, then OAuth applications.

| Tab | Setting | Value |
| --- | --- | --- |
| Settings | Publish CIMD support | On, with "Allow any client" |
| Settings | Publish DCR support | On |
| Settings | Require PKCE | On, Clerk's default |
| Settings | Access token format | JWT access tokens, Clerk's default |
| Settings | Include Audience | Off, Clerk's default |
| Scopes | Custom scope | `asks:create`, published in discovery |

Under User & authentication, people sign in with email, Google or GitHub. A development instance uses Clerk's shared Google and GitHub credentials. A production instance needs askme's own.

The live check after each deploy signs up its one test account the first time it runs. For that, set Clerk's access mode to Open and turn test mode on.

## Confirming the alert email

The first deploy makes the alert topic, and AWS emails a confirmation link to the address in `/askme/alerts/email`, from `no-reply@sns.amazonaws.com`. No alarm reaches anyone until the link is clicked. It lasts three days. If it runs out, open SNS in `us-east-1`, then Topics, `askme-alerts`, Subscriptions, select the pending subscription and choose Request confirmation.

To check that an alarm reaches you, run this in CloudShell in `us-east-1`:

```
aws cloudwatch set-alarm-state \
  --alarm-name askme-error-lines \
  --state-value ALARM \
  --state-reason "Checking the alert email arrives"
```

An email titled `ALARM: "askme-error-lines" in US East (N. Virginia)` arrives. The command changes only the alarm's state, and the alarm returns to OK at its next one-minute check without sending another email. Use `askme-error-lines` for this. `askme-spend` checks only every six hours, so it would stay in ALARM for hours.

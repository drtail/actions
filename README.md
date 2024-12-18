# actions in Dr.Tail
Implement better DX (Developer Experience) for Dr.Tail Developers

## 1. remind-pr-review
### Description

This action sends a Slack DM to the PR reviewer when a PR is opened.

### Inputs and Outputs

#### Inputs

|        Name        |                Description                | Required | Default |
|--------------------|-------------------------------------------|----------|---------|
|      `token`       |             GitHub token                  |   true   |         |
|  `slackBotToken`   |    Slack bot token for messaging          |   true   |         |
| `githubEmailToSlack`| Mapping of GitHub email to Slack member ID |  false   |         |

#### Outputs

This action does not produce any outputs.

### Usage

```yaml
- name: Notify PR Review
  uses: drtail/actions/remind-pr-review@v1
  with:
    token: ${{ secrets.GITHUB_TOKEN }}
    slackBotToken: ${{ secrets.SLACK_BOT_TOKEN }}
    githubEmailToSlack: |
      github_email@example.com:slack_member_id,
      github_email2@example.com:slack_member_id2
```

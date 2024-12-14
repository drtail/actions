# actions in Dr.Tail
Implement better DX (Developer Experience) for Dr.Tail Developers

## 1. remind-pr-review
### Description

This action sends a Slack DM to the PR reviewer when a PR is opened.

### Inputs and Outputs

#### Inputs

| Name           | Description                        | Required | Default |
|----------------|------------------------------------|----------|---------|
| `token`        | GitHub token                       | true     |         |
| `slackBotToken`| Slack bot token for messaging      | true     |         |

#### Outputs

This action does not produce any outputs.

### Usage

```yaml
- name: Checkout certain repo
  uses: actions/checkout@v4
  with:
    repository: 'drtail/actions'
    ref: 'v0.1.0' # TODO: change to your version
    path: './.github/actions/remind-pr-review'
- name: Notify PR Review
  uses: ./.github/actions/remind-pr-review
  with:
    token: ${{ secrets.GITHUB_TOKEN }}
    slackBotToken: ${{ secrets.SLACK_BOT_TOKEN }}
```

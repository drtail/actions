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

## 2. auto-assign-reviewer
### Description

This action automatically assigns a reviewer to a PR based on the PR title.

### Inputs and Outputs

#### Inputs

| Name | Description | Required | Default |
|------|-------------|----------|---------|
| token | GitHub token | true | |
| reviewers | Reviewers, in the format of github username | true | |
| random_reviewer | Whether to randomly select a reviewer from the list | false | false |
| add_reviewers | Whether to add reviewers to pr | false | false |
| skip_keywords | Skip keywords, in the format of keyword1,keyword2 | false | |
| add_assignee | Whether to add assignee to pr | false | false |

### Usage

```yaml
- name: Auto Assign Reviewer
  uses: drtail/actions/auto-assign-reviewer@v1
  with:
    token: ${{ secrets.GITHUB_TOKEN }}
    reviewers: github_username1,github_username2
    random_reviewer: true
    add_reviewers: true
    skip_keywords: keyword1,keyword2
    add_assignee: true
```

## 3. pr-label
### Description

This action labels PRs based on the PR title and duplicate patterns.

### Inputs and Outputs

#### Inputs

| Name | Description | Required | Default |
|------|-------------|----------|---------|
| token | GitHub token | true | |
| labels | Labels to add to PRs | true | |
| duplicate-patterns | Patterns to check for duplicate PRs | true | |

### Usage

```yaml
- name: PR Labeler
  uses: drtail/actions/pr-label@v1
  with:
    token: ${{ secrets.GITHUB_TOKEN }}
    labels: |
      D-3
    duplicate-patterns: |
      D-*
```

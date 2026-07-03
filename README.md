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

## 4. AI PR Review (small & big)

Two composite actions review PRs with Claude for the Linear-issue-based workflow. Both
**hardcode the model (`claude-sonnet-5`)** — consuming repos cannot override it — and both
resolve external links (Linear / Slack / Notion / Sentry) found in the PR body via
`scripts/fetch_pr_context.py`, writing `.pr-context.md` for the reviewer to read.

Tokens come from **organization secrets** (`LINEAR_API_KEY`, `SLACK_BOT_TOKEN`,
`NOTION_API_KEY`, `SENTRY_API_TOKEN`) scoped to the consuming repos and
passed through as inputs; a missing/unscoped token simply skips that source (never fails the
review). A link that can't be read (Slack bot not in channel, Notion page not shared, …) is
reported under "수집 실패" in `.pr-context.md` so the reviewer never guesses.

### 4a. claude-django-review-loop — small PR (`3 -> 2`, base ≠ trunk)

Review-reflect-re-review loop (min 2, max 5 rounds). Verifies the PR's Acceptance Criteria are
implemented **exactly — no more, no less** against the diff and the linked Linear issue, plus
N+1 / architecture / security / tests. Posts `## ✅ AI Review APPROVED` once clean (round ≥ 2),
which is what lets the author merge.

```yaml
on:
  pull_request:
    types: [labeled]
jobs:
  review:
    if: github.event.label.name == '🤖 AI Review (작은 PR)' && github.event.pull_request.base.ref != 'main'
    runs-on: ubuntu-latest
    permissions: { contents: read, pull-requests: write, issues: write, id-token: write }
    steps:
      - uses: drtail/actions/claude-django-review-loop@main
        with:
          anthropic_api_key: ${{ secrets.ANTHROPIC_API_KEY }}
          github_token: ${{ secrets.GITHUB_TOKEN }}
          trigger_label: '🤖 AI Review (작은 PR)'
          linear_api_key: ${{ secrets.LINEAR_API_KEY }}
          slack_bot_token: ${{ secrets.SLACK_BOT_TOKEN }}
          notion_api_key: ${{ secrets.NOTION_API_KEY }}
          sentry_api_token: ${{ secrets.SENTRY_API_TOKEN }}
          allowed_bots: 'claude'
```

### 4b. claude-parent-review — big PR (`2 -> 1`, base = trunk)

Completeness audit of a platform integration PR against its **Linear parent issue**: checks
that the PR delivers exactly the backend-relevant scope (기술 목표 / 작업 내용 / 영향 범위 /
범위 제외 / 완료 기준 / 기술 노트) — no more, no less — plus the standard code review.
Intentionally **does not** emit an APPROVED marker (the human reviewer merges).

```yaml
      - uses: drtail/actions/claude-parent-review@main
        with:
          anthropic_api_key: ${{ secrets.ANTHROPIC_API_KEY }}
          github_token: ${{ secrets.GITHUB_TOKEN }}
          trigger_label: '🛰️ AI Review (큰 PR)'
          linear_api_key: ${{ secrets.LINEAR_API_KEY }}
          slack_bot_token: ${{ secrets.SLACK_BOT_TOKEN }}
          notion_api_key: ${{ secrets.NOTION_API_KEY }}
          sentry_api_token: ${{ secrets.SENTRY_API_TOKEN }}
          allowed_bots: 'claude'
```

### Requirements

Each consuming repo should have a `CLAUDE.md` documenting architecture, conventions, and test
standards. The older single-shot `claude-django-review` action is kept for backward
compatibility but is superseded by `claude-django-review-loop`.

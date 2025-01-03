import * as core from '@actions/core'
import * as github from '@actions/github'
import { addOrUpdateDueLabel, updateAllPRLabels } from './run'

interface PullRequest {
  draft: boolean
  number: number
}

interface WebhookPayload {
  pull_request?: PullRequest
}

async function run() {
  try {
    const token = core.getInput('github-token', { required: true })
    const octokit = github.getOctokit(token)
    const context = github.context

    // PR 이벤트 처리
    if (
      context.eventName === 'pull_request' ||
      context.eventName === 'pull_request_target'
    ) {
      const payload = context.payload as WebhookPayload
      const pullRequest = payload.pull_request

      if (!pullRequest) {
        core.setFailed('Pull request payload is missing')
        return
      }

      // Draft PR이 아닌 경우에만 처리
      if (!pullRequest.draft) {
        await addOrUpdateDueLabel(octokit, context.repo, pullRequest.number)
      }
    }
    // 스케줄된 이벤트 처리
    else if (context.eventName === 'schedule') {
      await updateAllPRLabels(octokit, context.repo)
    }
  } catch (error) {
    if (error instanceof Error) {
      core.setFailed(error.message)
    }
  }
}

run()
  .then(() => {
    core.info('Done')
  })
  .catch((e) => {
    core.error(e)
    core.setFailed(e.message)
  })

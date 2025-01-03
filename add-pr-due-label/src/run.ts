import { Context } from '@actions/github/lib/context'
import { GitHub } from '@actions/github/lib/utils'

export async function addOrUpdateDueLabel(
  octokit: InstanceType<typeof GitHub>,
  repo: Context['repo'],
  prNumber: number,
) {
  // 기존 D- 라벨 제거
  const { data: currentLabels } = await octokit.rest.issues.listLabelsOnIssue({
    ...repo,
    issue_number: prNumber,
  })

  for (const label of currentLabels) {
    if (label.name.startsWith('D-')) {
      await octokit.rest.issues.removeLabel({
        ...repo,
        issue_number: prNumber,
        name: label.name,
      })
    }
  }

  // D-3 라벨 추가
  await octokit.rest.issues.addLabels({
    ...repo,
    issue_number: prNumber,
    labels: ['D-3'],
  })
}

export async function updateAllPRLabels(
  octokit: InstanceType<typeof GitHub>,
  repo: Context['repo'],
) {
  // 열린 PR 목록 가져오기
  const { data: pulls } = await octokit.rest.pulls.list({
    ...repo,
    state: 'open',
  })

  for (const pull of pulls) {
    if (pull.draft) continue

    const { data: labels } = await octokit.rest.issues.listLabelsOnIssue({
      ...repo,
      issue_number: pull.number,
    })

    for (const label of labels) {
      if (label.name.startsWith('D-')) {
        const currentDay = parseInt(label.name.slice(2))
        if (currentDay > 0) {
          // 기존 라벨 제거
          await octokit.rest.issues.removeLabel({
            ...repo,
            issue_number: pull.number,
            name: label.name,
          })

          // 새로운 라벨 추가
          const newDay = currentDay - 1
          await octokit.rest.issues.addLabels({
            ...repo,
            issue_number: pull.number,
            labels: [`D-${newDay}`],
          })
        }
      }
    }
  }
} 
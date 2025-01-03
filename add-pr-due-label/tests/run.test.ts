/// <reference types="jest" />
import { Context } from '@actions/github/lib/context'
import { GitHub } from '@actions/github/lib/utils'
import { beforeEach, describe, expect, it, jest } from '@jest/globals'
import { addOrUpdateDueLabel, updateAllPRLabels } from '../src/run'

describe('PR Due Label Manager', () => {
  let mockOctokit: jest.Mocked<InstanceType<typeof GitHub>>
  let mockRepo: Context['repo']

  beforeEach(() => {
    mockOctokit = {
      rest: {
        issues: {
          listLabelsOnIssue: jest.fn(),
          removeLabel: jest.fn(),
          addLabels: jest.fn(),
        },
        pulls: {
          list: jest.fn(),
        },
      },
    } as any

    mockRepo = {
      owner: 'test-owner',
      repo: 'test-repo',
    }
  })

  describe('addOrUpdateDueLabel', () => {
    it('기존 D- 라벨을 제거하고 D-3 라벨을 추가해야 함', async () => {
      mockOctokit.rest.issues.listLabelsOnIssue.mockResolvedValueOnce({
        data: [
          {
            id: 1,
            node_id: 'node1',
            url: 'https://api.github.com/repos/test/test/labels/D-2',
            name: 'D-2',
            description: null,
            color: '000000',
            default: false,
          },
          {
            id: 2,
            node_id: 'node2',
            url: 'https://api.github.com/repos/test/test/labels/bug',
            name: 'bug',
            description: null,
            color: '000000',
            default: false,
          },
        ],
        headers: {},
        status: 200,
        url: 'https://api.github.com/repos/test/test/issues/1/labels',
      })

      await addOrUpdateDueLabel(mockOctokit, mockRepo, 1)

      expect(mockOctokit.rest.issues.removeLabel).toHaveBeenCalledWith({
        ...mockRepo,
        issue_number: 1,
        name: 'D-2',
      })

      expect(mockOctokit.rest.issues.addLabels).toHaveBeenCalledWith({
        ...mockRepo,
        issue_number: 1,
        labels: ['D-3'],
      })
    })
  })

  describe('updateAllPRLabels', () => {
    it('열린 PR의 D- 라벨을 하루씩 감소시켜야 함', async () => {
      mockOctokit.rest.pulls.list.mockResolvedValueOnce({
        data: [
          { number: 1, draft: false },
          { number: 2, draft: true },
        ] as any,
        headers: {},
        status: 200,
        url: 'https://api.github.com/repos/test/test/pulls',
      })

      mockOctokit.rest.issues.listLabelsOnIssue.mockResolvedValueOnce({
        data: [{ name: 'D-2' }] as any,
        headers: {},
        status: 200,
        url: 'https://api.github.com/repos/test/test/issues/1/labels',
      })

      await updateAllPRLabels(mockOctokit, mockRepo)

      expect(mockOctokit.rest.issues.removeLabel).toHaveBeenCalledWith({
        ...mockRepo,
        issue_number: 1,
        name: 'D-2',
      })

      expect(mockOctokit.rest.issues.addLabels).toHaveBeenCalledWith({
        ...mockRepo,
        issue_number: 1,
        labels: ['D-1'],
      })
    })

    it('draft PR은 처리하지 않아야 함', async () => {
      mockOctokit.rest.pulls.list.mockResolvedValueOnce({
        data: [{ number: 1, draft: true }] as any,
        headers: {},
        status: 200,
        url: 'https://api.github.com/repos/test/test/pulls',
      })

      await updateAllPRLabels(mockOctokit, mockRepo)

      expect(mockOctokit.rest.issues.listLabelsOnIssue).not.toHaveBeenCalled()
    })
  })
})

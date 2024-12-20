import { run } from '../src/run';
import * as core from '@actions/core';
import * as github from '@actions/github';

jest.mock('@actions/core');
jest.mock('@actions/github');

let getInputMock: jest.SpiedFunction<typeof core.getInput>

describe('run function', () => {
    const mockOctokit = {
        rest: {
            issues: {
                addAssignees: jest.fn(),
            },
            pulls: {
                requestReviewers: jest.fn(),
            },
        },
    };

    beforeEach(() => {
        (github.getOctokit as jest.Mock).mockReturnValue(mockOctokit);
        jest.clearAllMocks();
        getInputMock = jest.spyOn(core, 'getInput').mockImplementation()
    });

    it('should fail if no pull request is found', async () => {
        (github.context.payload as any).pull_request = null;
        getInputMock.mockImplementation(name => {
            switch (name) {
                case 'reviewers':
                    return 'reviewer1,reviewer2'
                case 'token':
                    return 'token'
                case 'add_assignee':
                    return 'true'
                case 'add_reviewers':
                    return 'true'
                case 'random_reviewer':
                    return 'true'
                case 'skip_keywords':
                    return 'skip'
                default:
                    return ''
            }
        })
        await run();
        expect(core.setFailed).toHaveBeenCalledWith('No pull request found');
    });

    it('should fail if no pull request title is found', async () => {
        (github.context.payload.pull_request as any) = { title: null };
        getInputMock.mockImplementation(name => {
            switch (name) {
                case 'reviewers':
                    return 'reviewer1,reviewer2'
                case 'token':
                    return 'token'
                case 'add_assignee':
                    return 'true'
                case 'add_reviewers':
                    return 'true'
                case 'random_reviewer':
                    return 'true'
                case 'skip_keywords':
                    return 'skip'
                default:
                    return ''
            }
        })
        await run();
        expect(core.setFailed).toHaveBeenCalledWith('No pull request title found');
    });

    it('should skip PR if it contains skip keywords', async () => {
        (github.context.payload.pull_request as any) = {
            title: 'Fix issue',
            labels: [{ name: 'skip' }],
            draft: false,
            state: 'open',
            user: { login: 'creator' },
            number: 1,
            base: { repo: { owner: { login: 'owner' }, name: 'repo' } },
        };
        getInputMock.mockImplementation(name => {
            switch (name) {
                case 'reviewers':
                    return 'reviewer1,reviewer2'
                case 'token':
                    return 'token'
                case 'add_assignee':
                    return 'true'
                case 'add_reviewers':
                    return 'true'
                case 'random_reviewer':
                    return 'true'
                case 'skip_keywords':
                    return 'skip'
                default:
                    return ''
            }
        })
        await run();
        expect(core.info).toHaveBeenCalledWith('Skipping PR #1 because it contains skip_keywords');
    });

    it('should assign the PR creator as an assignee', async () => {
        (github.context.payload.pull_request as any) = {
            title: 'Fix issue',
            labels: [],
            draft: false,
            state: 'open',
            user: { login: 'creator' },
            number: 1,
            base: { repo: { owner: { login: 'owner' }, name: 'repo' } },
        };
        getInputMock.mockImplementation(name => {
            switch (name) {
                case 'reviewers':
                    return 'reviewer1,reviewer2'
                case 'token':
                    return 'token'
                case 'add_assignee':
                    return 'true'
                default:
                    return ''
            }
        })
        await run();
        expect(mockOctokit.rest.issues.addAssignees).toHaveBeenCalledWith({
            owner: 'owner',
            repo: 'repo',
            issue_number: 1,
            assignees: ['creator'],
        });
    });

    it('should request a reviewer', async () => {
        (github.context.payload.pull_request as any) = {
            title: 'Fix issue',
            labels: [],
            draft: false,
            state: 'open',
            user: { login: 'creator' },
            number: 1,
            base: { repo: { owner: { login: 'owner' }, name: 'repo' } },
        };
        getInputMock.mockImplementation(name => {
            switch (name) {
                case 'reviewers':
                    return 'reviewer1,reviewer2'
                case 'token':
                    return 'token'
                default:
                    return ''
            }
        })
        await run();
        expect(mockOctokit.rest.pulls.requestReviewers).toHaveBeenCalledWith({
            owner: 'owner',
            repo: 'repo',
            pull_number: 1,
            reviewers: ['reviewer1'],
        });
    });
});

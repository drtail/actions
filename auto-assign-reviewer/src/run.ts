import * as core from '@actions/core';
import * as github from '@actions/github';

const SKIP_LABEL = '⚠️ Skip Review';

export const run = async () => {
    const token = core.getInput('token');
    const reviewers = core.getInput('reviewers').split(',').map(reviewer => reviewer.trim());
    const add_assignee = core.getInput('add_assignee'); // TODO: use this flag to determine if we should add assignee to pr
    const add_reviewers = core.getInput('add_reviewers'); // TODO: use this flag to determine if we should add reviewers to pr
    const random_reviewer = core.getInput('random_reviewer');
    const skip_keywords = core.getInput('skip_keywords');

    const octokit = github.getOctokit(token);
    const context = github.context;
    const pr = context.payload.pull_request;
    const prTitle = pr?.title as string | undefined;


    if (!pr) {
        core.setFailed('No pull request found');
        return;
    }
    if (!prTitle) {
        core.setFailed('No pull request title found');
        return;
    }

    const skipKeywordList = skip_keywords.split(',').map(keyword => keyword.trim()).filter(keyword => keyword !== '');
    const skipping = skipKeywordList.some(keyword => pr.labels.some((label: { name: string }) => label.name.includes(keyword))) || skipKeywordList.some(keyword => prTitle.includes(keyword))
    if (skipping) {
        await octokit.rest.issues.addLabels({
            owner: pr.base.repo.owner.login,
            repo: pr.base.repo.name,
            issue_number: pr.number,
            labels: [SKIP_LABEL],
        });
        core.info(`Skipping PR #${pr.number} because it contains skip_keywords`);
        return;
    }

    if (pr.draft !== false || pr.state !== 'open') {
        core.info('PR is still in draft or not open');
        return;
    }

    try {
        // Add the PR creator as an assignee
        await octokit.rest.issues.addAssignees({
            owner: pr.base.repo.owner.login,
            repo: pr.base.repo.name,
            issue_number: pr.number,
            assignees: [pr.user.login],
        });
        core.info(`Assigned ${pr.user.login} to PR #${pr.number}`);
    } catch (error) {
        core.setFailed(`Failed to add assignee: ${error}`);
        return;
    }


    // Select a reviewer who is not the PR creator
    const selectReviewer = (reviewers: string[], prCreator: string, random: boolean): string | null => {
        const nonCreatorReviewers = reviewers.filter(reviewer => reviewer !== prCreator);
        if (nonCreatorReviewers.length === 0) {
            return null;
        }
        if (random) {
            return nonCreatorReviewers[Math.floor(Math.random() * nonCreatorReviewers.length)];
        }
        return nonCreatorReviewers[0]; // Return the first non-creator reviewer
    };

    const selectedReviewer = selectReviewer(reviewers, pr.user.login, random_reviewer === 'true');

    if (!selectedReviewer) {
        core.info('No available reviewers who are not the PR creator');
        return;
    }

    try {
        await octokit.rest.pulls.requestReviewers({
            owner: pr.base.repo.owner.login,
            repo: pr.base.repo.name,
            pull_number: pr.number,
            reviewers: [selectedReviewer],
        });
        core.info(`Requested review from ${selectedReviewer} for PR #${pr.number}`);
    } catch (error) {
        core.setFailed(`Failed to request reviewers: ${error}`);
    }
};

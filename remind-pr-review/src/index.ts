// This action was originally from https://github.com/naver/notify-pr-review/blob/main/index.js
// Notify PR Review
// Copyright (c) 2023-present NAVER Corp.
// Apache-2.0


import * as core from '@actions/core';
import * as github from '@actions/github';
import { run } from './run';

const ENCODE_PAIR: Record<string, string> = {
    "<": "&lt;",
    ">": "&gt;"
};

export const encodeText = (text: string): string => text.replace(/[<>]/g, (matched: string) => ENCODE_PAIR[matched]);

export const fetchUser = async (url: string, token: string): Promise<{ email: string }> => {
    const response = await fetch(url, {
        method: "GET",
        headers: {
            Authorization: `token ${token}`
        }
    });
    if (!response.ok) {
        throw new Error(`Failed to fetch user: ${response.statusText}`);
    }
    return response.json();
};

const D0 = "D-0";

interface SlackMessageParams {
    repoName: string;
    labels: { name: string }[];
    title: string;
    url: string;
    email?: string;
    slackMemberID?: string;
}

export const sendReviewRequest = async ({ repoName, labels, title, url, email, slackMemberID }: SlackMessageParams, slackBotToken: string): Promise<void> => {
    let name: string;
    if (slackMemberID) {
        name = slackMemberID;
    } else if (email) {
        [name] = email.split("@");
    } else {
        throw new Error("Failed: 'slackMemberID' or 'email' is undefined.");
    }

    const d0exists = labels.some((label: { name: string }) => label.name === D0);

    const response = await fetch("https://slack.com/api/chat.postMessage", {
        method: "POST",
        headers: {
            Authorization: `Bearer ${slackBotToken}`,
            "Content-Type": "application/json"
        },
        body: JSON.stringify({
            channel: `@${name}`,
            text: "You have a review request! 😊",
            blocks: [
                {
                    type: "section",
                    text: {
                        type: "mrkdwn",
                        text: `📬 <@${name}> You have a new review request! Please participate in the review as soon as possible:`
                    }
                },
                {
                    type: "section",
                    text: {
                        type: "mrkdwn",
                        text: `*${repoName}:*\n<${url}|${encodeText(title)}>`
                    }
                },
                ...labels.length ? [{
                    type: "actions",
                    elements: labels.map(({ name }: { name: string }) => ({
                        type: "button",
                        text: {
                            type: "plain_text",
                            text: name
                        },
                        ...name === D0 ? { style: "danger" } : {}
                    }))
                }] : [],
                ...d0exists ? [{
                    type: "section",
                    text: {
                        type: "mrkdwn",
                        text: `*🚨 This is a very urgent \`${D0}\` PR! Please participate in the review immediately! 🚨*`
                    }
                }] : [],
                {
                    type: "divider"
                },
                {
                    type: "context",
                    elements: [
                        {
                            type: "mrkdwn",
                            text: "💪 Code reviews are a key process that improves code quality, reduces bugs, and promotes knowledge sharing and collaboration among team members.\n🙏 We ask for your active participation and feedback."
                        }
                    ]
                }
            ]
        })
    });

    if (!response.ok) {
        throw new Error(`Failed to send Slack message: ${response.statusText}`);
    }
};

interface PullRequest {
    title: string;
    html_url: string;
    labels: { name: string }[];
}

interface Repository {
    full_name: string;
}

export const parseEmailToSlackMemberIDMapping = (mappingString: string): Record<string, string> => {
    return mappingString.split(',').reduce((acc, pair) => {
        const [email, slack] = pair.split(':');
        if (email && slack) {
            acc[email.trim()] = slack.trim();
        }
        return acc;
    }, {} as Record<string, string>);
};

export const processPullRequest = async (token: string, slackBotToken: string, githubEmailToSlack: string): Promise<void> => {
    try {
        const {
            context: {
                payload: {
                    pull_request: {
                        title,
                        html_url: prUrl,
                        labels
                    } = {} as PullRequest,
                    sender,
                    requested_reviewer: requestedReviewer,
                    requested_team: requestedTeam,
                    repository: {
                        full_name: repoName
                    } = {} as Repository
                }
            }
        } = github;

        if (!requestedReviewer) {
            core.notice(`Failed: 'requested_reviewer' does not exist. Looks like you've requested a team review which is not yet supported. The team name is '${requestedTeam.name}'.`);
            return;
        }

        const { login, url } = requestedReviewer;

        if (!sender) {
            throw new Error("Failed: 'sender' is undefined.");
        }

        core.notice(`Sender: ${sender.login}, Receiver: ${login}, PR: ${prUrl}`);
        core.info(`'${sender.login}' requests a pr review for ${title}(${prUrl})`);
        core.info(`Fetching information about '${login}'...`);

        const githubEmailToSlackMapping = parseEmailToSlackMemberIDMapping(githubEmailToSlack);

        // Fetch user email
        const { email } = await fetchUser(url, token);

        // Determine Slack username
        const slackMemberID = githubEmailToSlackMapping[email] || email.split("@")[0];

        core.info(`Sending a slack msg to '${slackMemberID}'...`);

        if (!email) {
            core.warning(`Failed: '${login}' has no public email.`);
            core.notice(`Failed: '${login}' has no public email.`);
            return;
        }

        if (!prUrl) {
            throw new Error("Failed: 'prUrl' is undefined.");
        }

        if (!repoName || !title || !prUrl || !email) {
            throw new Error("Missing required information to send Slack message.");
        }

        await sendReviewRequest({ repoName, labels, title, url: prUrl, slackMemberID }, slackBotToken);

        core.info("Successfully sent");
        core.notice("Successfully sent");
    } catch (error: any) {
        core.setFailed(error.message);
    }
};

run();

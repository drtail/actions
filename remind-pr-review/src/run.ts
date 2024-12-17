import * as core from '@actions/core'
import { processPullRequest } from './index'


export async function run(): Promise<void> {
    try {
        const token = core.getInput("token")
        const slackBotToken = core.getInput("slackBotToken")
        const githubEmailToSlack = core.getInput("githubEmailToSlack")
        await processPullRequest(token, slackBotToken, githubEmailToSlack)
    } catch (error) {
        if (error instanceof Error) {
            core.setFailed(error.message)
            core.notice(error.message)
        } else {
            core.setFailed("An unknown error occurred.")
            core.notice("An unknown error occurred.")
        }
    }
}
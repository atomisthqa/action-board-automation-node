import axios from 'axios';
import {
    CommandHandler,
    HandleCommand,
    HandlerContext,
    HandlerResult,
    Parameter,
    Tags,
    MappedParameter,
    MappedParameters,
    Secret,
    Secrets,
} from "@atomist/automation-client/Handlers";
import { logger } from "@atomist/automation-client/internal/util/Logger";
import * as slack from "@atomist/slack-messages/SlackMessages";
import { findLinkedRepositories, isWorkday, repositoryFromIssue, Repository, toEmoji, normalizeTimestamp, timeSince } from "./helpers";
import { whereAmIRunning } from './Provenance';
import { GitHubIssueResult, hasLabel, GitHubIssueSearchResult } from './GitHubApiTypes';
import { MessageOptions, buttonForCommand, MessageClient } from '@atomist/automation-client/spi/message/MessageClient';
import { globalActionBoardTracker } from './globalState';


const teamStream = "#team-stream";
const admin = "jessitron";
const gitHubIssueColor = "0f67da";
const inProgressLabelName = "in-progress";
const upNextLabelName = "up-next";

@CommandHandler("Presents a list of things to work on", "wazzup")
@Tags("jessitron")
export class ActionBoard implements HandleCommand {
    public static Name = "ActionBoard";

    @MappedParameter(MappedParameters.SLACK_CHANNEL)
    public channelId: string;

    @MappedParameter("atomist://github/username")
    public githubName: string;

    @Secret(Secrets.USER_TOKEN)
    public githubToken: string;


    public handle(ctx: HandlerContext): Promise<HandlerResult> {


        const triggeredByUser: boolean = true;
        const collapse: boolean = false;
        const ts = new Date().getTime();
        const channelId = this.channelId;
        const githubName = this.githubName;
        const githubToken = this.githubToken;

        const wazzupMessageId =
            `wazzup_${this.githubName}_${this.channelId}_${ts}`;

        ctx.messageClient.respond("I hear you. Gathering data...",
            { id: wazzupMessageId, ts: ts - 5 });


        return doWazzup(ctx,
            wazzupMessageId, channelId, githubName,
            githubToken, triggeredByUser, collapse).then(() => {
                globalActionBoardTracker.add({ wazzupMessageId, channelId, githubName, collapse });
                return Promise.resolve({ code: 0 });
            });
    }
}

@CommandHandler("Updates a list of things to work on", "update the wazzup message")
@Tags("jessitron")
export class ActionBoardUpdate implements HandleCommand {
    public static Name = "ActionBoardUpdate";

    @Parameter({ pattern: /^.*$/, required: true })
    public channelId: string;

    @Parameter({ pattern: /^.*$/, required: true })
    public githubName: string;

    @MappedParameter(MappedParameters.SLACK_USER_NAME)
    public slackName: string;

    @Parameter({ pattern: /^.*$/, required: true })
    public wazzupMessageId: string;

    @Parameter({ pattern: /^.*$/, required: false })
    public collapse: string = "false";

    @Secret(Secrets.USER_TOKEN)
    public githubToken: string;

    public handle(ctx: HandlerContext): Promise<HandlerResult> {

        const triggeredByUser: boolean = true;
        const collapse: boolean = this.collapse !== "false";
        const ts = new Date().getTime();

        return doWazzup(ctx,
            this.wazzupMessageId, this.channelId, this.githubName,
            this.githubToken, triggeredByUser, collapse,
            `Refresh requested by ${do_not_ping(this.slackName)}`).then(() => {
                return Promise.resolve({ code: 0 });
            });

    }
}
function do_not_ping(username: string): string {
    return username.replace(/[a-z]/, "$1 ");
}
/*
 Here is the graphql I should be using instead:
 {
  search(first:100, type: ISSUE, query: "assignee:jessitron") {
    nodes {
      ... on Issue {
        url
        number
        title
        repository { url }
        assignees(first: 100) {
          nodes {
          login
             avatarUrl(size: 75)
          }
        }
        author {
          login
          avatarUrl(size: 75)
        }
        state
        createdAt
        labels(first: 100) {
          nodes { name }
        }
        updatedAt
      }
    }
  }
}
*/

export function doWazzup(ctx: HandlerContext,
    wazzupMessageId: string,
    channelId: string,
    githubName: string,
    githubToken: string,
    triggeredByUser: boolean,
    collapse: boolean,
    provenanceMessage?: string,
): Promise<any> {

    function issues(): Promise<Activities> {
        const query = `assignee:${githubName}+state:open`;
        const htmlSearch = encodeURI(`https://github.com/search?q=${query}&type=Issues`);
        const apiSearch = encodeURI(`https://api.github.com/search/issues?q=${query}`);

        return axios.get(apiSearch,
            { headers: { Authorization: `token ${githubToken}` } }
        ).then((response) => {
            const result = response.data as GitHubIssueSearchResult;
            logger.info("Successfully got stuff from GitHub")

            // no results, sad day
            if (result.total_count === 0) {
                logger.info("No issues found tho");
                const summary: Summary = {
                    appearance: {
                        text: `There are no issues assigned to you (${this.githubName}) in GitHub.`,
                        fallback: "no issues for you"
                    }
                };
                return Promise.resolve({ summary, activities: [] })
            }

            logger.info("generating summary");
            const summary: Summary = {
                appearance: {
                    color: gitHubIssueColor,
                    text: `You have ${slack.url(htmlSearch, `${result.total_count} open issues on GitHub`)}.`,
                    fallback: "gh issue count"
                }
            };

            const linkedRepoPromise: Promise<Repository[]> = findLinkedRepositories(ctx, channelId);

            return linkedRepoPromise.then(linkedRepositories => {

                console.log("did find the linked repos");
                const activities: Activity[] = result.items.map(i => {
                    return {
                        priority: priority(linkedRepositories, i),
                        recency: normalizeTimestamp(i.updated_at),
                        current: hasLabel(i, inProgressLabelName),
                        appearance: renderIssue(i)
                    }
                });

                return Promise.resolve({ summary, activities })
            });
        }).catch(error => {
            const summary: Summary = {
                appearance: {
                    color: "FF0000",
                    text: "Error from GitHub: " + error,
                    fallback: "an error from GitHub",
                }
            }
            console.log((`****_________TRON: your failed token was ${githubToken}`))
            return ctx.messageClient.addressUsers(`Error doing ${apiSearch}: ${error}`, admin).
                then(z => Promise.resolve({ summary, activities: [] }))

        })
    };


    return Promise.all([whereAmIRunning(), issues()]).then(values => {

        const [provenance, issues] = values;
        console.log("ISSUE summary: " + JSON.stringify(issues.summary))
        console.log("ISSUE activites: " + JSON.stringify(issues.activities.length))
        const summaryAttachments = [issues.summary.appearance];
        const currentActivities = issues.activities.filter(a => a.current);
        const futureActivities = issues.activities.filter(a => !a.current);

        const currentAttachments = currentActivities.map(a => a.appearance);
        const futureAttachments = collapse ? [] : futureActivities.sort(priorityThenRecency).slice(0, 5).map(a => a.appearance);

        const text = currentActivities.length > 0 ? `You are currently working on ${
            currentActivities.length === 1 ? "one thing:" : currentActivities.length + " things"}`
            : 'Here are some things you could do.';

        const collapseButton = collapse ?
            buttonForCommand({ text: "Expand" },
                ActionBoardUpdate.Name, { githubName, channelId, wazzupMessageId, collapse: "false" }) :
            buttonForCommand({ text: "Collapse" },
                ActionBoardUpdate.Name, { githubName, channelId, wazzupMessageId, collapse: "true" })


        const maintenanceAttachments = [{
            fallback: "buttons to refresh",
            actions: [
                buttonForCommand({ text: "Refresh" },
                    ActionBoardUpdate.Name,
                    { githubName, channelId, wazzupMessageId }),
                collapseButton
            ]
        }]

        const provenanceAttachments = collapse ? [] : [{
            fallback: "provenance",
            footer: provenance + `\n ID ${wazzupMessageId}${provenanceMessage ? `\nlast update: ${provenanceMessage}` : ""}`
        }];

        const message: slack.SlackMessage = {
            text,
            attachments: currentAttachments.concat(
                summaryAttachments).concat(
                maintenanceAttachments).concat(
                futureAttachments).concat(
                provenanceAttachments)
        }

        const messageOptions: MessageOptions = {
            id: wazzupMessageId,
            ttl: null, // always update the message if it exists
            post:
            triggeredByUser ? "always" :
                "update_only"
        }

        return ctx.messageClient.respond(message, messageOptions)
    })
}

function priorityThenRecency(activity1: Activity, activity2: Activity): number {
    if (activity1.priority !== activity2.priority) {
        return activity2.priority - activity1.priority;
    }
    return activity2.recency - activity1.recency;
}

interface Activities {
    summary: Summary,
    activities: Activity[]
}
interface Summary {
    appearance: slack.Attachment
}

interface Activity {
    priority: number,
    recency: number,
    appearance: slack.Attachment,
    current: boolean
}

// higher is better
function priority(linkedRepositories: Repository[], issue: GitHubIssueResult): number {
    const repository = repositoryFromIssue(issue);

    let opinion = 0;
    let atWork = isWorkday();

    if (hasLabel(issue, upNextLabelName)) {
        // queued
        opinion += 11;
    }

    if (linkedRepositories.some(linked => repository.name === linked.name && repository.owner === linked.owner)) {
        // relevant to channel
        opinion += 10;
    }

    // work
    if (repository.owner === "atomisthq" && atWork) {
        opinion += 1;
    }
    if (repository.owner === "atomist" && atWork) {
        opinion += 2;
    }

    // work+personal both
    if (repository.name === "elm-rugs" && repository.owner === "satellite-of-love" && issue.user.login !== "jessitron") {
        if (atWork) {
            opinion += 9; // I really care about other people creating issues here
        } else {
            opinion += 15; // especially on weekends
        }
    }
    if (hasLabel(issue, "fun") && !atWork) {
        opinion += 8;
    }

    // test
    if (["spildrazil", "atm-osphere", "atm-near-me", "satellite-of-love"].some(testOrg => testOrg === repository.owner)) {
        opinion -= 5;
    }

    return opinion;
}



function renderIssue(issue: GitHubIssueResult): slack.Attachment {

    const issueTitle = `#${issue.number}: ${issue.title}`;
    const labels = issue.labels.map((label) => toEmoji(label.name)).join(" ");
    const title = `${labels} ${slack.url(issue.html_url, issueTitle)}`;
    const repository = repositoryFromIssue(issue);

    const attachment: slack.Attachment = {
        fallback: slack.escape(issueTitle),
        title,
        footer: `${slack.url(issue.html_url, repository.owner + "/" + repository.name)}`,
        ts: normalizeTimestamp(issue.updated_at),
        author_name: `by @${issue.user.login} ${timeSince(issue.created_at)}`, // todo: translate to slack?
        author_icon: issue.user.avatar_url,
        color: gitHubIssueColor,
        footer_icon: "http://images.atomist.com/rug/issue-open.png"
    };

    if (hasLabel(issue, inProgressLabelName)) {
        attachment.color = "#EF64E1";
        attachment.actions = [
            buttonForCommand({ text: "Postpone" }, PostponeWork.Name,
                { issueUrl: issue.url }, )
        ]
    } else {
        attachment.actions = [
            buttonForCommand({ text: "Commence" }, CommenceWork.Name,
                { issueUrl: issue.url }, )
        ]
    }

    return attachment;
}







@CommandHandler("Start work on a thing", "i am going to start work on an issue and i have the apiUrl")
@Tags("jessitron")
export class CommenceWork implements HandleCommand {
    public static Name = "CommenceWork";

    @MappedParameter(MappedParameters.SLACK_USER)
    public slackUser: string;

    @MappedParameter("atomist://github/username")
    public githubName: string;

    @Secret(Secrets.USER_TOKEN)
    public githubToken: string;

    @Parameter({ pattern: /^.*$/ })
    public issueUrl: string;

    public handle(ctx: HandlerContext): Promise<HandlerResult> {
        const issueUrl = this.issueUrl;
        const githubToken = this.githubToken;
        const slackUser = this.slackUser;

        ctx.messageClient.addressChannels(
            `${toEmoji(inProgressLabelName)} ${slack.user(slackUser)} is starting work on this issue: ` + this.issueUrl,
            teamStream);

        const addLabel = encodeURI(`${issueUrl}/labels`);

        return axios.post(addLabel,
            [inProgressLabelName],
            { headers: { Authorization: `token ${githubToken}` } }
        ).then((response) => {
            logger.info(`Successfully added a label to ${issueUrl}`)
            return Promise.resolve({ code: 0 })
        }).catch(error => {
            ctx.messageClient.respond(`Failed to add ${inProgressLabelName} label to ${issueUrl}.`)
            return Promise.resolve({ code: 1 })
        })
    }
}

@CommandHandler("Stop work on a thing", "i am going to stop work on an issue and i have the apiUrl")
@Tags("jessitron")
export class PostponeWork implements HandleCommand {
    public static Name = "PostponeWork";

    @MappedParameter(MappedParameters.SLACK_USER)
    public slackUser: string;

    @MappedParameter("atomist://github/username")
    public githubName: string;

    @Secret(Secrets.USER_TOKEN)
    public githubToken: string;

    @Parameter({ pattern: /^.*$/ })
    public issueUrl: string;

    public handle(ctx: HandlerContext): Promise<HandlerResult> {
        const issueUrl = this.issueUrl;
        const githubToken = this.githubToken;
        const slackUser = this.slackUser;

        ctx.messageClient.addressChannels(
            `${slack.user(slackUser)} postponed work on this issue: ` + this.issueUrl,
            teamStream);

        const addLabel = encodeURI(`${issueUrl}/labels/${inProgressLabelName}`);

        return axios.delete(addLabel,
            { headers: { Authorization: `token ${githubToken}` } }
        ).then((response) => {
            logger.info(`Successfully removed a label from ${issueUrl}`)
            return Promise.resolve({ code: 0 })
        }).catch(error => {
            ctx.messageClient.respond(`Failed to remove ${inProgressLabelName} label from ${issueUrl} ${error}`)
            return Promise.resolve({ code: 1 })
        })
    }
}

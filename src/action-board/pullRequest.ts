
import * as slack from "@atomist/slack-messages/SlackMessages";
import { toEmoji, Repository, Summary, gitHubPullRequestColor, Activities, normalizeTimestamp, Activity, inProgressLabelName, isWorkday, upNextLabelName } from "./helpers";
import axios from "axios";
import { logger } from "@atomist/automation-client/internal/util/logger";
import { buttonForCommand } from "@atomist/automation-client/spi/message/MessageClient";
import { PostponeWork } from "./PostponeWork";
import { CloseIssue } from "./Complete";
import { CommenceWork } from "./Commence";
import { Unassign } from "./Unassign";
import * as GraphQL from "@atomist/automation-client/graph/graphQL";
import * as graphql from "../../typings/github/types"

const graphQlQuery = GraphQL.subscriptionFromFile("github-graphql/MyOpenPR.graphql");


export function myOpenPullRequests(githubToken: string,
    githubLogin: string,
    linkedRepos: Promise<Repository[]>):
    Promise<Activities> {
    const searchQuery = `is:pr author:${githubLogin} state:open`;
    const htmlSearch = encodeURI(`https://github.com/search?q=${searchQuery}&type=Issues`);
    const apiSearch = encodeURI(`https://api.github.com/graphql`);

    return axios.post(apiSearch,
        { query: graphQlQuery, variables: { q: searchQuery } },
        { headers: { Authorization: `bearer ${githubToken}` } }
    ).then((response) => {
        console.log("Got back: " + JSON.stringify(response.data))
        if (!response.data.data) {
            const summary: Summary = {
                appearance: {
                    color: "FF0000",
                    text: `Errors from GitHub's graphql: ${JSON.stringify(response.data.errors)}`,
                    fallback: "no PRs for you"
                }
            };
            return Promise.resolve({ summary, activities: [] })
        }
        const result = (response.data.data as graphql.MyOpenPullRequests.Query).search;
        logger.info("Successfully got PRs from GitHub");

        // no results, sad day
        if (result.issueCount === 0) {
            logger.info("No PRs found tho");
            const summary: Summary = {
                appearance: {
                    color: gitHubPullRequestColor,
                    text: `You (${this.githubName}) have no open PRs in GitHub.`,
                    fallback: "no PRs for you"
                }
            };
            return Promise.resolve({ summary, activities: [] })
        }

        logger.info("generating summary");
        const summary: Summary = {
            appearance: {
                color: gitHubPullRequestColor,
                text: `You have ${slack.url(htmlSearch, `${result.issueCount} open pull requests on GitHub`)}.`,
                fallback: "gh PR count"
            }
        };

        return linkedRepos.then(linkedRepositories => {

            console.log("did find the linked repos");
            const activities: Activity[] = result.nodes.map(i => {
                return {
                    identifier: i.url,
                    priority: priority(linkedRepositories, i),
                    recency: normalizeTimestamp(i.updatedAt),
                    current: hasLabel(i, inProgressLabelName),
                    appearance: renderPullRequest(i)
                }
            });

            return Promise.resolve({ summary, activities })
        });
    }).catch(error => {
        console.log((error as Error).stack)
        console.log("Error is " + JSON.stringify(error));
        const summary: Summary = {
            appearance: {
                color: "FF0000",
                text: "Error from GitHub retrieving PRs: " + error,
                fallback: "an error from GitHub",
            }
        }
        return { summary, activities: [] }
    })
};

function renderPullRequest(pr: graphql.MyOpenPullRequests.PullRequestInlineFragment): slack.Attachment {

    const issueTitle = `#${pr.number}: ${pr.title}`;
    const labels = (pr.labels.nodes || []).map((label) => toEmoji(label.name)).join(" ");
    const title = `${labels} ${slack.url(pr.url, issueTitle)}`;
    const repository = pr.repository;

    const attachment: slack.Attachment = {
        fallback: slack.escape(issueTitle),
        title,
        footer: `${slack.url(pr.url, repository.owner.login + "/" + repository.name)}`,
        ts: normalizeTimestamp(pr.updatedAt),
        color: gitHubPullRequestColor,
        footer_icon: "http://images.atomist.com/rug/issue-open.png"
    };

    const apiUrl = `http://api.github.com/repos/${pr.repository.owner.login}/${pr.repository.name}/pulls/${pr.number}`
    if (hasLabel(pr, inProgressLabelName)) {
        attachment.color = "#EF64E1";
        attachment.actions = [
            buttonForCommand({ text: "Postpone" }, PostponeWork.Name,
                { issueUrl: apiUrl }, ),
        ]
    } else {
        attachment.actions = [
            buttonForCommand({ text: "Commence" }, CommenceWork.Name,
                { issueUrl: apiUrl }),
            buttonForCommand({ text: "Forget it" }, CloseIssue.Name,
                { issueUrl: apiUrl })
        ]
    }

    return attachment;
}

// higher is better
function priority(linkedRepositories: Repository[], pr: graphql.MyOpenPullRequests.PullRequestInlineFragment): number {
    const repository = pr.repository;
    const owner = repository.owner.login;

    let opinion = 1; // default is higher than issues
    let atWork = isWorkday();

    if (hasLabel(pr, upNextLabelName)) {
        // queued
        opinion += 11;
    }

    if (linkedRepositories.some(linked => repository.name === linked.name && owner === linked.owner)) {
        // relevant to channel
        opinion += 10;
    }

    // work
    if (owner === "atomisthq" && atWork) {
        opinion += 4;
    }
    if (owner === "atomist" && atWork) {
        opinion += 6;
    }

    // work+personal both
    if (repository.name === "elm-rugs" && owner === "satellite-of-love") {
        if (atWork) {
            opinion += 4; // I really care about PRs here
        } else {
            opinion += 6; // especially on weekends
        }
    }
    if (hasLabel(pr, "fun") && !atWork) {
        opinion += 8;
    }

    const myTestTeams = ["spildrazil",
        "atm-osphere",
        "atm-near-me",
        "atm-bankomat",
        "satellite-of-love"];
    if (myTestTeams.some(testOrg => testOrg === owner)) {
        opinion -= 5;
    }

    return opinion;
}

function hasLabel(item: graphql.MyOpenPullRequests.PullRequestInlineFragment,
    labelName: string): boolean {
    return item.labels.nodes.some(l => l.name === labelName)
}
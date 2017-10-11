
import * as slack from "@atomist/slack-messages/SlackMessages";
import { toEmoji, Repository, Summary, gitHubPullRequestColor, Activities, normalizeTimestamp, Activity, inProgressLabelName, isWorkday, upNextLabelName } from "./helpers";
import axios from "axios";
import { logger } from "@atomist/automation-client/internal/util/logger";
import { buttonForCommand } from "@atomist/automation-client/spi/message/MessageClient";
import { PostponeWork } from "./PostponeWork";
import { CloseIssue } from "./Complete";
import { CommenceWork } from "./Commence";
import { Unassign } from "./Unassign";

const query = `query myOpenPullRequests($q: String!) {
  search(first:10, type: ISSUE, query: $q) {
    nodes {
      ... on PullRequest {
        url
        number
        title
        repository { name owner { login } }
        headRef {
          target {
            ... on Commit {
              commitUrl
              status {
                state
                contexts {
                  context
                  targetUrl
                  state
                } 
              }
            }
          }
        }
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
        reviews(first:10) {
          nodes {
            author {
              login
            }
            state
          }
        }
        createdAt
        labels(first: 100) {
          nodes { name }
        }
        updatedAt
      }
    }
  }
}
`;


function pullRequests(githubToken: string,
    githubLogin: string,
    linkedRepos: Promise<Repository[]>):
    Promise<Activities> {
    const query = `is:pr+author:${githubLogin}+state:open`;
    const htmlSearch = encodeURI(`https://github.com/search?q=${query}&type=Issues`);
    const apiSearch = encodeURI(`https://api.github.com/search/pr?q=${query}`);

    return axios.get(apiSearch,
        { headers: { Authorization: `token ${githubToken}` } }
    ).then((response) => {
        const result = response.data;
        logger.info("Successfully got PRs from GitHub")

        // no results, sad day
        if (result.total_count === 0) {
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
                text: `You have ${slack.url(htmlSearch, `${result.total_count} open pull requests on GitHub`)}.`,
                fallback: "gh PR count"
            }
        };

        return linkedRepos.then(linkedRepositories => {

            console.log("did find the linked repos");
            const activities: Activity[] = result.items.map(i => {
                return {
                    identifier: i.url,
                    priority: priority(linkedRepositories, i),
                    recency: normalizeTimestamp(i.updated_at),
                    current: hasLabel(i, inProgressLabelName),
                    appearance: renderPullRequest(i)
                }
            });

            return Promise.resolve({ summary, activities })
        });
    }).catch(error => {
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

function renderPullRequest(pr: any): slack.Attachment {

    const issueTitle = `#${pr.number}: ${pr.title}`;
    const labels = pr.labels.map((label) => toEmoji(label.name)).join(" ");
    const title = `${labels} ${slack.url(pr.html_url, issueTitle)}`;
    const repository = pr.repository;

    const attachment: slack.Attachment = {
        fallback: slack.escape(issueTitle),
        title,
        footer: `${slack.url(pr.html_url, repository.owner + "/" + repository.name)}`,
        ts: normalizeTimestamp(pr.updated_at),
        color: gitHubPullRequestColor,
        footer_icon: "http://images.atomist.com/rug/issue-open.png"
    };

    if (hasLabel(pr, inProgressLabelName)) {
        attachment.color = "#EF64E1";
        attachment.actions = [
            buttonForCommand({ text: "Postpone" }, PostponeWork.Name,
                { issueUrl: pr.url }, ),
            buttonForCommand({ text: "Complete!" }, CloseIssue.Name,
                { issueUrl: pr.url })
        ]
    } else {
        attachment.actions = [
            buttonForCommand({ text: "Commence" }, CommenceWork.Name,
                { issueUrl: pr.url }),
            buttonForCommand({ text: "Unassign me" }, Unassign.Name,
                { issueUrl: pr.url })
        ]
    }

    return attachment;
}

// higher is better
function priority(linkedRepositories: Repository[], pr: any): number {
    const repository = pr.repository;

    let opinion = 0;
    let atWork = isWorkday();

    if (hasLabel(pr, upNextLabelName)) {
        // queued
        opinion += 11;
    }

    if (linkedRepositories.some(linked => repository.name === linked.name && repository.owner === linked.owner)) {
        // relevant to channel
        opinion += 10;
    }

    // work
    if (repository.owner === "atomisthq" && atWork) {
        opinion += 4;
    }
    if (repository.owner === "atomist" && atWork) {
        opinion += 6;
    }

    // work+personal both
    if (repository.name === "elm-rugs" && repository.owner === "satellite-of-love") {
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
    if (myTestTeams.some(testOrg => testOrg === repository.owner)) {
        opinion -= 5;
    }

    return opinion;
}

function hasLabel(item: { labels: { nodes: { name: string }[] } },
    labelName: string): boolean {
    return item.labels.nodes.some(l => l.name === labelName)
}
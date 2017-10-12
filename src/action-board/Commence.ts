
import * as slack from "@atomist/slack-messages/SlackMessages";
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
import { inProgressLabelName, toEmoji, teamStream } from "./helpers";
import { logger } from "@atomist/automation-client/internal/util/logger";

@CommandHandler("Start work on a thing", "i am going to start work on an issue and i have the apiUrl")
@Tags("jessitron")
export class CommenceWork implements HandleCommand {
    public static Name = "CommenceWork";

    @MappedParameter(MappedParameters.SlackUser)
    public slackUser: string;

    @MappedParameter("atomist://github/username")
    public githubName: string;

    @Secret(Secrets.UserToken)
    public githubToken: string;

    @Parameter({ pattern: /^.*$/ })
    public issueUrl: string;

    @Parameter({ pattern: /^.*$/ })
    public htmlUrl: string;

    public handle(ctx: HandlerContext): Promise<HandlerResult> {
        const issueUrl = this.issueUrl;
        const githubToken = this.githubToken;
        const slackUser = this.slackUser;
        const htmlUrl = this.htmlUrl;

        ctx.messageClient.addressChannels(
            `${toEmoji(inProgressLabelName)} ${slack.user(slackUser)} is starting work on: ` + this.htmlUrl,
            teamStream);

        const addLabel = encodeURI(`${issueUrl}/labels`);

        console.log("Posting to: " + addLabel);
        return axios.post(addLabel,
            [inProgressLabelName],
            { headers: { Authorization: `token ${githubToken}` } }
        ).then((response) => {
            logger.info(`Successfully added a label to ${issueUrl}`)
            return Promise.resolve({ code: 0 })
        }).catch(error => {
            console.log(`Failure ${addLabel}: ${JSON.stringify(error.message)}`)
            ctx.messageClient.respond(`Failed to add ${inProgressLabelName} label to ${htmlUrl}: ${error.message}`)
            return Promise.resolve({ code: 1, message: error.message })
        })
    }
}

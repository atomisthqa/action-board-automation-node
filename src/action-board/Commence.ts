
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

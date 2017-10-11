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
import { inProgressLabelName, teamStream } from './helpers';
import { logger } from '@atomist/automation-client/internal/util/logger';

import * as slack from "@atomist/slack-messages/SlackMessages";

@CommandHandler("Stop work on a thing", "i am going to stop work on an issue and i have the apiUrl")
@Tags("jessitron")
export class PostponeWork implements HandleCommand {
    public static Name = "PostponeWork";

    @MappedParameter(MappedParameters.SlackUser)
    public slackUser: string;

    @MappedParameter("atomist://github/username")
    public githubName: string;

    @Secret(Secrets.UserToken)
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

        const labelResource = encodeURI(`${issueUrl}/labels/${inProgressLabelName}`);

        return axios.delete(labelResource,
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


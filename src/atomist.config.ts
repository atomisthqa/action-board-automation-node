import { Configuration } from "@atomist/automation-client/configuration";
import { NotifyOnPush } from "./events/NotifyOnPush";
import { ActionBoard, ActionBoardUpdate } from "./action-board/ActionBoard";

import * as cfenv from "cfenv";
import { UpdateActionBoardsOnIssue } from "./action-board/UpdateActionBoardsOnIssue";
import { Unassign } from "./action-board/Unassign";
import { CloseIssue } from "./action-board/Complete";
import { PostponeWork } from "./action-board/PostponeWork";
import { CommenceWork } from "./action-board/Commence";

const pj = require("../../package.json");


const token = process.env.GITHUB_TOKEN;
const host = "https://automation-staging.atomist.services";


export const configuration: Configuration = {
    name: "action-board",
    version: pj.version,
    teamIds: "T1L0VDKJP",
    commands: [
        () => new ActionBoard(),
        () => new ActionBoardUpdate(),
        () => new CommenceWork(),
        () => new PostponeWork(),
        () => new Unassign(),
        () => new CloseIssue(),
    ],
    events: [
        () => new UpdateActionBoardsOnIssue(),
    ],
    token,
    http: {
        enabled: true,
        auth: {
            basic: {
                enabled: false,
            },
            bearer: {
                enabled: false,
            },
        },
    },
    endpoints: {
        graphql: `${host}/graphql/team`,
        api: `${host}/registration`,
    },
};

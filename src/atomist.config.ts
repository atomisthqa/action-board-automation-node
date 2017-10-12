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

const appEnv = cfenv.getAppEnv();
const githubCreds = appEnv.getServiceCreds("github-token");
const dashboardCreds = appEnv.getServiceCreds("dashboard-credentials");

const token = githubCreds ? githubCreds.token : process.env.GITHUB_TOKEN;

export const configuration: Configuration = {
    name: "action-board",
    version: pj.version,
    teamIds: "T095SFFBK",
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
            basic: appEnv.isLocal ? { enabled: false } : {
                enabled: true,
                username: dashboardCreds.user,
                password: dashboardCreds.password,
            },
            bearer: {
                enabled: false,
            },
        },
    },
};

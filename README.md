# Action Board

Want to know what to work on next?
Forget what you were doing when you left work last Friday? Action Board can help!
Now you can ask in slack "@atomist_bot wazzup" and see a list of issues assigned to you
plus open PRs you created. You even get buttons to do things with them!

TODO: get a nice picture

# How
This is an [Atomist automation client](https://github.com/atomist/automation-client-ts).

TODO: run it in community

You can run your own version of it, and customize your priority scheme for picking your top so-many tasks to show.

   * Invite [Atomist](https://atomist.com) to your Slack
   * Clone this repository
   * Change the team ID in atomist.setup.ts to your TEAM ID
   * create a GitHub token with read:org permission; put it in a GITHUB_TOKEN environment variable.
   * `npm run start`
   
OK actually there are prereqs like git, ts, node, as described in [Atomist automation client](https://github.com/atomist/automation-client-ts)).

Now go to Slack and try "@atomist_bot wazzup". It'll use your GitHub token to fetch issues and pull requests. You can close them (Complete) or unassign them, or mark them with an in-progress label (Commence) and they'll show up at the top.

If you've set up an Atomist webhook in GitHub (@atomist_bot install org webhook), then any time an issue is assigned to you, or one of these is updated, or you open a new PullRequest etc, the action board message will update!

For updates to issues in other orgs, or if the webhook isn't there, click Refresh to update the message in place.

// TODO: update on pull request? do I get those?

# Change stuff

there's a `priority` function in ActionBoard.ts and also in pullRequest.ts, which decide which issues and PRs go to the top of the list. Tweak this to your personal preferences.

# Deploy for real

Running locally is fun, but running the automation somewhere people can access it all the time is even more fun. 

## authorization

Atomist stores GitHub tokens for every user in your slack team who authorizes Atomist with GitHub. That lets Atomist do things like merging PRs, creating issues (@atomist_bot create issue), etc as that user.

Anyone can run an automation client on their laptop and request the github token of the user who said "@atomist_bot wazzup" or clicked a button (like in ActionBoard.ts[LINK]). For security, Atomist won't give everybody's github tokens to your local client; it gives you your own token instead.  

For a real deployment, create a team in your GitHub org called `atomist-automation`, and use a GITHUB_TOKEN that belongs to someone in that team. This tells Atomist that the client is allowed to receive each user's github tokens. That'll help when other people say "@atomist wazzup"; they'll see issues from all their orgs, and when they click "Commence" it is their github user who adds the label.

// TODO footers and stuff


# Checklist for connecting a real agent

No test can connect a real agent, so the owner runs this checklist by hand after a deploy that changes sign-in or the MCP server. The Connect your agents screen gives the steps for Claude and Cursor.

Connect each agent:

- **Claude** (the app, and Claude cloud sessions). Add a custom connector, paste the server address from the Connect screen, and approve askme when Claude asks you to sign in.
- **Claude Code on its own.** Run `claude mcp add --transport http --scope user askme <MCP endpoint>`, then choose Authenticate under `/mcp`.
- **Cursor.** On the computer where Cursor is installed, open the Connect screen and click "Add askme to Cursor". Cursor offers to add a server named askme. Sign in to approve it.
- **VS Code.** Use the "Add askme to VS Code" button in the README, or run `code --add-mcp '{"name":"askme","type":"http","url":"<MCP endpoint>"}'`. Sign in when VS Code asks.

Then, for each agent:

- [ ] The agent lists two tools, `ask` and `resolve`, and no others.
- [ ] It posts an ask, and the card appears on the page within a few seconds, on a phone.
- [ ] The card's main button opens the agent's session. A card with no link has no main button, and tapping it opens the ask's detail.
- [ ] You reply in the session, the agent resolves the ask, and the card clears.

## Results

On 12 October 2026 the whole checklist passed for a Claude cloud session and a local Cursor agent. On 11 October, Claude Code on a laptop and in the Claude desktop app connected and called `ask`. On 14 October, VS Code connected through its install link, once [#417](https://github.com/t-d-d/askme-mcp/issues/417) was fixed.

The checklist has not been run with a Cursor cloud agent. Those need a paid plan, which the owner does not have, so nobody has seen whether a Cursor cloud agent's session link opens. The demo works without it, because a card with no link opens its detail.

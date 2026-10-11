// What every agent is told about using askme (PRD, "MCP server"). The
// server sends it as its instructions, and the tool descriptions repeat it,
// because not every client passes server instructions on. It is the same
// for every account (ADR 2), so it is written once, here, as constants.

export const guidance = {
  post: "Post an ask whenever your work stops to wait for the person. An ask that is cleared costs them nothing, so post freely.",
  several: "One session may hold several open asks, so keep the id of each.",
  resolve:
    "Resolve each ask as soon as its wait is over, before doing anything else, whether the person replied or the thing you were waiting for happened, such as a pull request being merged.",
  replace:
    "When an ask changes, post the new one with replaces set to the old one's id, and the old one closes.",
  ownSession:
    "Whatever askme answers, still ask your question in your own session.",
} as const;

export const instructions = [
  "askme is one list where all of a person's agents ask for their input.",
  guidance.post,
  guidance.several,
  guidance.resolve,
  guidance.replace,
  guidance.ownSession,
].join(" ");

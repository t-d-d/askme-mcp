// Where an ask's buttons lead, and what they say. askme knows only a link's
// address, so a button's words come from its shape and never from anything
// the agent wrote (docs/design.md, "What the main button says").

// What the main button says when it leads back to the agent's session.
export const sessionLabel = "Reply in the session";

// The site a link leads to, as the browser reads its host, without "www.".
// A host in another script stays in the form the browser spells it, so it
// cannot pass for a familiar one.
export function siteOf(link: string): string {
  return new URL(link).hostname.replace(/^www\./u, "");
}

// The shapes askme recognises: a GitHub pull request or issue, by number.
const shapes = [
  { kind: "pull", label: "See pull request" },
  { kind: "issues", label: "See issue" },
] as const;

// What the main button says for an action link: what it is, when askme
// recognises its shape, and otherwise the site it goes to.
export function actionLabel(link: string): string {
  const site = siteOf(link);
  if (site === "github.com") {
    const [owner, repo, kind, number] = new URL(link).pathname
      .split("/")
      .slice(1);
    const shape = shapes.find((known) => known.kind === kind);
    if (
      shape !== undefined &&
      owner !== undefined &&
      owner !== "" &&
      repo !== undefined &&
      repo !== "" &&
      number !== undefined &&
      /^\d+$/u.test(number)
    ) {
      return shape.label;
    }
  }
  return `Go to ${site}`;
}

export interface Destination {
  href: string;
  label: string;
  site: string;
}

// Where an ask's buttons lead. The main button opens the action link, or
// the session link when there is none. An ask with both has a second
// control for the session. An ask with neither has nowhere to lead, and
// opens its card.
export function destinations({
  actionLink,
  sessionLink,
}: {
  actionLink?: string | undefined;
  sessionLink?: string | undefined;
}): { main?: Destination; session?: Destination } {
  const session =
    sessionLink === undefined
      ? undefined
      : { href: sessionLink, label: sessionLabel, site: siteOf(sessionLink) };
  if (actionLink === undefined) {
    return session === undefined ? {} : { main: session };
  }
  const main = {
    href: actionLink,
    label: actionLabel(actionLink),
    site: siteOf(actionLink),
  };
  return session === undefined ? { main } : { main, session };
}

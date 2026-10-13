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

// Whether a site's name is long enough to take smaller type on the top
// card's main button, so it stays whole on one line beside the Listen and
// session buttons. Fifteen characters fit at the usual size on a narrow
// phone.
export function longSite(site: string): boolean {
  return site.length > 15;
}

// A site's name in the parts it may break between, each ending in its dot.
// A name too long for one line breaks only after a dot, so no part of it is
// split, and its end stays whole.
export function siteParts(site: string): string[] {
  return site.split(/(?<=\.)/u);
}

// The shapes askme recognises: a GitHub pull request or issue, by number.
const shapes = [
  { kind: "pull", label: "Pull request" },
  { kind: "issues", label: "Issue" },
] as const;

// What the main button says for an action link: what it is, when askme
// recognises its shape, and otherwise only "Open", since the button's
// second line already names the site.
export function actionLabel(link: string): string {
  if (siteOf(link) === "github.com") {
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
  return "Open";
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

// A button's words come from its link's shape and never from anything the
// agent wrote (docs/design.md, "What the main button says").

export const sessionLabel = "Reply in the session";

// The browser gives a host in another script in its xn-- form, so it cannot
// pass for a familiar one.
export function siteOf(link: string): string {
  return new URL(link).hostname.replace(/^www\./u, "");
}

// Past 15 characters the top card's main button takes smaller type, so the
// name stays on one line beside Listen and the session button on a phone.
export function longSite(site: string): boolean {
  return site.length > 15;
}

// Each part ends in its dot, so a long name breaks after a dot and its end
// stays whole.
export function siteParts(site: string): string[] {
  return site.split(/(?<=\.)/u);
}

const shapes = [
  { kind: "pull", label: "Pull request" },
  { kind: "issues", label: "Issue" },
] as const;

// "Open" alone otherwise, since the button's second line names the site.
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

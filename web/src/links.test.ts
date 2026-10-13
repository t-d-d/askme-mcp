import { describe, expect, it } from "vitest";
import {
  actionLabel,
  destinations,
  longSite,
  sessionLabel,
  siteOf,
  siteParts,
} from "./links";

describe("the site a link leads to", () => {
  it.each([
    ["https://github.com/t-d-d/askme-mcp/pull/12", "github.com"],
    ["https://www.github.com/t-d-d/askme-mcp/pull/12", "github.com"],
    ["https://claude.ai/code/session_01AbC", "claude.ai"],
    ["https://linear.app/team/issue/ABC-1", "linear.app"],
    ["https://app.example.co.uk:8443/a?b=c#d", "app.example.co.uk"],
    ["https://GitHub.com/a/b", "github.com"],
  ])("is the host of %s, without www.", (link, site) => {
    expect(siteOf(link)).toBe(site);
  });

  it("shows a host in another script as the browser spells it, so it cannot pass for another", () => {
    // A Cyrillic letter that looks like the Latin i.
    expect(siteOf("https://g\u0456thub.com/a")).toBe("xn--gthub-n2e.com");
  });
});

describe("a long site name", () => {
  it.each(["github.com", "claude.ai", "docs.google.com"])(
    "is not %s, of 15 characters or fewer",
    (site) => {
      expect(longSite(site)).toBe(false);
    },
  );

  it.each([
    "admin.google.com",
    "dash.cloudflare.com",
    "console.aws.amazon.com",
  ])("is %s, of more than 15 characters", (site) => {
    expect(longSite(site)).toBe(true);
  });
});

describe("the places a site's name may break", () => {
  it.each([
    ["console.aws.amazon.com", ["console.", "aws.", "amazon.", "com"]],
    ["github.com", ["github.", "com"]],
    ["localhost", ["localhost"]],
    ["a.a.com", ["a.", "a.", "com"]],
  ])("split %s just after each dot", (site, parts) => {
    expect(siteParts(site)).toEqual(parts);
  });
});

describe("what the main button says for an action link", () => {
  it.each([
    "https://github.com/t-d-d/askme-mcp/pull/12",
    "https://github.com/t-d-d/askme-mcp/pull/12/files",
    "https://github.com/t-d-d/askme-mcp/pull/12#discussion_r1",
    "https://www.github.com/t-d-d/askme-mcp/pull/12",
  ])("is Pull request for %s", (link) => {
    expect(actionLabel(link)).toBe("Pull request");
  });

  it.each([
    "https://github.com/t-d-d/askme-mcp/issues/7",
    "https://github.com/t-d-d/askme-mcp/issues/7#issuecomment-1",
  ])("is Issue for %s", (link) => {
    expect(actionLabel(link)).toBe("Issue");
  });

  it.each([
    "https://github.com/t-d-d/askme-mcp/pulls",
    "https://github.com/t-d-d/askme-mcp/pull/new",
    "https://github.com/t-d-d/askme-mcp/issues",
    "https://github.com/t-d-d/pull/12",
    "https://gist.github.com/a/b/pull/1",
    "https://github.com.example.net/a/b/pull/1",
    "https://linear.app/team/issue/ABC-1",
  ])(
    "is Open for any other link, such as %s, since the second line names the site",
    (link) => {
      expect(actionLabel(link)).toBe("Open");
    },
  );

  it("never uses words from the link itself", () => {
    expect(
      actionLabel("https://example.com/Approve%20now?label=Pull+request"),
    ).toBe("Open");
  });
});

describe("where an ask's buttons lead", () => {
  const action = "https://github.com/t-d-d/askme-mcp/pull/12";
  const session = "https://claude.ai/code/session_01AbC";

  it("leads the main button to the action link, with a second control for the session, when the ask has both", () => {
    expect(destinations({ actionLink: action, sessionLink: session })).toEqual({
      main: { href: action, label: "Pull request", site: "github.com" },
      session: { href: session, label: sessionLabel, site: "claude.ai" },
    });
  });

  it("leads the main button to the action link alone", () => {
    expect(destinations({ actionLink: action })).toEqual({
      main: { href: action, label: "Pull request", site: "github.com" },
    });
  });

  it("leads the main button to the session link when there is no action link", () => {
    expect(destinations({ sessionLink: session })).toEqual({
      main: { href: session, label: "Reply in the session", site: "claude.ai" },
    });
  });

  it("has nowhere to lead when the ask has no link", () => {
    expect(destinations({})).toEqual({});
  });
});

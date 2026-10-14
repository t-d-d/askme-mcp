// The asks tests share, so a new field is added in one place: one as an
// agent sends it to the ask tool, and one as the page's API lists it.
import type { PageAsk } from "../shared/page-api";

// A valid ask with only the fields the tool requires. A test that needs more
// spreads it: { ...agentAsk, action_link: "https://..." }. Frozen, as files
// use it as it is, so one test cannot change it for the tests after it.
export const agentAsk: Readonly<
  Record<"summary" | "area" | "spoken_detail", string>
> = Object.freeze({
  summary: "Approve the plan for the kitchen rewiring",
  area: "Home renovation",
  spoken_detail: "The electrician needs a yes or no before Friday.",
});

// An unsorted ask, just posted, unless more says otherwise.
export function pageAsk(more: Partial<PageAsk> = {}): PageAsk {
  const id = more.id ?? "ask_1";
  const summary = more.summary ?? `Ask ${id}`;
  return {
    id,
    summary,
    spokenDetail: `The spoken detail of ${summary}`,
    postedAt: new Date().toISOString(),
    opened: false,
    sort: null,
    ...more,
  };
}

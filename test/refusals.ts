// The words of a refusal that names a rate limit, as the page and an agent
// receive them, from a store that counts every call as over its limit. The
// tests that use it read the whole message, so a change to any word of it,
// such as "1 seconds" or a window's words, fails them (#224).
import { z } from "zod";
import { askTool } from "../service/src/ask";
import { servePage } from "../service/src/api";
import { callerOf } from "../service/src/identity";
import type { Logger } from "../service/src/log";
import type { PageRoute } from "../service/src/routes";
import type { Store } from "../service/src/store/store";

const unused = () => Promise.reject(new Error("Not used here."));

// Every count is refused with this many seconds left in its window.
const refusingStore = (secondsLeft: number): Store => {
  const refused = () =>
    Promise.resolve({ counted: false as const, secondsLeft });
  return {
    postAsk: unused,
    resolveAsk: unused,
    markOpened: unused,
    dismissAsk: unused,
    openAsks: unused,
    asksSince: unused,
    countCall: unused,
    countPoll: refused,
    countAsk: refused,
    rules: unused,
    saveRules: unused,
    resaveRules: unused,
    countRulesSave: refused,
    countModelCall: unused,
    modelCapSpent: unused,
    recordModelCapReset: unused,
    askToSort: unused,
    recordSort: unused,
    close: () => undefined,
  };
};

const caller = callerOf({
  token: "test",
  clientId: "test",
  scopes: ["asks:create"],
  extra: { accountId: "user_1", requestId: "req-1" },
});

const quiet: Logger = {
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
};

const refusalSchema = z.object({ code: z.string(), message: z.string() });

// The page's refusal of a call to a route, every count being over its limit.
export async function pageRefusalOf(
  route: PageRoute,
  secondsLeft: number,
): Promise<z.infer<typeof refusalSchema>> {
  const [method = "GET", path = "/"] = route.split(" ");
  const request = new Request(`https://askme.test${path}`, {
    method,
    headers: { authorization: "Bearer test" },
    ...(method === "PUT" ? { body: JSON.stringify({ text: "" }) } : {}),
  });
  const response = await servePage(route, request, {
    origin: "https://askme.test",
    verify: () => Promise.resolve(caller.accountId),
    store: refusingStore(secondsLeft),
    sorts: { queue: unused },
    model: { forAccount: () => ({ reply: unused }), spent: unused },
    log: quiet,
  });
  return refusalSchema.parse(await response.json());
}

// The ask tool's refusal of a call, the count being over its limit.
export async function askRefusalOf(
  secondsLeft: number,
): Promise<z.infer<typeof refusalSchema>> {
  const answer = await askTool.run(
    {
      summary: "Approve the plan",
      area: "Home",
      spoken_detail: "The electrician needs a yes or no.",
    },
    {
      caller,
      log: quiet,
      store: refusingStore(secondsLeft),
      sorts: { queue: unused },
    },
  );
  return refusalSchema.parse(answer);
}

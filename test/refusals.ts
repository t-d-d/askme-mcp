// A rate limit refusal as the page and an agent receive it, from a store
// that refuses every count.
import { z } from "zod";
import { askTool } from "../service/src/ask";
import { servePage } from "../service/src/api";
import type { Logger } from "../service/src/log";
import type { PageRoute } from "../service/src/routes";
import { agentAsk } from "./asks";
import { testCaller } from "./caller";
import { fakeStore } from "./fake-store";

const unused = () => Promise.reject(new Error("Not used here."));

const refusingStore = (secondsLeft: number) =>
  fakeStore({
    countCall: () => Promise.resolve({ counted: false as const, secondsLeft }),
  });

const caller = testCaller();

const quiet: Logger = {
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
};

const refusalSchema = z.object({ code: z.string(), message: z.string() });

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

export async function askRefusalOf(
  secondsLeft: number,
): Promise<z.infer<typeof refusalSchema>> {
  const answer = await askTool.run(agentAsk, {
    caller,
    log: quiet,
    store: refusingStore(secondsLeft),
    sorts: { queue: unused },
  });
  return refusalSchema.parse(answer);
}

// The real model, as the evals reach it.
//
// On a laptop they send the eval key from OPENROUTER_API_KEY. In a Claude
// cloud session they send no key: the key is a network secret, added to
// requests for openrouter.ai after they leave the session, through the
// session's proxy. `npm run eval` sets NODE_USE_ENV_PROXY=1, so Node's own
// fetch goes through that proxy.
import {
  createModel,
  ModelFailed,
  openRouterEndpoint,
  type Model,
} from "../service/src/model";

const env = process.env;
const cloud = env.CLAUDE_CODE_REMOTE === "true";

const proxy = [env.HTTPS_PROXY, env.https_proxy, env.HTTP_PROXY, env.http_proxy]
  .filter((value) => value !== undefined && value !== "")
  .at(0);

// Node routes fetch through HTTPS_PROXY only with NODE_USE_ENV_PROXY=1, from
// 22.21 on the 22 line and from 24.0.
function nodeUsesProxy(): boolean {
  const [major = 0, minor = 0] = process.versions.node.split(".").map(Number);
  const supported = major === 22 ? minor >= 21 : major >= 24;
  return supported && env.NODE_USE_ENV_PROXY === "1";
}

// The models a value of EVAL_MODELS names, separated by commas, or none.
export const modelsNamed = (value: string | undefined): string[] =>
  (value ?? "")
    .split(",")
    .map((model) => model.trim())
    .filter((model) => model !== "");

// The models EVAL_MODELS names.
export const namedModels = modelsNamed(env.EVAL_MODELS);

// The key to send, or undefined to send none, or an error saying what is
// missing.
export function evalKey(): string | undefined {
  const key = cloud ? undefined : env.OPENROUTER_API_KEY;
  if (!cloud && (key === undefined || key === "")) {
    throw new Error(
      "Set OPENROUTER_API_KEY to the eval key, or run the eval in a Claude cloud session, where the key is added for you.",
    );
  }
  if (proxy !== undefined && !nodeUsesProxy()) {
    throw new Error(
      `A proxy is set, but this Node (${process.versions.node}) will not send fetch through it. Run the eval with npm run eval, on Node 22.21 or later.`,
    );
  }
  return key;
}

// One model, reached with the key evalKey gave. It sends each call once.
// An eval sends it through retryingOnRate.
export const clientFor = (model: string, key: string | undefined): Model =>
  createModel({
    endpoint: openRouterEndpoint,
    model,
    key: () => Promise.resolve(key),
  });

// The least and the most a wait may be, in milliseconds.
interface RateWait {
  least: number;
  most: number;
}

// The wait before each new try of a call the provider refused for rate: a
// minute in all at the least. On #273 a call OpenRouter refused for rate got
// a reply a minute later. Each wait is picked at random between its least
// and its most, so calls the provider refused together are sent again at
// different moments (#312). The time limits for sorting allow for every wait
// at its most.
export const rateWaits: readonly RateWait[] = [
  { least: 10_000, most: 15_000 },
  { least: 20_000, most: 30_000 },
  { least: 30_000, most: 45_000 },
];

// The longest a call waits, in all, for the provider to stop refusing it
// for rate.
export const rateWaitMs = rateWaits.reduce((sum, { most }) => sum + most, 0);

const pause = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

// A wait picked at random between its least and its most, both included, in
// whole milliseconds, each as likely as any other.
const randomWait = ({ least, most }: RateWait) =>
  least + Math.floor(Math.random() * (most - least + 1));

// A model that sends a call again when the provider refuses it for rate,
// with a 429, once after each wait in rateWaits (#303), each picked at random
// (#312). A 429 means the model never saw the call, so a new try draws
// nothing new from it. The service's plain second try is a second draw, and
// the eval leaves it out. The last 429 is thrown as it came, so the call
// counts as refused.
export const retryingOnRate = (model: Model): Model => ({
  async reply(request) {
    for (const wait of rateWaits) {
      try {
        return await model.reply(request);
      } catch (error) {
        if (!(error instanceof ModelFailed && error.reason === "status-429")) {
          throw error;
        }
      }
      await pause(randomWait(wait));
    }
    return model.reply(request);
  },
});

// The lines of a report that say how the model was reached.
export const keyLine = `Key: ${cloud ? "none sent, as in a Claude cloud session, where the proxy adds it" : "OPENROUTER_API_KEY"}`;

export const proxyLine = `Proxy: ${proxy === undefined ? "none" : `fetch goes through the proxy in HTTPS_PROXY (Node ${process.versions.node}, NODE_USE_ENV_PROXY=1)`}`;

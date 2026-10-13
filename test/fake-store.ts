// A store for a unit test, in memory. Every method rejects, naming itself,
// unless the test gives it. A test names only the methods it reaches, and a
// change to the Store interface is made here, once (#292).
import type { Store } from "../service/src/store/store";

const notUsed = (name: string) => () =>
  Promise.reject(new Error(`The store's ${name} is not used here.`));

export function fakeStore(given: Partial<Store> = {}): Store {
  return {
    postAsk: notUsed("postAsk"),
    resolveAsk: notUsed("resolveAsk"),
    markOpened: notUsed("markOpened"),
    dismissAsk: notUsed("dismissAsk"),
    openAsks: notUsed("openAsks"),
    asksSince: notUsed("asksSince"),
    countCall: notUsed("countCall"),
    rules: notUsed("rules"),
    saveRules: notUsed("saveRules"),
    resaveRules: notUsed("resaveRules"),
    modelCapSpent: notUsed("modelCapSpent"),
    recordModelCapReset: notUsed("recordModelCapReset"),
    askToSort: notUsed("askToSort"),
    recordSort: notUsed("recordSort"),
    close: () => undefined,
    ...given,
  };
}

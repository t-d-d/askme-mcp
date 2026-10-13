// lint-rules/index.js imports sortKeys through Node, which strips types but
// loads any other import and cannot find a path without its extension. So
// this module imports types only, and holds no enum or namespace.
import type { AccountId } from "../identity";

export interface Key {
  pk: AccountId;
  sk: string;
}

// A name that ends in # is a prefix. askme/no-hand-built-key refuses each
// of these anywhere but here.
export const sortKeys = {
  meta: "META",
  rules: "RULES",
  openAsk: "OPEN#",
  closedAsk: "CLOSED#",
  dedupe: "DEDUPE#",
  usage: "USAGE#",
  pollCount: "POLL#",
  askCount: "RATE#",
  rulesSaveCount: "SAVE#",
  modelCount: "MODEL#",
} as const;

export const keys = {
  meta: (account: AccountId): Key => ({ pk: account, sk: sortKeys.meta }),
  openAsk: (account: AccountId, askId: string): Key => ({
    pk: account,
    sk: `${sortKeys.openAsk}${askId}`,
  }),
  rules: (account: AccountId): Key => ({ pk: account, sk: sortKeys.rules }),
  openAsks: (account: AccountId) => ({
    pk: account,
    prefix: sortKeys.openAsk,
  }),
  closedAsk: (account: AccountId, askId: string): Key => ({
    pk: account,
    sk: `${sortKeys.closedAsk}${askId}`,
  }),
  dedupe: (account: AccountId, fingerprint: string): Key => ({
    pk: account,
    sk: `${sortKeys.dedupe}${fingerprint}`,
  }),
  usage: (account: AccountId, at: Date): Key => ({
    pk: account,
    sk: `${sortKeys.usage}${at.toISOString().slice(0, 10)}`,
  }),
  pollCount: (account: AccountId, window: string): Key => ({
    pk: account,
    sk: `${sortKeys.pollCount}${window}`,
  }),
  askCount: (account: AccountId, window: string): Key => ({
    pk: account,
    sk: `${sortKeys.askCount}${window}`,
  }),
  rulesSaveCount: (account: AccountId, window: string): Key => ({
    pk: account,
    sk: `${sortKeys.rulesSaveCount}${window}`,
  }),
  modelCount: (account: AccountId, window: string): Key => ({
    pk: account,
    sk: `${sortKeys.modelCount}${window}`,
  }),
};

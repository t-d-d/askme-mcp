// Every key in the table is built here, and nowhere else (ADR 13). The
// partition key is the account, which only a verified token can give, and
// the sort key says what the item is. A new kind of item gets its own
// prefix, added to sortKeys.
//
// Lint imports this module to read sortKeys, through Node, which strips its
// types. So it imports types only, since Node would load any other import
// and cannot find a path written without its extension. It holds no enum or
// namespace either, which Node cannot strip.
import type { AccountId } from "../identity";

export interface Key {
  pk: AccountId;
  sk: string;
}

// Every sort key, whole or as the prefix one starts with. A name that ends
// in # is a prefix. askme/no-hand-built-key refuses each of these anywhere
// but here.
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
  sortRetryCount: "SORT#",
} as const;

export const keys = {
  // The account marker, which holds the version.
  meta: (account: AccountId): Key => ({ pk: account, sk: sortKeys.meta }),
  // An ask that is still open.
  openAsk: (account: AccountId, askId: string): Key => ({
    pk: account,
    sk: `${sortKeys.openAsk}${askId}`,
  }),
  // The rules text, the hashtags read from it, and every hashtag the
  // account has had, in the order each first appeared.
  rules: (account: AccountId): Key => ({ pk: account, sk: sortKeys.rules }),
  // The prefix every open ask's sort key starts with, to list them.
  openAsks: (account: AccountId) => ({
    pk: account,
    prefix: sortKeys.openAsk,
  }),
  // An ask that has closed. It moves here from its open key, so listing the
  // open asks never reads it.
  closedAsk: (account: AccountId, askId: string): Key => ({
    pk: account,
    sk: `${sortKeys.closedAsk}${askId}`,
  }),
  // The record that an ask with this fingerprint was posted, which holds its
  // id while a repeat of it is matched (ADR 3).
  dedupe: (account: AccountId, fingerprint: string): Key => ({
    pk: account,
    sk: `${sortKeys.dedupe}${fingerprint}`,
  }),
  // How many asks the account has posted in the UTC day of a moment, named
  // by the day, as 2026-10-11.
  usage: (account: AccountId, at: Date): Key => ({
    pk: account,
    sk: `${sortKeys.usage}${at.toISOString().slice(0, 10)}`,
  }),
  // The poll's rate counter for one window, named by the minute it starts
  // (ADR 18).
  pollCount: (account: AccountId, window: string): Key => ({
    pk: account,
    sk: `${sortKeys.pollCount}${window}`,
  }),
  // The ask tool's rate counter for one window, named by the minute it
  // starts (ADR 18).
  askCount: (account: AccountId, window: string): Key => ({
    pk: account,
    sk: `${sortKeys.askCount}${window}`,
  }),
  // The rate counter for saving the rules, for one window, named by the
  // minute it starts (ADR 18).
  rulesSaveCount: (account: AccountId, window: string): Key => ({
    pk: account,
    sk: `${sortKeys.rulesSaveCount}${window}`,
  }),
  // The rate counter for asking again for asks not yet sorted with the
  // rules in force, for one window, named by the minute it starts (ADR 18).
  sortRetryCount: (account: AccountId, window: string): Key => ({
    pk: account,
    sk: `${sortKeys.sortRetryCount}${window}`,
  }),
};

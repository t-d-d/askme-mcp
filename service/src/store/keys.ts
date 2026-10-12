// Every key in the table is built here, and nowhere else (ADR 13). The
// partition key is the account, which only a verified token can give, and
// the sort key says what the item is. A new kind of item gets its own
// prefix, added here.
import type { AccountId } from "../identity";

export interface Key {
  pk: AccountId;
  sk: string;
}

const openAskPrefix = "OPEN#";
const closedAskPrefix = "CLOSED#";
const dedupePrefix = "DEDUPE#";
const usagePrefix = "USAGE#";
const pollCountPrefix = "POLL#";
const askCountPrefix = "RATE#";
const rulesSaveCountPrefix = "SAVE#";
const sortRetryCountPrefix = "SORT#";

export const keys = {
  // The account marker, which holds the version.
  meta: (account: AccountId): Key => ({ pk: account, sk: "META" }),
  // An ask that is still open.
  openAsk: (account: AccountId, askId: string): Key => ({
    pk: account,
    sk: `${openAskPrefix}${askId}`,
  }),
  // The rules text, the hashtags read from it, and every hashtag the
  // account has had, in the order each first appeared.
  rules: (account: AccountId): Key => ({ pk: account, sk: "RULES" }),
  // The prefix every open ask's sort key starts with, to list them.
  openAsks: (account: AccountId) => ({ pk: account, prefix: openAskPrefix }),
  // An ask that has closed. It moves here from its open key, so listing the
  // open asks never reads it.
  closedAsk: (account: AccountId, askId: string): Key => ({
    pk: account,
    sk: `${closedAskPrefix}${askId}`,
  }),
  // The record that an ask with this fingerprint was posted, which holds its
  // id while a repeat of it is matched (ADR 3).
  dedupe: (account: AccountId, fingerprint: string): Key => ({
    pk: account,
    sk: `${dedupePrefix}${fingerprint}`,
  }),
  // How many asks the account has posted in the UTC day of a moment, named
  // by the day, as 2026-10-11.
  usage: (account: AccountId, at: Date): Key => ({
    pk: account,
    sk: `${usagePrefix}${at.toISOString().slice(0, 10)}`,
  }),
  // The poll's rate counter for one window, named by the minute it starts
  // (ADR 18).
  pollCount: (account: AccountId, window: string): Key => ({
    pk: account,
    sk: `${pollCountPrefix}${window}`,
  }),
  // The ask tool's rate counter for one window, named by the minute it
  // starts (ADR 18).
  askCount: (account: AccountId, window: string): Key => ({
    pk: account,
    sk: `${askCountPrefix}${window}`,
  }),
  // The rate counter for saving the rules, for one window, named by the
  // minute it starts (ADR 18).
  rulesSaveCount: (account: AccountId, window: string): Key => ({
    pk: account,
    sk: `${rulesSaveCountPrefix}${window}`,
  }),
  // The rate counter for asking again for unsorted asks, for one window,
  // named by the minute it starts (ADR 18).
  sortRetryCount: (account: AccountId, window: string): Key => ({
    pk: account,
    sk: `${sortRetryCountPrefix}${window}`,
  }),
};

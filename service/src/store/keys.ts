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

export const keys = {
  // The account marker, which holds the version.
  meta: (account: AccountId): Key => ({ pk: account, sk: "META" }),
  // An ask that is still open.
  openAsk: (account: AccountId, askId: string): Key => ({
    pk: account,
    sk: `${openAskPrefix}${askId}`,
  }),
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
    sk: `DEDUPE#${fingerprint}`,
  }),
  // How many asks the account has posted in the UTC day of a moment, named
  // by the day, as 2026-10-11.
  usage: (account: AccountId, at: Date): Key => ({
    pk: account,
    sk: `USAGE#${at.toISOString().slice(0, 10)}`,
  }),
  // The rate counter: how many asks the account has posted in the UTC minute
  // of a moment, named by the minute, as 2026-10-11T09:30.
  rate: (account: AccountId, at: Date): Key => ({
    pk: account,
    sk: `RATE#${at.toISOString().slice(0, 16)}`,
  }),
};

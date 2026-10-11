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
};

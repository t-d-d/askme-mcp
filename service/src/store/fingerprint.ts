// An ask's fingerprint (ADR 3): a hash of every field the agent sent, with
// each text trimmed, so a repeat of the same ask can be matched. A field
// left out counts as different from any value, and each field keeps its
// place, so text moved from one field to another is a different ask.
//
// The minutes until the ask stops mattering came later, so they are added
// only when sent. An ask without them keeps the fingerprint it had before,
// and a retry that spans a deploy still matches.
import { createHash } from "node:crypto";
import type { NewAsk } from "./store";

export function fingerprint(ask: NewAsk): string {
  const fields: (string | number | null)[] = [
    ask.summary,
    ask.area,
    ask.spokenDetail,
    ask.actionLink,
    ask.sessionLink,
    ask.replaces,
  ].map((field) => (field === undefined ? null : field.trim()));
  if (ask.staleAfterMinutes !== undefined) fields.push(ask.staleAfterMinutes);
  return createHash("sha256")
    .update(JSON.stringify(fields))
    .digest("base64url");
}

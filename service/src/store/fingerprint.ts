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
  // Added only when sent, so an ask without it keeps the fingerprint it had
  // before this field existed, and a retry that spans a deploy still matches.
  if (ask.staleAfterMinutes !== undefined) fields.push(ask.staleAfterMinutes);
  return createHash("sha256")
    .update(JSON.stringify(fields))
    .digest("base64url");
}

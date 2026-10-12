// An ask's fingerprint (ADR 3): a hash of every field the agent sent, with
// each text trimmed, so a repeat of the same ask can be matched. A field left out
// counts as different from any text, and each field keeps its place, so
// text moved from one field to another is a different ask.
import { createHash } from "node:crypto";
import type { NewAsk } from "./store";

export function fingerprint(ask: NewAsk): string {
  const fields = [
    ...[
      ask.summary,
      ask.area,
      ask.spokenDetail,
      ask.actionLink,
      ask.sessionLink,
      ask.replaces,
    ].map((field) => (field === undefined ? null : field.trim())),
    ask.staleAfterMinutes ?? null,
  ];
  return createHash("sha256")
    .update(JSON.stringify(fields))
    .digest("base64url");
}

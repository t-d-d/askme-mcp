// The daily cap on model calls (ADR 21), for the integration tier: a test
// can spend an account's cap with one write, where the service would take
// thousands of calls, and read how many calls the account has made today.
import { inject, onTestFinished, vi } from "vitest";
import type { AccountId } from "../service/src/identity";
import { modelCallLimit, windowOf } from "../service/src/rate";
import { keys } from "../service/src/store/keys";
import { putItem, storedItems } from "./dynamodb";

// Starts the clock, for the service and the test alike, at noon UTC today,
// and lets it run on from there, so no test crosses midnight between
// spending the cap and the call the cap refuses. Called inside a test.
export function startAtNoon(): void {
  const now = new Date();
  vi.useFakeTimers({
    toFake: ["Date"],
    now: Date.UTC(
      now.getUTCFullYear(),
      now.getUTCMonth(),
      now.getUTCDate(),
      12,
    ),
    shouldAdvanceTime: true,
  });
  onTestFinished(() => {
    vi.useRealTimers();
  });
}

// The UTC day the service counts a call made now in.
const today = () => windowOf(new Date(), modelCallLimit.windowMinutes);

// Sets the account's count of model calls for today, to the cap unless told
// otherwise, as a day of calls would.
export async function setModelCalls(
  account: AccountId,
  count: number = modelCallLimit.calls,
): Promise<void> {
  const { name, endsAt } = today();
  await putItem(inject("databaseEndpoint"), inject("tableName"), {
    ...keys.modelCount(account, name),
    count,
    expiresAt: Math.floor(endsAt / 1000) + 3600,
  });
}

// How many model calls the account has made today, as the table counts them.
export async function modelCallsMade(account: AccountId): Promise<number> {
  const counter = (
    await storedItems(inject("databaseEndpoint"), inject("tableName"), account)
  ).find(({ sk }) => sk === keys.modelCount(account, today().name).sk);
  return typeof counter?.count === "number" ? counter.count : 0;
}

// When the cap resets, if it is spent now: the next midnight UTC.
export const nextReset = (): string => new Date(today().endsAt).toISOString();

// The one place a test makes an account or a Caller, so a change to how the
// service builds one from a verified token is made here once.
import { randomUUID } from "node:crypto";
import { callerOf, type AccountId, type Caller } from "../service/src/identity";

// Every test file shares the table, so each test makes its own account.
export const newAccount = (): string => `user_${randomUUID().slice(0, 8)}`;

export interface CallerOptions {
  accountId?: string;
  scopes?: string[];
  requestId?: string;
}

export const testCaller = ({
  accountId = "user_1",
  scopes = ["asks:create"],
  requestId = "req-1",
}: CallerOptions = {}): Caller =>
  callerOf({
    token: "test",
    clientId: "test",
    scopes,
    extra: { accountId, requestId },
  });

// The AccountId the service gives the account a token's sub names.
export const accountId = (sub: string): AccountId =>
  testCaller({ accountId: sub }).accountId;

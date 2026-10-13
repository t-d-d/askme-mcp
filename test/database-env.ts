import { inject, vi } from "vitest";

vi.stubEnv("TABLE_NAME", inject("tableName"));
vi.stubEnv("DYNAMODB_ENDPOINT", inject("databaseEndpoint"));

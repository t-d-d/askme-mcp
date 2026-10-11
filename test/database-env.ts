// Setup for every integration test: the service finds the local DynamoDB
// that test/dynamodb.ts started, through the environment it reads in
// production.
import { inject, vi } from "vitest";

vi.stubEnv("TABLE_NAME", inject("tableName"));
vi.stubEnv("DYNAMODB_ENDPOINT", inject("databaseEndpoint"));

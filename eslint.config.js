import js from "@eslint/js";
import comments from "@eslint-community/eslint-plugin-eslint-comments/configs";
import jsxA11y from "eslint-plugin-jsx-a11y-x";
import reactHooks from "eslint-plugin-react-hooks";
import { defineConfig, globalIgnores } from "eslint/config";
import globals from "globals";
import tseslint from "typescript-eslint";
import askme from "./lint-rules/index.js";

const layerPattern = (other) => ({
  regex: `^(\\.\\./)+${other}(/|$)`,
  message: `The page and the service never import each other. Shared types go in their own module.`,
});

const databaseClients = [
  "@aws-sdk/client-dynamodb",
  "@aws-sdk/lib-dynamodb",
  "@aws-sdk/util-dynamodb",
];
const databaseMessage =
  "Only the store module, service/src/store/store.ts, reads or writes the table (ADR 13).";
const databasePaths = databaseClients.map((name) => ({
  name,
  message: databaseMessage,
}));
const databasePatterns = [
  {
    group: databaseClients.map((name) => `${name}/*`),
    message: databaseMessage,
  },
];

// Every block below that sets no-restricted-imports replaces this one for
// its files, so each carries the database rule as well.
const databaseImports = {
  "no-restricted-imports": [
    "error",
    { paths: databasePaths, patterns: databasePatterns },
  ],
};

const layer = (other) => ({
  "no-restricted-imports": [
    "error",
    {
      patterns: [layerPattern(other), ...databasePatterns],
      paths: databasePaths,
    },
  ],
});

const otherLoggers = [
  "pino",
  "winston",
  "bunyan",
  "loglevel",
  "debug",
  "log4js",
  "consola",
  "signale",
  "tslog",
  "roarr",
  "@aws-lambda-powertools/logger",
].map((name) => ({
  name,
  message: "Log through the shared logger in service/src/log.ts (ADR 7).",
}));

const serviceImports = {
  patterns: [layerPattern("web"), ...databasePatterns],
  paths: [...otherLoggers, ...databasePaths],
};

// Importing env, stdout or stderr from the process module would get round
// the property rules below.
const processImports = ["process", "node:process"].map((name) => ({
  name,
  importNames: ["env", "stdout", "stderr"],
  message:
    "Read the environment in service/src/env.ts, and log through service/src/log.ts (ADR 7, ADR 10).",
}));

// Each boundary module disables these on the line where it reads outside
// data, with its reason (ADR 10).
const boundaries = {
  // This block replaces the service-wide import rule, so it carries it too.
  "no-restricted-imports": [
    "error",
    { ...serviceImports, paths: [...serviceImports.paths, ...processImports] },
  ],
  "no-console": "error",
  "no-restricted-properties": [
    "error",
    {
      object: "process",
      property: "env",
      message:
        "Read the environment in service/src/env.ts, through its schema (ADR 10).",
    },
    {
      object: "process",
      property: "stdout",
      message: "Log through the shared logger in service/src/log.ts (ADR 7).",
    },
    {
      object: "process",
      property: "stderr",
      message: "Log through the shared logger in service/src/log.ts (ADR 7).",
    },
    {
      property: "registerTool",
      message:
        "Register a tool with addTool from service/src/tools.ts, which carries its schemas (ADR 10).",
    },
  ],
  "no-restricted-syntax": [
    "error",
    {
      selector: "MemberExpression[property.name='body']",
      message:
        "Read a request body in service/src/http.ts, through its schema (ADR 10).",
    },
    {
      selector: "ObjectPattern > Property[key.name='body']",
      message:
        "Read a request body in service/src/http.ts, through its schema (ADR 10).",
    },
    {
      // Response.json() builds a response. It reads nothing.
      selector:
        "CallExpression[callee.property.name=/^(json|text|formData|arrayBuffer|blob|bytes)$/]:not([callee.object.name='Response'])",
      message:
        "Read a body in its boundary module, through its schema (ADR 10).",
    },
  ],
};

export default defineConfig(
  globalIgnores(["**/dist/", ".serverless/", "docs/"]),
  js.configs.recommended,
  tseslint.configs.strictTypeChecked,
  comments.recommended,
  {
    files: ["**/*.{js,ts,tsx}"],
    plugins: { askme },
    rules: {
      "askme/no-hand-built-key": "error",
      "askme/no-scan": "error",
    },
  },
  {
    files: ["**/*.{ts,tsx}"],
    rules: databaseImports,
  },
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    linterOptions: {
      reportUnusedDisableDirectives: "error",
      reportUnusedInlineConfigs: "error",
    },
    rules: {
      "@typescript-eslint/ban-ts-comment": [
        "error",
        {
          "ts-expect-error": "allow-with-description",
          "ts-ignore": true,
          "ts-nocheck": true,
        },
      ],
      "@typescript-eslint/no-unsafe-type-assertion": "error",
      "@typescript-eslint/switch-exhaustiveness-check": [
        "error",
        {
          considerDefaultExhaustiveForUnions: false,
          requireDefaultForNonUnion: true,
        },
      ],
      "@eslint-community/eslint-comments/require-description": "error",
      "@eslint-community/eslint-comments/no-unlimited-disable": "error",
      "@eslint-community/eslint-comments/disable-enable-pair": [
        "error",
        { allowWholeFile: false },
      ],
    },
  },
  {
    files: ["web/src/**/*.{ts,tsx}"],
    extends: [
      reactHooks.configs.flat["recommended-latest"],
      jsxA11y.configs.strict,
    ],
    languageOptions: { globals: globals.browser },
    rules: {
      ...layer("service"),
      // The preset sets these to warn. A rule is an error or off.
      "react-hooks/exhaustive-deps": "error",
      "react-hooks/incompatible-library": "error",
      "react-hooks/unsupported-syntax": "error",
    },
  },
  {
    files: ["service/**/*.ts"],
    rules: {
      "no-restricted-imports": ["error", serviceImports],
    },
  },
  {
    files: ["service/src/**/*.ts"],
    ignores: ["service/src/**/*.test.ts"],
    rules: boundaries,
  },
  {
    // test/dynamodb.ts makes the local table outside the service, so it is
    // not held to this.
    files: ["service/**/*.ts"],
    rules: { "askme/write-functions": "error" },
  },
  {
    files: ["service/src/store/keys.ts"],
    rules: { "askme/no-hand-built-key": "off" },
  },
  {
    // The store module is the one place the database client is imported.
    files: ["service/src/store/store.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [layerPattern("web")],
          paths: [...otherLoggers, ...processImports],
        },
      ],
    },
  },
  {
    // Starts the local database for the integration tier (ADR 9).
    files: ["test/dynamodb.ts"],
    rules: { "no-restricted-imports": "off" },
  },
  {
    files: ["service/**/*.ts"],
    ignores: [
      "service/src/errors.ts",
      "**/*.test.ts",
      "**/*.int.ts",
      "**/*.live.ts",
    ],
    rules: { "askme/refusal-from-table": "error" },
  },
  {
    files: ["**/*.browser.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "playwright",
              message:
                "Open pages with openPage from test/browser.ts, which keeps the browser offline.",
            },
            ...databasePaths,
          ],
          patterns: databasePatterns,
        },
      ],
    },
  },
  {
    files: ["**/*.js"],
    extends: [tseslint.configs.disableTypeChecked],
    languageOptions: { globals: globals.node },
  },
);

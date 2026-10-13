// eslint.config.js decides which files each rule covers.
import { sortKeys } from "../service/src/store/keys.ts";

const sortKeyNames = Object.values(sortKeys);
const isSortKey = (text) =>
  sortKeyNames.some((name) =>
    name.endsWith("#") ? text.startsWith(name) : text === name,
  );

const noHandBuiltKey = {
  meta: {
    type: "problem",
    docs: { description: "A table key is built only in the key module." },
    schema: [],
    messages: {
      handBuilt:
        "Build a table key with service/src/store/keys.ts, which takes the account from the token (ADR 13).",
    },
  },
  create(context) {
    return {
      Literal(node) {
        if (typeof node.value === "string" && isSortKey(node.value)) {
          context.report({ node, messageId: "handBuilt" });
        }
      },
      TemplateLiteral(node) {
        const first = node.quasis[0]?.value.cooked ?? "";
        if (isSortKey(first)) {
          context.report({ node, messageId: "handBuilt" });
        }
      },
    };
  },
};

const scanNames = new Set(["ScanCommand", "paginateScan"]);

const noScan = {
  meta: {
    type: "problem",
    docs: { description: "The table is never scanned." },
    schema: [],
    messages: {
      scan: "The table is never scanned (ADR 13). Read one account's items along its keys.",
    },
  },
  create(context) {
    return {
      Identifier(node) {
        if (scanNames.has(node.name)) {
          context.report({ node, messageId: "scan" });
        }
      },
      MemberExpression(node) {
        if (
          !node.computed &&
          node.property.type === "Identifier" &&
          node.property.name === "scan"
        ) {
          context.report({ node, messageId: "scan" });
        }
      },
    };
  },
};

const writeCommands = new Set([
  "PutCommand",
  "UpdateCommand",
  "DeleteCommand",
  "TransactWriteCommand",
  "BatchWriteCommand",
  "PutItemCommand",
  "UpdateItemCommand",
  "DeleteItemCommand",
  "TransactWriteItemsCommand",
  "BatchWriteItemCommand",
]);

// The names of the two writing functions in service/src/store/store.ts.
const writeFunctions = new Set(["write", "count"]);

function functionName(node) {
  if (node.id?.type === "Identifier") return node.id.name;
  const { parent } = node;
  if (parent?.type === "VariableDeclarator" && parent.id.type === "Identifier")
    return parent.id.name;
  if (
    (parent?.type === "Property" || parent?.type === "MethodDefinition") &&
    !parent.computed &&
    parent.key.type === "Identifier"
  )
    return parent.key.name;
  return undefined;
}

const functionTypes = new Set([
  "FunctionDeclaration",
  "FunctionExpression",
  "ArrowFunctionExpression",
]);

const writeFunctionsRule = {
  meta: {
    type: "problem",
    docs: {
      description:
        "A write to the table is built only in write() or count() in the store.",
    },
    schema: [],
    messages: {
      elsewhere:
        "Write to the table through write(), which raises the version, or count(), which writes a rate counter (ADR 13, ADR 18).",
    },
  },
  create(context) {
    const aliases = new Map();
    const commandName = (callee) => {
      if (callee.type === "Identifier")
        return aliases.get(callee.name) ?? callee.name;
      if (
        callee.type === "MemberExpression" &&
        !callee.computed &&
        callee.property.type === "Identifier"
      )
        return callee.property.name;
      return undefined;
    };
    return {
      ImportSpecifier(node) {
        if (
          node.imported.type === "Identifier" &&
          writeCommands.has(node.imported.name)
        )
          aliases.set(node.local.name, node.imported.name);
      },
      NewExpression(node) {
        if (!writeCommands.has(commandName(node.callee))) return;
        // Anonymous callbacks are passed over.
        const named = context.sourceCode
          .getAncestors(node)
          .reverse()
          .filter((ancestor) => functionTypes.has(ancestor.type))
          .map(functionName)
          .find((name) => name !== undefined);
        if (named === undefined || !writeFunctions.has(named)) {
          context.report({ node, messageId: "elsewhere" });
        }
      },
    };
  },
};

function propertyName(property) {
  if (property.type !== "Property" || property.computed) return undefined;
  if (property.key.type === "Identifier") return property.key.name;
  if (property.key.type === "Literal") return String(property.key.value);
  return undefined;
}

const refusalFromTable = {
  meta: {
    type: "problem",
    docs: {
      description: "Every refusal is built from the one table of codes.",
    },
    schema: [],
    messages: {
      elsewhere:
        "Build a refusal with refusal() or pageRefusal() in service/src/errors.ts, from the one table of codes (ADR 11).",
    },
  },
  create(context) {
    return {
      ObjectExpression(node) {
        const names = new Set(node.properties.map(propertyName));
        if (names.has("isError") || (names.has("code") && names.has("class"))) {
          context.report({ node, messageId: "elsewhere" });
        }
      },
    };
  },
};

export default {
  meta: { name: "askme" },
  rules: {
    "no-hand-built-key": noHandBuiltKey,
    "no-scan": noScan,
    "refusal-from-table": refusalFromTable,
    "write-functions": writeFunctionsRule,
  },
};

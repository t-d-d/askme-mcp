// Project lint rules: code-level rules from the decision records, each held
// by lint (ADR 10). eslint.config.js decides which files each one covers.

// A sort key the table uses (ADR 13), written as a whole string or as the
// start of one.
const sortKey = /^(?:META|RULES)$|^(?:OPEN|CLOSED|DEDUPE|USAGE)#/u;

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
        if (typeof node.value === "string" && sortKey.test(node.value)) {
          context.report({ node, messageId: "handBuilt" });
        }
      },
      TemplateLiteral(node) {
        const first = node.quasis[0]?.value.cooked ?? "";
        if (sortKey.test(first)) {
          context.report({ node, messageId: "handBuilt" });
        }
      },
    };
  },
};

// The scan call in the AWS SDK, by any of its names.
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

// The name of an object property, when it is written as a plain name or a
// string.
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
  },
};

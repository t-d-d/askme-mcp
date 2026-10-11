// Lint as the repo configures it, for the fitness functions about lint.
import { join } from "node:path";
import { ESLint, Linter } from "eslint";
import { z } from "zod";
import { root } from "./repo";

export const eslint = new ESLint({ cwd: root });

// The rules lint reports for a piece of code, as if it were in the given file.
export async function reported(code: string, path: string): Promise<string[]> {
  const results = await eslint.lintText(code, { filePath: join(root, path) });
  return results.flatMap((result) =>
    result.messages.map((message) => message.ruleId ?? message.message),
  );
}

const severity = z.union([
  z.literal(0),
  z.literal(1),
  z.literal(2),
  z.literal("off"),
  z.literal("warn"),
  z.literal("error"),
]);
const ruleEntry = z.union([severity, z.tuple([severity], z.unknown())]);
const resolvedSchema = z.object({ rules: z.record(z.string(), ruleEntry) });

// The rules lint applies to a file, after every config that matches it.
export async function rulesFor(path: string) {
  const config: unknown = await eslint.calculateConfigForFile(join(root, path));
  return resolvedSchema.parse(config).rules;
}

// Whether the import rule lint applies to a file refuses a line of code. The
// file need not exist, so this works for folders that have no code yet.
export async function importRefused(
  code: string,
  path: string,
): Promise<boolean> {
  const entry = (await rulesFor(path))["no-restricted-imports"];
  if (entry === undefined) return false;
  const messages = new Linter().verify(code, {
    languageOptions: { sourceType: "module" },
    rules: { "no-restricted-imports": entry },
  });
  return messages.some((message) => message.ruleId === "no-restricted-imports");
}

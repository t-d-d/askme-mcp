// `npm run mutate -- <suite>` runs mutation testing over one suite from
// test/mutation-suites.ts, and with no suite lists them (#215). It runs by
// hand, outside the gate. Stryker's sandboxes and the list of survivors go
// in the system's temp folder, so the run writes nothing into the repo.
//
// Node runs this file with its types stripped, so it imports with each
// file's extension.
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { Stryker } from "@stryker-mutator/core";
import {
  counts,
  strykerOptions,
  survivorsTsv,
  verdict,
  type Suite,
} from "./mutation.ts";
import { suites } from "./mutation-suites.ts";

const root = fileURLToPath(new URL("..", import.meta.url));

function list(): void {
  console.log("Suites, run one with npm run mutate -- <suite>:");
  for (const [name, suite] of Object.entries(suites)) {
    console.log(`  ${name}: ${suite.about}`);
  }
}

async function run(name: string, suite: Suite): Promise<boolean> {
  const folder = join(tmpdir(), "askme-mutation", name);
  rmSync(folder, { recursive: true, force: true });
  mkdirSync(folder, { recursive: true });
  const mutants = await new Stryker(
    strykerOptions(suite, join(folder, "sandboxes")),
  ).runMutationTest();
  const survivors = join(folder, "survivors.tsv");
  writeFileSync(survivors, survivorsTsv(mutants, root));
  console.log(`\nSuite ${name}:`);
  for (const { file, killed, survived } of counts(mutants, root)) {
    console.log(
      `  ${file}: ${String(killed)} killed, ${String(survived)} survived`,
    );
  }
  console.log(`Survivors: ${survivors}`);
  const wrong = verdict(mutants);
  if (wrong !== undefined) console.error(`\n${wrong}`);
  return wrong === undefined;
}

const [name] = process.argv.slice(2);
if (name === undefined) {
  list();
} else {
  const suite = suites[name];
  if (suite === undefined) {
    console.error(`There is no suite named ${name}.`);
    list();
    process.exitCode = 1;
  } else if (!(await run(name, suite))) {
    process.exitCode = 1;
  }
}

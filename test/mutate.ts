// `npm run mutate -- <suite>` runs mutation testing over one suite from
// test/mutation-suites.ts, and with no suite lists them (#215). It runs by
// hand, outside the gate. Stryker's sandboxes and the list of survivors go
// in the system's temp folder, so the run writes nothing into the repo. The
// last run's survivors are kept beside the new ones, so a run before a
// refactor and one after it can be compared with diff.
//
// Node runs this file with its types stripped, so it imports with each
// file's extension.
import {
  existsSync,
  mkdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { Stryker } from "@stryker-mutator/core";
import {
  counts,
  scratch,
  strykerOptions,
  survivorsTsv,
  verdict,
  type Suite,
} from "./mutation.ts";
import { suites } from "./mutation-suites.ts";

const root = fileURLToPath(new URL("..", import.meta.url));
// Stryker reads the project and its mutate paths from the working folder.
process.chdir(root);

function list(): void {
  console.log("Suites, run one with npm run mutate -- <suite>:");
  for (const [name, suite] of Object.entries(suites)) {
    console.log(`  ${name}: ${suite.about}`);
  }
}

async function run(name: string, suite: Suite): Promise<boolean> {
  const folder = join(scratch(root, "askme-mutation"), name);
  const sandboxes = join(folder, "sandboxes");
  rmSync(sandboxes, { recursive: true, force: true });
  mkdirSync(folder, { recursive: true });
  const mutants = await new Stryker(
    strykerOptions(suite, sandboxes),
  ).runMutationTest();
  const survivors = join(folder, "survivors.tsv");
  const previous = join(folder, "survivors.previous.tsv");
  if (existsSync(survivors)) renameSync(survivors, previous);
  writeFileSync(survivors, survivorsTsv(mutants, root));
  console.log(`\nSuite ${name}:`);
  for (const { file, killed, survived } of counts(mutants, root)) {
    console.log(
      `  ${file}: ${String(killed)} killed, ${String(survived)} survived`,
    );
  }
  console.log(`Survivors: ${survivors}`);
  if (existsSync(previous)) console.log(`The last run's: ${previous}`);
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

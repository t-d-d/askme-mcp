// A killed run never reaches vitest's teardown, so its container must stop
// by itself.
import { execFile, spawn, type ChildProcess } from "node:child_process";
import { createInterface } from "node:readline";
import { promisify } from "node:util";
import { afterAll, describe, expect, inject, it } from "vitest";

const run = promisify(execFile);

// The global setup in a process of its own, as a vitest run has it.
const setupScript = `
import setup from ${JSON.stringify(new URL("dynamodb.ts", import.meta.url).href)};
await setup({
  provide: (key, value) => {
    if (key === "databaseEndpoint") console.log(value);
  },
});
setInterval(() => undefined, 60_000);
`;

const runs: ChildProcess[] = [];
const containers: string[] = [];
afterAll(async () => {
  for (const child of runs) child.kill("SIGKILL");
  if (containers.length > 0) {
    await run("docker", ["rm", "--force", ...containers]).catch(
      () => undefined,
    );
  }
});

async function containerAt(endpoint: string): Promise<string> {
  const { port } = new URL(endpoint);
  const { stdout } = await run("docker", [
    "ps",
    "--quiet",
    "--no-trunc",
    "--filter",
    `publish=${port}`,
  ]);
  return stdout.trim();
}

async function running(container: string): Promise<boolean> {
  const { stdout } = await run("docker", [
    "ps",
    "--quiet",
    "--no-trunc",
    "--filter",
    `id=${container}`,
  ]);
  return stdout.trim() !== "";
}

// Detached, so the run leads its own process group.
async function startRun(): Promise<{ pid: number; container: string }> {
  const child = spawn(
    process.execPath,
    ["--input-type=module", "--eval", setupScript],
    { detached: true, stdio: ["ignore", "pipe", "pipe"] },
  );
  runs.push(child);
  let errors = "";
  child.stderr.on("data", (chunk: Buffer) => {
    errors += chunk.toString("utf8");
  });
  const endpoint = await new Promise<string>((resolve, reject) => {
    createInterface({ input: child.stdout }).once("line", resolve);
    // On close, not exit, so everything the run wrote is in the message.
    child.once("close", () => {
      reject(
        new Error(`The run ended before its database was ready.\n${errors}`),
      );
    });
  });
  if (child.pid === undefined) throw new Error("The run has no process id.");
  const container = await containerAt(endpoint);
  containers.push(container);
  return { pid: child.pid, container };
}

describe("a killed integration run's database", () => {
  it.each([
    { killed: "the run", group: false },
    { killed: "the run and the Docker client it started", group: true },
  ])(
    "stops once $killed is killed, and no other run's does",
    async ({ group }) => {
      const { pid, container } = await startRun();

      process.kill(group ? -pid : pid, "SIGKILL");

      await expect
        .poll(() => running(container), { timeout: 15_000, interval: 250 })
        .toBe(false);
      const thisRun = await containerAt(inject("databaseEndpoint"));
      expect(await running(thisRun)).toBe(true);
    },
    // Longer than the run's own waits for its database, so a failure shows
    // as the run's error and not as a timeout.
    60_000,
  );
});

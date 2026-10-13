// The local DynamoDB a killed run leaves behind (#244, #254). Vitest stops
// the container in its teardown, which a killed run never reaches, so the
// container stops by itself once its run has gone. It is tied to the run,
// not to a process id or a hostname, which #254 found can mislead.
import { execFile, spawn, type ChildProcess } from "node:child_process";
import { createInterface } from "node:readline";
import { promisify } from "node:util";
import { afterAll, describe, expect, inject, it } from "vitest";

const run = promisify(execFile);

// The integration tier's global setup in a process of its own, as a vitest
// run has it. It writes the database's address once the database is ready,
// and then waits to be killed.
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

// The container publishing the local DynamoDB at this address.
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

// Starts a run in a process of its own, which leads its own process group,
// and gives its process id once its database is ready, with the database's
// container.
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
    // As when the run is killed with every process it started.
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

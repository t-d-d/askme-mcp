// The local DynamoDB a killed run leaves behind (#244). Vitest stops the
// container in its teardown, which a killed run never reaches, so the next
// run's setup removes it.
import { execFile, spawn } from "node:child_process";
import { once } from "node:events";
import { hostname } from "node:os";
import { promisify } from "node:util";
import { afterAll, describe, expect, it } from "vitest";
import { removeOrphans, startDatabase } from "./dynamodb";

const run = promisify(execFile);

// The id of a process that has already ended, as a killed run's is.
async function endedProcess(): Promise<number> {
  const child = spawn(process.execPath, ["-e", ""], { stdio: "ignore" });
  const { pid } = child;
  await once(child, "exit");
  if (pid === undefined) throw new Error("The process did not start.");
  return pid;
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

const started: string[] = [];
afterAll(async () => {
  await run("docker", ["rm", "--force", ...started]);
});

describe("a killed integration run's database", () => {
  it("is removed when the next run starts, and no other run's is", async () => {
    const ended = await endedProcess();
    const orphan = await startDatabase({ pid: ended, host: hostname() });
    const live = await startDatabase({ pid: process.pid, host: hostname() });
    // Another machine's process ids say nothing about this machine's, as
    // where two machines share one Docker daemon.
    const elsewhere = await startDatabase({
      pid: ended,
      host: `${hostname()}-elsewhere`,
    });
    started.push(orphan, live, elsewhere);

    await removeOrphans();

    expect(await running(orphan)).toBe(false);
    expect(await running(live)).toBe(true);
    expect(await running(elsewhere)).toBe(true);
  }, 30_000);
});

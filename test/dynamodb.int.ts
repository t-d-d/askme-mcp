// The local DynamoDB a killed run leaves behind (#244). Vitest stops the
// container in its teardown, which a killed run never reaches, so the next
// run's setup removes it.
import { execFile } from "node:child_process";
import { hostname } from "node:os";
import { promisify } from "node:util";
import { afterAll, describe, expect, inject, it } from "vitest";
import {
  alive,
  image,
  ownerLabels,
  ownerOf,
  removeOrphans,
  type Owner,
} from "./dynamodb";

const run = promisify(execFile);

// A process id above the largest Linux allows, and macOS's, so no process
// holds it, as none holds a killed run's.
const ended = 2 ** 22 + 1;

// A container labelled as a run's database. It only sleeps, and removes
// itself within a minute, so a test that is itself killed leaves nothing
// running for long.
async function startLabelled(owner: Owner): Promise<string> {
  const { stdout } = await run("docker", [
    "run",
    "--detach",
    "--rm",
    ...ownerLabels(owner),
    "--entrypoint",
    "sleep",
    image,
    "60",
  ]);
  const container = stdout.trim();
  started.push(container);
  return container;
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
  if (started.length > 0) await run("docker", ["rm", "--force", ...started]);
});

describe("a killed integration run's database", () => {
  it("is removed when the next run starts, and no other run's is", async () => {
    const [orphan, live, elsewhere] = await Promise.all([
      startLabelled({ pid: ended, host: hostname() }),
      startLabelled({ pid: process.pid, host: hostname() }),
      // Another machine's process ids say nothing about this machine's, as
      // where two machines share one Docker daemon.
      startLabelled({ pid: ended, host: `${hostname()}-elsewhere` }),
    ]);

    await removeOrphans();

    expect(await running(orphan)).toBe(false);
    expect(await running(live)).toBe(true);
    expect(await running(elsewhere)).toBe(true);
  }, 30_000);

  it("is labelled with this run, which is still going", async () => {
    const { port } = new URL(inject("databaseEndpoint"));
    const { stdout } = await run("docker", [
      "ps",
      "--quiet",
      "--filter",
      `publish=${port}`,
    ]);
    const owner = await ownerOf(stdout.trim());

    expect(owner.host).toBe(hostname());
    expect(alive(owner.pid)).toBe(true);
  }, 30_000);
});

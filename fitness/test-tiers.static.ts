import { describe, expect, it } from "vitest";
import { z } from "zod";
import { importRefused } from "../test/lint";
import {
  addressesIn,
  builtFrom,
  constantFor,
  liveTierFiles,
  signUpRequests,
  typedValues,
  valuesSetInPage,
} from "../test/live-tier";
import {
  conformancePath,
  deployPath,
  gatePath,
  readRepoFile,
  readWorkflow,
  repoFiles,
  runsIn,
  scripts,
  triggers,
  inConformanceEnvironment,
  type Job,
} from "../test/repo";
import { tierPattern, tiers } from "../test/tiers";

const projectsSchema = z.object({
  test: z.object({
    projects: z.array(
      z.object({
        test: z.object({
          name: z.string(),
          include: z.array(z.string()),
          setupFiles: z.array(z.string()),
        }),
      }),
    ),
  }),
});

const projects = async () =>
  projectsSchema.parse((await import("../vitest.config")).default).test
    .projects;

describe("fitness: tiers stay apart (test-tiers.md)", () => {
  it("gives each tier its own suffix, and none is bare .ts", () => {
    const suffixes = tiers.map((tier) => tier.suffix);
    expect(new Set(suffixes).size).toBe(tiers.length);
    for (const suffix of suffixes) expect(suffix).toMatch(/^\.[a-z]+\.ts$/u);
  });

  it("puts every test file in exactly one tier", () => {
    const misplaced = repoFiles()
      .filter((path) => /\.(?:[a-z]+)\.[cm]?[jt]sx?$/u.test(path))
      .filter((path) =>
        /\.(?:static|test|spec|int|browser|live|conformance|e2e)\.[cm]?[jt]sx?$/u.test(
          path,
        ),
      )
      .filter(
        (path) =>
          tiers.filter((tier) => path.endsWith(tier.suffix)).length !== 1,
      );
    expect(misplaced).toEqual([]);
  });

  it("runs each tier's files in a project of its own", async () => {
    expect(
      (await projects()).map(({ test }) => [test.name, test.include]),
    ).toEqual(tiers.map((tier) => [tier.name, [tierPattern(tier)]]));
  });

  it("keeps live and conformance out of the gate", () => {
    expect(
      tiers.filter((tier) => !tier.inGate).map((tier) => tier.suffix),
    ).toEqual([".live.ts", ".conformance.ts"]);
  });

  it("runs the gate's tiers in the gate, and the others on their own", () => {
    const gateTiers = tiers.filter((tier) => tier.inGate);
    expect(scripts().test).toBe(
      `vitest run ${gateTiers.map((tier) => `--project ${tier.name}`).join(" ")}`,
    );
    expect(scripts()["test:live"]).toBe("vitest run --project live");
    expect(scripts().conformance).toBe("vitest run --project conformance");
  });
});

describe("fitness: the gate is offline (test-tiers.md)", () => {
  it("loads the offline guard in every tier the gate runs", async () => {
    const guarded = (await projects())
      .filter(({ test }) => test.setupFiles.includes("test/offline.ts"))
      .map(({ test }) => test.name);
    expect(guarded).toEqual(
      tiers.filter((tier) => tier.inGate).map((tier) => tier.name),
    );
  });

  it("opens a browser only through the helper that keeps it offline", async () => {
    expect(
      await importRefused(
        'import { chromium } from "playwright";\nexport { chromium };\n',
        "web/signed-out.browser.ts",
      ),
    ).toBe(true);
  });
});

describe("fitness: MCP goes through a real client (test-tiers.md)", () => {
  const gateTests = () =>
    repoFiles().filter((path) =>
      tiers.some((tier) => tier.inGate && path.endsWith(tier.suffix)),
    );
  // The name of JSON-RPC's version field, built so this file does not hold it.
  const protocolField = ["json", "rpc"].join("");

  it("finds the MCP integration tests", () => {
    expect(mcpTests()).toEqual(expect.arrayContaining(["service/mcp.int.ts"]));
  });

  const officialClient =
    /import \{[^}]*\bClient\b[^}]*\} from "@modelcontextprotocol\/client";/u;

  it("connects through test/mcp.ts, which uses the official client", () => {
    expect(readRepoFile("test/mcp.ts")).toMatch(officialClient);
    expect(readRepoFile("test/mcp.ts")).toContain(
      "new StreamableHTTPClientTransport(",
    );
  });

  it("drives the MCP handler only from tests that use the official client", () => {
    for (const path of mcpTests()) {
      const text = readRepoFile(path);
      expect(
        officialClient.test(text) ||
          /import \{[^}]*\bconnect\b[^}]*\} from "[./]*test\/mcp";/u.test(text),
        path,
      ).toBe(true);
    }
  });

  it("writes no protocol message by hand in any test the gate runs", () => {
    const handWritten = gateTests().filter((path) =>
      new RegExp(`\\b${protocolField}\\b`, "u").test(readRepoFile(path)),
    );
    expect(handWritten).toEqual([]);
  });

  // An integration test that calls the service's handler, by its import,
  // and reaches its MCP endpoint. A test of the page's API alone never
  // speaks MCP.
  function mcpTests(): string[] {
    return repoFiles()
      .filter((path) => path.endsWith(".int.ts"))
      .filter((path) => {
        const text = readRepoFile(path);
        return (
          /from "[./]*(?:service\/)?src\/handler"/u.test(text) &&
          /\bmcpUrl\b|\bconnect\(|["'`}]\/mcp\b/u.test(text)
        );
      });
  }
});

describe("fitness: the gate holds no secrets (test-tiers.md)", () => {
  it("declares no secret in the gate's workflow", () => {
    // GitHub reads context names in any case.
    expect(readRepoFile(gatePath)).not.toMatch(/\bsecrets\b/iu);
  });

  it("passes no secret to the gate when deploying", () => {
    const { jobs } = readWorkflow(deployPath);
    expect(jobs.gate?.secrets).toBeUndefined();
  });

  it("gives the gate read-only access", () => {
    expect(readWorkflow(gatePath).permissions).toEqual({
      contents: "read",
    });
  });
});

describe("fitness: conformance runs daily and only reads (test-tiers.md)", () => {
  const path = conformancePath;
  it("runs the conformance tier every day, and nothing else", () => {
    const workflow = readWorkflow(path);
    expect(workflow.name).toBe("conformance");
    expect(triggers(workflow)).toEqual(["schedule", "workflow_dispatch"]);
    expect(Object.keys(workflow.jobs)).toEqual(["conformance"]);
    expect(runsIn(workflow.jobs.conformance)).toEqual([
      "npm ci",
      "npm run conformance",
    ]);
  });

  // A job may read less than the workflow allows. The one thing it may
  // write is a token request, and only in the conformance environment,
  // whose token the deploy role refuses (ADR 15).
  const onlyReads = (job: Job): boolean => {
    const { permissions } = job;
    if (permissions === undefined || permissions === "read-all") return true;
    if (typeof permissions === "string") return false;
    return Object.entries(permissions).every(
      ([scope, level]) =>
        level === "read" ||
        level === "none" ||
        (scope === "id-token" &&
          level === "write" &&
          inConformanceEnvironment(path, job)),
    );
  };

  it("tells a job that only reads from one that could write", () => {
    expect(onlyReads({})).toBe(true);
    expect(onlyReads({ permissions: {} })).toBe(true);
    expect(onlyReads({ permissions: { contents: "read" } })).toBe(true);
    expect(onlyReads({ permissions: { contents: "write" } })).toBe(false);
    expect(onlyReads({ permissions: "write-all" })).toBe(false);
    expect(onlyReads({ permissions: { "id-token": "write" } })).toBe(false);
    expect(
      onlyReads({
        permissions: { "id-token": "write" },
        environment: "conformance",
      }),
    ).toBe(true);
  });

  it("only reads, and cannot reach the deploy role", () => {
    const workflow = readWorkflow(path);
    expect(workflow.permissions).toEqual({ contents: "read" });
    for (const [id, job] of Object.entries(workflow.jobs)) {
      expect(onlyReads(job), id).toBe(true);
    }
    expect(readRepoFile(path)).not.toMatch(/AWS_DEPLOY_ROLE_ARN/iu);
  });
});

// The one test account of ADR 16: every address the live tier holds, with
// the file that holds it.
const liveAddresses = () =>
  liveTierFiles().flatMap((path) =>
    addressesIn(readRepoFile(path)).map((address) => ({ path, address })),
  );

// Every file the live tier runs or imports, by path, read as it is.
const liveSources = () =>
  Object.fromEntries(
    liveTierFiles().map((path) => [path, readRepoFile(path)] as const),
  );

// The test account's address, the file that holds it, and the names of the
// constants that hold the address and Clerk's test code.
function testAccount() {
  const found = liveAddresses();
  const [account] = found;
  if (found.length !== 1 || account === undefined) {
    throw new Error(
      `The live tier should hold one address. It holds ${String(found.length)}.`,
    );
  }
  const text = readRepoFile(account.path);
  return {
    ...account,
    text,
    name: constantFor(text, account.address),
    code: constantFor(text, "424242"),
  };
}

describe("fitness: the live tier signs in as one account (test-tiers.md)", () => {
  it("reads every live file and each file one imports", () => {
    expect(liveTierFiles()).toEqual(
      expect.arrayContaining([
        "service/api.live.ts",
        "shared/page-api.ts",
        "web/signed-in.live.ts",
      ]),
    );
  });

  it("finds every address written in a file", () => {
    expect(
      addressesIn(
        [
          'import "@scope/package";',
          'const a = "someone+clerk_test@example.com";',
          "// Write to help@example.org.",
          'const b = "x+clerk_test" + "@example.net";',
          "const c = `${user}@example.io`;",
        ].join("\n"),
      ),
    ).toEqual([
      "someone+clerk_test@example.com",
      "help@example.org",
      "@example.net",
      "@example.io",
    ]);
  });

  it("holds one address, carrying +clerk_test, in one live file", () => {
    const found = liveAddresses();
    expect(found).toHaveLength(1);
    for (const { path, address } of found) {
      expect(path).toMatch(/\.live\.ts$/u);
      expect(address).toMatch(/^[\w.-]+\+clerk_test@[\w-]+(?:\.[\w-]+)+$/u);
    }
  });

  it("writes the address once, as a constant", () => {
    const { text, address, name } = testAccount();
    expect(name).toBeDefined();
    expect(text.split(address)).toHaveLength(2);
  });

  it("tells a constant used as it is from one built on", () => {
    const usedAsItIs = [
      'export const account = "a@example.com";',
      'import { account, other } from "./account";',
      "await box.fill(account);",
      "expect(signUp.email).toBe(account);",
      "send(first, account, last);",
      'send(")", account);',
    ].join("\n");
    expect(builtFrom(usedAsItIs, "account")).toEqual([]);
    const builtOn = [
      "const copy = account;",
      "await box.fill(`x${account}`);",
      'await box.fill(account.replace("a", "b"));',
      'await box.fill("x" + account);',
      'await box.fill([account, "x"].join(""));',
      "await box.fill(sure ? account : other);",
      "await sign({ email: account });",
      "const wrapped = (account);",
      'await box.fill("x" + (account));',
      'await box.fill([")", account].join(""));',
      'import { account as renamed } from "./account";',
      'await box.fill("x".concat(account));',
      'await box.fill("{}".replace("{}", account));',
      'await box.fill("{}".replaceAll("{}", account));',
      'await box.fill("".padStart(40, account));',
      'await box.fill(String.prototype.concat.call("x", account));',
    ];
    expect(builtFrom(builtOn.join("\n"), "account")).toEqual(builtOn);
  });

  it("builds no address from the constant", () => {
    const { name } = testAccount();
    expect(name).toBeDefined();
    for (const path of liveTierFiles()) {
      expect(builtFrom(readRepoFile(path), name ?? ""), path).toEqual([]);
    }
  });

  it("names no secret in the deploy workflow's live job", () => {
    const { live } = readWorkflow(deployPath).jobs;
    expect(live).toBeDefined();
    // GitHub reads context names in any case.
    expect(JSON.stringify(live)).not.toMatch(/\bsecrets\b/iu);
  });

  it("gives the live tier no Clerk secret key, and no helper that needs one", () => {
    for (const path of liveTierFiles()) {
      expect(readRepoFile(path), path).not.toMatch(
        /CLERK_SECRET_KEY|\bsk_(?:test|live)_|@clerk\/(?:testing|backend)/u,
      );
    }
  });
});

describe("fitness: the live tier makes no other account (test-tiers.md)", () => {
  it("finds the value each call types", () => {
    expect(
      typedValues(
        [
          'await page.locator("#a").fill(account);',
          "await page.keyboard.type(code, { delay: 50 });",
          'await box.pressSequentially(`${"x"}@example.com`);',
          "await page.keyboard.insertText(other);",
          'await box.fill("a,b");',
        ].join("\n"),
      ),
    ).toEqual(["account", "code", '`${"x"}@example.com`', "other", '"a,b"']);
  });

  it("types nothing on Clerk's screens but the address and the code 424242", () => {
    const { name, code } = testAccount();
    expect(name).toBeDefined();
    expect(code).toBeDefined();
    const typed = liveTierFiles().flatMap((path) =>
      typedValues(readRepoFile(path)).map((value) => ({ path, value })),
    );
    expect(typed.map(({ value }) => value)).toContain(name);
    expect(
      typed.filter(({ value }) => value !== name && value !== code),
    ).toEqual([]);
  });

  it("finds each request a file sends to Clerk's sign-up path", () => {
    const sends = [
      'await fetch("https://clerk.example.com/v1/client/sign_ups", { method: "POST" });',
      "await page.request.post(new URL(signUps, frontendApi).href, { form });",
      'await api.fetch(`${frontendApi}${signUps}`, { method: "POST" });',
      "await post(signUpUrl);",
      'await page.evaluate((url) => fetch(url, { method: "POST" }), signUpUrl);',
      'await page.route("**/v1/client/sign_ups", (route) => route.continue({ postData }));',
      'await fetch(new URL(clerkSignUps, frontendApi), { method: "POST" });',
      'await fetch(frontendApi + picked, { method: "POST" });',
    ];
    const fromDefault = 'return fetch(url, { method: "PATCH" });';
    const sources = {
      "web/a.live.ts": [
        'import { clerkSignUps } from "../shared/paths";',
        'const signUps = "/v1/client/sign_ups";',
        'const { picked } = { picked: "/v1/client/sign_ups" };',
        'async function patchDefault(url = "/v1/client/sign_ups") {',
        `  ${fromDefault}`,
        "}",
        "await patchDefault();",
        "const signUpUrl = frontendApi + signUps;",
        "async function post(url: string) {",
        '  return fetch(url, { method: "POST" });',
        "}",
        "async function giveAddress(field: Locator, path: string) {",
        "  await field.fill(account);",
        "  await page.waitForResponse((response) => new URL(response.url()).pathname === path);",
        "}",
        "await giveAddress(field, signUps);",
        'await fetch(mcpUrl(), { method: "POST", body: "{}" });',
        'expect(response.headers.get("www-authenticate")).toBe("Bearer");',
        ...sends,
      ].join("\n"),
      "shared/paths.ts": 'export const clerkSignUps = "/v1/client/sign_ups";',
    };
    expect(signUpRequests(sources)).toEqual(
      [fromDefault, ...sends].map((line) => `web/a.live.ts: ${line}`),
    );
  });

  it("sends no request of its own to Clerk's sign-up path", () => {
    expect(signUpRequests(liveSources())).toEqual([]);
  });

  it("finds each script in the page that sets an input's value", () => {
    const sets = [
      'await page.evaluate(() => { document.querySelector("input").value = "x"; });',
      "await field.evaluate((input, value) => { (input as HTMLInputElement).value = value; }, other);",
      'await page.$eval("input", (input) => input.setAttribute("value", "x"));',
      'await field.evaluate((input) => Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(input, "x"));',
      "await field.evaluate(setValue, other);",
      'await page.evaluate(\'document.querySelector("input").value = "x"\');',
      'await page.evaluate(`document.querySelector("input").value = "${other}"`);',
      'await page.addInitScript(() => document.execCommand("insertText", false, "x"));',
      "await page.addScriptTag({ content: \"document.forms[0].email.value = 'x'\" });",
      'await page.waitForFunction(() => { document.querySelector("input").value = "x"; return true; });',
      'await field.evaluate((input) => Object.assign(input, { value: "x" }));',
    ];
    const text = [
      "function setValue(input: HTMLInputElement, value: string) {",
      "  input.value = value;",
      "}",
      "const state = { value: 1 };",
      "state.value = 2;",
      "await page.evaluate(() => document.documentElement.scrollWidth);",
      "await field.evaluate((input) => (input as HTMLInputElement).value);",
      ...sets,
    ].join("\n");
    expect(valuesSetInPage({ "a.live.ts": text })).toEqual(
      sets.map((line) => `a.live.ts: ${line}`),
    );
  });

  it("sets no input's value from a script in the page", () => {
    expect(valuesSetInPage(liveSources())).toEqual([]);
  });
});

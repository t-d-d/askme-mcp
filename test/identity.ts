// A stand-in for Clerk, whose tokens pass the real verification code.
import { createServer } from "node:http";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import { exportJWK, generateKeyPair, SignJWT, type JWTPayload } from "jose";
import { afterAll, beforeAll, vi } from "vitest";

export interface TokenOptions {
  // Undefined removes a claim.
  claims?: Partial<
    Record<keyof Claims, string | number | string[] | undefined>
  >;
  // Sign with a key this issuer does not publish.
  foreignKey?: boolean;
  // Clerk's OAuth access tokens are "at+jwt".
  typ?: string;
}

interface Claims {
  iss: string;
  sub: string;
  client_id: string;
  scope: string;
  scp: string[];
  sid: string;
  aud: string;
  iat: number;
  exp: number;
}

export interface FakeIssuer {
  // The issuer's address, as CLERK_ISSUER holds it.
  issuer: string;
  // An OAuth access token, as an agent holds.
  token(options?: TokenOptions): Promise<string>;
  // As the page holds: it names a session and carries no scope.
  sessionToken(options?: TokenOptions): Promise<string>;
  // While set, the key set answers 500.
  failing: boolean;
  close(): Promise<void>;
}

export const testAccount = "user_test";

export async function startFakeIssuer(): Promise<FakeIssuer> {
  const own = await generateKeyPair("RS256");
  const foreign = await generateKeyPair("RS256");
  const jwk = { ...(await exportJWK(own.publicKey)), kid: "test-key" };
  const state = { failing: false };

  const server = createServer((request, response) => {
    if (request.url === "/.well-known/jwks.json" && !state.failing) {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ keys: [jwk] }));
    } else {
      response.writeHead(state.failing ? 500 : 404).end();
    }
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const { port } = portOf(server.address());
  const issuer = `http://127.0.0.1:${String(port)}`;

  async function token(options: TokenOptions = {}) {
    const now = Math.floor(Date.now() / 1000);
    const claims: Record<string, unknown> = {
      iss: issuer,
      sub: testAccount,
      client_id: "client_test",
      scope: "asks:create",
      iat: now,
      exp: now + 3600,
      ...options.claims,
    };
    const payload: JWTPayload = Object.fromEntries(
      Object.entries(claims).filter(([, value]) => value !== undefined),
    );
    return new SignJWT(payload)
      .setProtectedHeader({
        alg: "RS256",
        kid: options.foreignKey === true ? "foreign-key" : "test-key",
        typ: options.typ ?? "at+jwt",
      })
      .sign(options.foreignKey === true ? foreign.privateKey : own.privateKey);
  }

  return {
    issuer,
    get failing() {
      return state.failing;
    },
    set failing(value: boolean) {
      state.failing = value;
    },
    token,
    sessionToken: (options = {}) =>
      token({
        ...options,
        typ: options.typ ?? "JWT",
        claims: {
          client_id: undefined,
          scope: undefined,
          sid: "sess_test",
          ...options.claims,
        },
      }),
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error === undefined) resolve();
          else reject(error);
        });
      }),
  };
}

// Starts the fake issuer before a file's tests and points CLERK_ISSUER at it.
// After them, puts back every variable the file stubbed and stops the issuer.
export function useFakeIssuer(): Omit<FakeIssuer, "close"> {
  let started: FakeIssuer | undefined;
  beforeAll(async () => {
    started = await startFakeIssuer();
    vi.stubEnv("CLERK_ISSUER", started.issuer);
  });
  afterAll(async () => {
    vi.unstubAllEnvs();
    await started?.close();
  });
  const running = (): FakeIssuer => {
    if (started === undefined) {
      throw new Error("The fake issuer starts in beforeAll.");
    }
    return started;
  };
  return {
    get issuer() {
      return running().issuer;
    },
    get failing() {
      return running().failing;
    },
    set failing(value: boolean) {
      running().failing = value;
    },
    token: (options) => running().token(options),
    sessionToken: (options) => running().sessionToken(options),
  };
}

function portOf(address: string | AddressInfo | null): AddressInfo {
  if (address === null || typeof address === "string") {
    throw new Error("The fake issuer has no port.");
  }
  return address;
}

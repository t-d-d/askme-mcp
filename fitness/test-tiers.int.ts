import { connect, createServer, Socket, type AddressInfo } from "node:net";
import { once } from "node:events";
import { describe, expect, it } from "vitest";

describe("fitness: the gate is offline (test-tiers.md)", () => {
  it("refuses a connection that is not to loopback", () => {
    expect(() => connect({ host: "192.0.2.1", port: 443 })).toThrow(
      /The gate is offline/u,
    );
    expect(() => connect(443, "example.com")).toThrow(/The gate is offline/u);
  });

  it("refuses a port written as a string, which Node does not read as a path", () => {
    const socket = new Socket();
    // Typed overloads take no string port, but Node accepts one.
    const connectTo = socket.connect.bind(socket);
    try {
      expect(() => {
        Reflect.apply(connectTo, undefined, ["443", "example.com"]);
      }).toThrow(/The gate is offline/u);
    } finally {
      socket.destroy();
    }
  });

  it("refuses a fetch from the internet", async () => {
    const error = await fetch("https://example.com/").catch(
      (reason: unknown) => reason,
    );
    expect(error).toBeInstanceOf(TypeError);
    expect(error instanceof Error ? String(error.cause) : "").toMatch(
      /The gate is offline/u,
    );
  });

  it("allows a connection to loopback", async () => {
    const server = createServer((socket) => socket.end("ok"));
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const { port } = portOf(server.address());
    try {
      const socket = connect(port, "127.0.0.1");
      const received: unknown[] = await once(socket, "data");
      expect(received[0]).toEqual(Buffer.from("ok"));
    } finally {
      server.close();
    }
  });
});

function portOf(address: string | AddressInfo | null): AddressInfo {
  if (address === null || typeof address === "string") {
    throw new Error("The server has no port.");
  }
  return address;
}

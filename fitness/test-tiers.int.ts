import { createSocket } from "node:dgram";
import { lookup, lookupService, resolve, Resolver } from "node:dns";
import {
  lookup as lookupAsync,
  resolve4 as resolve4Async,
  Resolver as ResolverAsync,
  reverse as reverseAsync,
} from "node:dns/promises";
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

  it("refuses a DNS lookup of a name that is not loopback", () => {
    const ignore = () => undefined;
    expect(() => {
      lookup("example.com", ignore);
    }).toThrow(/The gate is offline/u);
    expect(() => {
      resolve("example.com", ignore);
    }).toThrow(/The gate is offline/u);
    expect(() => {
      lookupService("192.0.2.1", 443, ignore);
    }).toThrow(/The gate is offline/u);
    expect(() => lookupAsync("example.com")).toThrow(/The gate is offline/u);
    expect(() => resolve4Async("example.com")).toThrow(/The gate is offline/u);
    expect(() => {
      new Resolver().resolve4("example.com", ignore);
    }).toThrow(/The gate is offline/u);
    expect(() => new ResolverAsync().resolve4("example.com")).toThrow(
      /The gate is offline/u,
    );
    expect(() => reverseAsync("192.0.2.1")).toThrow(/The gate is offline/u);
  });

  it("refuses a lookup that the hosts file may not answer, which asks a DNS server", () => {
    const ignore = () => undefined;
    expect(() => {
      lookup("api.localhost", ignore);
    }).toThrow(/The gate is offline/u);
    expect(() => {
      lookupService("127.0.0.2", 443, ignore);
    }).toThrow(/The gate is offline/u);
  });

  it("refuses every query of the resolve family, which always asks a DNS server", () => {
    expect(() => resolve4Async("localhost")).toThrow(/The gate is offline/u);
  });

  it("allows a DNS lookup of localhost", async () => {
    const { address } = await lookupAsync("localhost");
    expect(address).toMatch(/^(127\.|::1$)/u);
  });

  it("refuses a datagram to an address that is not loopback", () => {
    const socket = createSocket("udp4");
    try {
      expect(() => {
        socket.send("hi", 53, "192.0.2.1");
      }).toThrow(/The gate is offline/u);
      expect(() => {
        socket.send("hi", 0, 2, 53, "example.com");
      }).toThrow(/The gate is offline/u);
      expect(() => {
        socket.connect(53, "192.0.2.1");
      }).toThrow(/The gate is offline/u);
    } finally {
      socket.close();
    }
  });

  it("allows a datagram to loopback", async () => {
    const receiver = createSocket("udp4");
    receiver.bind(0, "127.0.0.1");
    await once(receiver, "listening");
    const sender = createSocket("udp4");
    try {
      sender.send("ok", receiver.address().port, "127.0.0.1");
      const received: unknown[] = await once(receiver, "message");
      expect(received[0]).toEqual(Buffer.from("ok"));
    } finally {
      sender.close();
      receiver.close();
    }
  });
});

function portOf(address: string | AddressInfo | null): AddressInfo {
  if (address === null || typeof address === "string") {
    throw new Error("The server has no port.");
  }
  return address;
}

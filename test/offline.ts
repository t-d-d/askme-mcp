// Setup for every tier in the gate. The gate is offline (ADR 9), so anything
// that would reach past loopback is refused before it leaves the machine: a
// TCP or TLS connection, a DNS lookup, and a UDP datagram.
import dgram from "node:dgram";
import dns from "node:dns";
import { syncBuiltinESMExports } from "node:module";
import net from "node:net";
import { isLoopbackHost } from "./loopback";

// Every TCP and TLS connection Node makes, fetch included, passes through
// Socket.prototype.connect.
// eslint-disable-next-line @typescript-eslint/unbound-method -- called below with the socket as this
const connect = net.Socket.prototype.connect;

net.Socket.prototype.connect = function guardedConnect(
  this: net.Socket,
  ...args: unknown[]
): net.Socket {
  const host = targetHost(args);
  if (host !== undefined && !isLoopbackHost(host)) {
    throw new Error(`The gate is offline: refused a connection to ${host}.`);
  }
  Reflect.apply(connect, this, args);
  return this;
};

// The host a connect call is aimed at, or undefined for a local socket path.
function targetHost(args: unknown[]): string | undefined {
  const [first, second] = args;
  // net.connect() hands its arguments over already normalised, as an array.
  const options: unknown = Array.isArray(first) ? first[0] : first;
  // Node reads a string as a port when it is a number, and as a path otherwise.
  const isPort =
    typeof options === "number" ||
    (typeof options === "string" && Number(options) >= 0);
  if (isPort) return typeof second === "string" ? second : "localhost";
  if (typeof options === "string") return undefined;
  if (typeof options !== "object" || options === null) return "localhost";
  if ("path" in options && typeof options.path === "string") return undefined;
  return "host" in options && typeof options.host === "string"
    ? options.host
    : "localhost";
}

// lookup hands an address back as it is. It looks a name up in the hosts
// file, and asks a DNS server when the file has no line for that name and
// family. A hosts file may name localhost for IPv4 only, so the guard
// answers localhost itself: it passes on ::1 in its place for an IPv6
// lookup, and 127.0.0.1 for any other. Any other name, even one under
// .localhost, would go to a DNS server, so it is refused. lookupService
// asks a DNS server about any address the hosts file does not name, such as
// 127.0.0.2, and the resolve family and reverse always ask one, so every
// call to them is refused. Each module binds its own copies of the Resolver
// methods, so the modules and the prototypes are both guarded.
for (const functions of [dns, dns.promises]) {
  guardLookup(functions, "lookup", (name, options) => {
    if (net.isIP(name) !== 0) return name;
    if (name.toLowerCase() !== "localhost") return undefined;
    return asksForIPv6(options) ? "::1" : "127.0.0.1";
  });
  guardLookup(functions, "lookupService", () => undefined);
}
for (const functions of [
  dns,
  dns.promises,
  dns.Resolver.prototype,
  dns.promises.Resolver.prototype,
]) {
  for (const key of Object.getOwnPropertyNames(functions)) {
    if (key === "reverse" || key.startsWith("resolve")) {
      guardLookup(functions, key, () => undefined);
    }
  }
}
// A named import of node:dns reads these copies, not the module's own.
syncBuiltinESMExports();

// lookup takes the family as a number, or as an option given as a number or
// a name.
function asksForIPv6(options: unknown): boolean {
  const family =
    typeof options === "object" && options !== null && "family" in options
      ? options.family
      : options;
  return family === 6 || family === "IPv6";
}

// passOn gives the name to look up in place of the one asked for, or
// undefined to refuse the lookup.
function guardLookup(
  functions: object,
  key: string,
  passOn: (name: string, options: unknown) => string | undefined,
): void {
  const original: unknown = Reflect.get(functions, key);
  if (typeof original !== "function") {
    throw new Error(`The offline guard found no DNS function ${key}.`);
  }
  const guarded = Reflect.set(
    functions,
    key,
    function guardedLookup(this: unknown, ...args: unknown[]): unknown {
      const [name, options] = args;
      if (typeof name === "string") {
        const passed = passOn(name, options);
        if (passed === undefined) {
          throw new Error(
            `The gate is offline: refused a DNS lookup of ${name}.`,
          );
        }
        args = [passed, ...args.slice(1)];
      }
      const result: unknown = Reflect.apply(original, this, args);
      return result;
    },
  );
  if (!guarded) {
    throw new Error(`The offline guard could not replace DNS function ${key}.`);
  }
}

// A UDP socket sends where send names, or where connect pointed it.
// eslint-disable-next-line @typescript-eslint/unbound-method -- called below with the socket as this
const { connect: connectUdp, send } = dgram.Socket.prototype;

dgram.Socket.prototype.connect = function guardedUdpConnect(
  this: dgram.Socket,
  ...args: unknown[]
): void {
  refuseDatagram(args[1]);
  Reflect.apply(connectUdp, this, args);
};

dgram.Socket.prototype.send = function guardedSend(
  this: dgram.Socket,
  ...args: unknown[]
): void {
  // Node reads (msg, offset, length, port, address) when the last two are
  // given, and (msg, port, address) otherwise. A connected socket names no
  // address here, and sends where connect, already guarded, pointed it.
  const [, , length, port, address] = args;
  const isFull =
    Boolean(address) || (Boolean(port) && typeof port !== "function");
  refuseDatagram(isFull ? address : length);
  Reflect.apply(send, this, args);
};

// Node sends to loopback when no address is given.
function refuseDatagram(address: unknown): void {
  if (
    typeof address === "string" &&
    address !== "" &&
    !isLoopbackHost(address)
  ) {
    throw new Error(`The gate is offline: refused a datagram to ${address}.`);
  }
}

// Setup for every tier in the gate. The gate is offline (ADR 9), so any
// connection that is not to loopback is refused before it leaves the machine.
// Every TCP and TLS connection Node makes, fetch included, passes through
// Socket.prototype.connect.
import net from "node:net";
import { isLoopbackHost } from "./loopback";

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

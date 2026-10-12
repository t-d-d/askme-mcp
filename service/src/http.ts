// The HTTP boundary (ADR 10). API Gateway's HTTP API hands the function a
// version 2.0 event. This module parses it into a web Request, and turns the
// Response back into the result API Gateway expects. It is the only module
// that reads a request's body.
import { z } from "zod";

const eventSchema = z.object({
  routeKey: z.string(),
  rawPath: z.string(),
  rawQueryString: z.string(),
  headers: z.record(z.string(), z.string()).default({}),
  body: z.string().optional(),
  isBase64Encoded: z.boolean(),
  requestContext: z.object({
    // API Gateway's ids are base64, such as "JKJaXmPLvHcESHA=".
    requestId: z.string().regex(/^[\w+/=-]{1,128}$/u),
    domainName: z.string().regex(/^[a-z0-9.-]+(?::\d+)?$/iu),
    http: z.object({ method: z.string() }),
  }),
});

export interface Incoming {
  // The route API Gateway matched, as "METHOD /path".
  route: string;
  // API Gateway's id for the request, which every log line carries.
  requestId: string;
  // The address the caller used, such as https://abc.execute-api.us-east-1.amazonaws.com.
  origin: string;
  request: Request;
}

export function incoming(event: unknown): Incoming | undefined {
  const parsed = eventSchema.safeParse(event);
  if (!parsed.success) return undefined;
  const { data } = parsed;
  // eslint-disable-next-line no-restricted-syntax -- this module is where a body is read
  const { body: raw } = data;
  const origin = `https://${data.requestContext.domainName}`;
  const query = data.rawQueryString === "" ? "" : `?${data.rawQueryString}`;
  const method = data.requestContext.http.method;
  const hasBody = method !== "GET" && method !== "HEAD";
  const body =
    raw === undefined || !hasBody
      ? null
      : data.isBase64Encoded
        ? Buffer.from(raw, "base64")
        : raw;
  return {
    route: data.routeKey,
    requestId: data.requestContext.requestId,
    origin,
    request: new Request(`${origin}${data.rawPath}${query}`, {
      method,
      headers: data.headers,
      body,
    }),
  };
}

// A request's body as JSON, for its caller to parse with its own schema, or
// undefined when it has none or it is not JSON.
export async function jsonBody(request: Request): Promise<unknown> {
  try {
    return await request.json(); // eslint-disable-line no-restricted-syntax -- this module is where a body is read
  } catch {
    return undefined;
  }
}

// The Authorization header, if the request has one. API Gateway joins a
// repeated header with commas, and only the first counts.
export function authorizationOf(request: Request): string | undefined {
  return request.headers.get("authorization")?.split(",")[0];
}

export interface Result {
  statusCode: number;
  headers: Record<string, string>;
  body: string;
  isBase64Encoded: false;
}

export async function result(response: Response): Promise<Result> {
  const headers: Record<string, string> = {};
  response.headers.forEach((value, name) => {
    headers[name] = value;
  });
  return {
    statusCode: response.status,
    headers,
    // eslint-disable-next-line no-restricted-syntax -- this module is where a body is read
    body: await response.text(),
    isBase64Encoded: false,
  };
}

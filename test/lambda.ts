// Calls a Lambda handler in process as API Gateway's HTTP API would, so a
// test or the MCP client can speak HTTP to it with no socket.
import { randomUUID } from "node:crypto";
import { z } from "zod";

export type LambdaHandler = (event: unknown) => Promise<unknown>;

const resultSchema = z.object({
  statusCode: z.number().int(),
  headers: z.record(z.string(), z.string()).optional(),
  body: z.string().optional(),
  isBase64Encoded: z.boolean().optional(),
});

export async function invoke(
  handler: LambdaHandler,
  request: Request,
): Promise<Response> {
  const url = new URL(request.url);
  const headers: Record<string, string> = {};
  request.headers.forEach((value, name) => {
    headers[name] = value;
  });
  const body = request.body === null ? undefined : await request.text();
  const result = resultSchema.parse(
    await handler({
      version: "2.0",
      routeKey: `${request.method} ${url.pathname}`,
      rawPath: url.pathname,
      rawQueryString: url.search.slice(1),
      headers,
      ...(body === undefined ? {} : { body }),
      isBase64Encoded: false,
      requestContext: {
        accountId: "000000000000",
        apiId: "test",
        domainName: url.host,
        domainPrefix: url.host.split(".")[0],
        http: {
          method: request.method,
          path: url.pathname,
          protocol: "HTTP/1.1",
          sourceIp: "127.0.0.1",
          userAgent: request.headers.get("user-agent") ?? "",
        },
        requestId: randomUUID(),
        routeKey: `${request.method} ${url.pathname}`,
        stage: "$default",
        time: new Date().toUTCString(),
        timeEpoch: Date.now(),
      },
    }),
  );
  const noBody = [204, 205, 304].includes(result.statusCode);
  const text =
    result.isBase64Encoded === true
      ? Buffer.from(result.body ?? "", "base64").toString("utf8")
      : (result.body ?? "");
  return new Response(noBody ? null : text, {
    status: result.statusCode,
    headers: result.headers ?? {},
  });
}

export function handlerFetch(
  handler: LambdaHandler,
  seen: Response[] = [],
): (input: string | URL | Request, init?: RequestInit) => Promise<Response> {
  return async (input, init) => {
    const response = await invoke(handler, new Request(input, init));
    seen.push(response.clone());
    return response;
  };
}

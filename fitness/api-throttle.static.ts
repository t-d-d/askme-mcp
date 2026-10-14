import { describe, expect, it } from "vitest";
import { z } from "zod";
import { readYaml } from "../test/repo";

// The most the record allows: requests a second, and the burst (ADR 31).
const rate = 50;
const burst = 100;

// The Serverless Framework names the HTTP API's one stage this.
const stageId = "HttpApiStage";

const settingsSchema = z.object({
  ThrottlingRateLimit: z.number().optional(),
  ThrottlingBurstLimit: z.number().optional(),
});

type Settings = z.infer<typeof settingsSchema>;

const resourceSchema = z.object({
  Type: z.string().optional(),
  Properties: z
    .object({
      DefaultRouteSettings: settingsSchema.optional(),
      RouteSettings: z.record(z.string(), settingsSchema).optional(),
    })
    .optional(),
});

const definition = () =>
  readYaml(
    "serverless.yml",
    z.object({
      provider: z.object({
        httpApi: z.object({ id: z.unknown().optional() }).optional(),
      }),
      resources: z.object({
        Resources: z.record(z.string(), resourceSchema).optional(),
        extensions: z.record(z.string(), resourceSchema).optional(),
      }),
    }),
  );

const stage = () => definition().resources.extensions?.[stageId]?.Properties;

// A value fails the record when it is missing, not above zero, above the
// most, or, for a burst, not a whole number.
function fault(
  name: string,
  value: number | undefined,
  most: number,
  whole: boolean,
): string[] {
  if (value === undefined) return [`no ${name}`];
  const fits =
    value > 0 && value <= most && (!whole || Number.isInteger(value));
  return fits ? [] : [`${name} ${String(value)}`];
}

const faults = (settings: Settings | undefined): string[] => [
  ...fault("rate", settings?.ThrottlingRateLimit, rate, false),
  ...fault("burst", settings?.ThrottlingBurstLimit, burst, true),
];

// The framework's own logical ids for the HTTP API and its stage. An entry
// under Resources with either id, even with no Type, is merged into the
// framework's resource, so it could set the stage's throttle outside the
// extension.
const frameworkIds = ["HttpApi", stageId];
const apiTypes = ["AWS::ApiGatewayV2::Api", "AWS::ApiGatewayV2::Stage"];

const ownApis = (
  resources: Record<string, z.infer<typeof resourceSchema>>,
): string[] =>
  Object.entries(resources)
    .filter(
      ([id, resource]) =>
        frameworkIds.includes(id) || apiTypes.includes(resource.Type ?? ""),
    )
    .map(([id]) => id);

describe("fitness: the API's stage has a throttle (api-throttle.md)", () => {
  it("throttles every route of the framework's stage by default", () => {
    expect(faults(stage()?.DefaultRouteSettings)).toEqual([]);
  });

  // A route's own settings take the place of the default's.
  it("lets no route go above the default", () => {
    const routes = Object.entries(stage()?.RouteSettings ?? {});
    expect(
      routes.flatMap(([route, settings]) =>
        faults(settings).map((fault) => `${route}: ${fault}`),
      ),
    ).toEqual([]);
  });

  // An API or stage of the file's own would carry none of the throttle.
  it("declares no HTTP API or stage of its own", () => {
    const { provider, resources } = definition();
    expect(provider.httpApi?.id).toBeUndefined();
    expect(ownApis(resources.Resources ?? {})).toEqual([]);
  });

  it("finds an API or stage of the file's own", () => {
    expect(
      ownApis({
        Api: { Type: "AWS::ApiGatewayV2::Api" },
        Stage: { Type: "AWS::ApiGatewayV2::Stage" },
        [stageId]: { Properties: {} },
        Table: { Type: "AWS::DynamoDB::Table" },
      }),
    ).toEqual(["Api", "Stage", stageId]);
  });

  it("finds each way a throttle fails", () => {
    expect(faults(undefined)).toEqual(["no rate", "no burst"]);
    expect(
      faults({ ThrottlingRateLimit: rate, ThrottlingBurstLimit: burst }),
    ).toEqual([]);
    expect(
      faults({ ThrottlingRateLimit: 0, ThrottlingBurstLimit: burst + 1 }),
    ).toEqual(["rate 0", `burst ${String(burst + 1)}`]);
    expect(
      faults({ ThrottlingRateLimit: rate + 0.5, ThrottlingBurstLimit: 1.5 }),
    ).toEqual([`rate ${String(rate + 0.5)}`, "burst 1.5"]);
  });
});

// Every route draws on the default's one allowance (ADR 35). A route's own
// settings could give it a second, so the total would grow past the
// record's arithmetic.
describe("fitness: no route has a throttle of its own (api-throttle.md)", () => {
  it("gives no route settings of its own", () => {
    expect(Object.keys(stage()?.RouteSettings ?? {})).toEqual([]);
  });
});

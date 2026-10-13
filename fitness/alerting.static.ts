import { describe, expect, it } from "vitest";
import { z } from "zod";
import { events } from "../service/src/log";
import {
  readRepoFile,
  readYaml,
  resourceSchema,
  templateSchema,
} from "../test/repo";

// Each file is parsed once per test file, as the checks read them often.
type Definition = ReturnType<typeof readDefinition>;
const readDefinition = () =>
  readYaml(
    "serverless.yml",
    z.object({
      functions: z.record(
        z.string(),
        z.object({
          events: z.array(z.record(z.string(), z.unknown())).optional(),
        }),
      ),
      resources: z.object({ Resources: z.record(z.string(), resourceSchema) }),
    }),
  );
let parsedDefinition: Definition | undefined;
const definition = (): Definition => (parsedDefinition ??= readDefinition());

type Declared = [string, z.infer<typeof resourceSchema>][];
let parsedDeclared: Declared | undefined;
const declared = (): Declared =>
  (parsedDeclared ??= [
    ...Object.entries(definition().resources.Resources),
    ...Object.entries(
      readYaml("infra/github-oidc.cfn.yml", templateSchema).Resources,
    ),
  ]);

const ofType = (type: string) =>
  declared().filter(([, resource]) => resource.Type === type);

// The framework names a function's resources after the function: "mcp" gets
// McpLambdaFunction and McpLogGroup.
const normalized = (name: string): string => {
  const spelled = name.replaceAll("-", "Dash").replaceAll("_", "Underscore");
  return spelled.charAt(0).toUpperCase() + spelled.slice(1);
};
const functionId = (name: string) => `${normalized(name)}LambdaFunction`;
const logGroupId = (name: string) => `${normalized(name)}LogGroup`;
const functionNames = () => Object.keys(definition().functions);

const askmeResources = (): Set<string> => {
  const { functions } = definition();
  const api = Object.values(functions).some((fn) =>
    (fn.events ?? []).some((event) => "httpApi" in event),
  );
  return new Set([
    ...declared().map(([id]) => id),
    ...Object.keys(functions).flatMap((name) => [
      functionId(name),
      logGroupId(name),
    ]),
    ...(api ? ["HttpApi"] : []),
  ]);
};

const refSchema = z.object({ Ref: z.string() });
const ref = (id: string) => ({ Ref: id });

const metricSchema = z.object({
  Namespace: z.string(),
  MetricName: z.string(),
  Dimensions: z
    .array(z.object({ Name: z.string(), Value: z.unknown() }))
    .optional(),
});
type Metric = z.infer<typeof metricSchema>;

const alarmSchema = z.looseObject({
  AlarmName: z.string(),
  AlarmDescription: z.string(),
  AlarmActions: z.array(z.unknown()),
  OKActions: z.array(z.unknown()).optional(),
  InsufficientDataActions: z.array(z.unknown()).optional(),
  Namespace: z.string().optional(),
  MetricName: z.string().optional(),
  Dimensions: metricSchema.shape.Dimensions,
  Threshold: z.unknown(),
  Metrics: z
    .array(
      z.object({
        Id: z.string(),
        Expression: z.string().optional(),
        MetricStat: z.object({ Metric: metricSchema }).optional(),
      }),
    )
    .optional(),
});
type Alarm = z.infer<typeof alarmSchema>;

const alarms = (): Alarm[] =>
  ofType("AWS::CloudWatch::Alarm").map(([, resource]) =>
    alarmSchema.parse(resource.Properties),
  );

const alarmNamed = (name: string): Alarm | undefined =>
  alarms().find((alarm) => alarm.AlarmName === name);

const metricsOf = (alarm: Alarm): Metric[] => {
  if (alarm.Metrics !== undefined) {
    return alarm.Metrics.flatMap((entry) =>
      entry.MetricStat === undefined ? [] : [entry.MetricStat.Metric],
    );
  }
  return [
    metricSchema.parse({
      Namespace: alarm.Namespace,
      MetricName: alarm.MetricName,
      Dimensions: alarm.Dimensions,
    }),
  ];
};

// SELECT starts a Metrics Insights query.
const searches = (expression: string): boolean =>
  /\b(?:SEARCH|SELECT)\b/iu.test(expression);

// The alarm set as alerting.md words it, one alarm name each: "error lines"
// is the alarm askme-error-lines.
const declaredAlarmNames = (): string[] => {
  const text = readRepoFile("docs/constraints/alerting.md").replaceAll(
    "\n  ",
    " ",
  );
  const set = /^- The alarm set is exactly: ([^.]+)\./mu.exec(text)?.[1];
  expect(set, "the alarm set in alerting.md").toBeDefined();
  return (set ?? "")
    .split(",")
    .map((name) => `askme-${name.trim().replaceAll(" ", "-")}`);
};

// Anything that alerts someone, whatever AWS calls it.
const alerting = new Set([
  "AWS::CloudWatch::Alarm",
  "AWS::CloudWatch::CompositeAlarm",
  "AWS::Budgets::Budget",
  "AWS::Budgets::BudgetsAction",
  "AWS::CE::AnomalySubscription",
]);

const errorLevel = '{ $.level = "ERROR" }';

const filterSchema = z.looseObject({
  LogGroupName: z.unknown(),
  FilterPattern: z.string(),
  MetricTransformations: z.array(
    z.looseObject({
      MetricNamespace: z.string(),
      MetricName: z.string(),
      MetricValue: z.string(),
    }),
  ),
});

const filters = () =>
  ofType("AWS::Logs::MetricFilter").map(([id, resource]) => ({
    id,
    ...filterSchema.parse(resource.Properties),
  }));

const querySchema = z.looseObject({
  Name: z.string(),
  QueryString: z.string(),
  LogGroupNames: z.array(z.unknown()),
});

const queries = () =>
  ofType("AWS::Logs::QueryDefinition").map(([, resource]) =>
    querySchema.parse(resource.Properties),
  );

// Of the strings a query quotes, only event names are lower case and
// hyphenated.
const eventShape = /^[a-z]+(?:-[a-z]+)+$/u;
const eventsIn = (query: string): string[] =>
  [...query.matchAll(/"([^"]*)"|'([^']*)'/gu)]
    .map((match) => match[1] ?? match[2] ?? "")
    .filter((quoted) => eventShape.test(quoted));

describe("fitness: every function is in the net (alerting.md)", () => {
  const net = () => {
    const alarm = alarmNamed("askme-error-lines");
    expect(alarm, "the error-lines alarm").toBeDefined();
    return alarm === undefined ? [] : metricsOf(alarm);
  };

  it("reads one metric for error lines", () => {
    expect(net()).toHaveLength(1);
  });

  it("gives every function one filter on the error level, feeding that metric", () => {
    const [metric] = net();
    for (const name of functionNames()) {
      const own = filters().filter(
        (filter) =>
          JSON.stringify(filter.LogGroupName) ===
          JSON.stringify(ref(logGroupId(name))),
      );
      expect(own, name).toHaveLength(1);
      expect(own[0]?.FilterPattern, name).toBe(errorLevel);
      expect(own[0]?.MetricTransformations, name).toEqual([
        {
          MetricNamespace: metric?.Namespace,
          MetricName: metric?.MetricName,
          MetricValue: "1",
        },
      ]);
    }
  });

  // Any other filter would make a metric of warnings or product numbers,
  // which are counted by saved query instead. Each function has exactly one
  // net filter, so one filter per function leaves room for no other.
  it("has no metric filter but the error net", () => {
    expect(filters().map((filter) => filter.id)).toHaveLength(
      functionNames().length,
    );
  });

  it("reads every function's errors, timeouts and throttles in the function-failures alarm", () => {
    const alarm = alarmNamed("askme-function-failures");
    expect(alarm, "the function-failures alarm").toBeDefined();
    const read = alarm === undefined ? [] : metricsOf(alarm);
    for (const name of functionNames()) {
      for (const metricName of ["Errors", "Throttles"]) {
        expect(read, `${name} ${metricName}`).toContainEqual({
          Namespace: "AWS/Lambda",
          MetricName: metricName,
          Dimensions: [{ Name: "FunctionName", Value: ref(functionId(name)) }],
        });
      }
    }
  });

  it("names a function's resources as the framework does", () => {
    expect(functionId("mcp")).toBe("McpLambdaFunction");
    expect(logGroupId("mcp")).toBe("McpLogGroup");
    expect(logGroupId("sort-asks")).toBe("SortDashasksLogGroup");
    expect(logGroupId("sort_asks")).toBe("SortUnderscoreasksLogGroup");
  });
});

describe("fitness: every alarm reaches the topic (alerting.md)", () => {
  const topics = () => ofType("AWS::SNS::Topic").map(([id]) => id);

  it("declares one alert topic", () => {
    expect(topics()).toHaveLength(1);
  });

  it("sends every alarm to that topic and nowhere else", () => {
    const [topic] = topics();
    expect(alarms().length).toBeGreaterThan(0);
    for (const alarm of alarms()) {
      expect(alarm.AlarmActions, alarm.AlarmName).toEqual([ref(topic ?? "")]);
      for (const actions of [
        alarm.OKActions ?? [],
        alarm.InsufficientDataActions ?? [],
      ]) {
        for (const action of actions) {
          expect(action, alarm.AlarmName).toEqual(ref(topic ?? ""));
        }
      }
    }
  });

  it("emails the topic to the address in /askme/alerts/email", () => {
    const [topic] = topics();
    const subscriptions = ofType("AWS::SNS::Subscription").map(
      ([, resource]) => resource.Properties,
    );
    expect(subscriptions).toEqual([
      {
        Protocol: "email",
        TopicArn: ref(topic ?? ""),
        Endpoint: "${ssm:/askme/alerts/email}",
      },
    ]);
  });
});

describe("fitness: alarms are scoped (alerting.md)", () => {
  // The one exception, by ADR 17: the account holds askme alone, so its bill
  // is askme's.
  const bill: Metric = {
    Namespace: "AWS/Billing",
    MetricName: "EstimatedCharges",
    Dimensions: [{ Name: "Currency", Value: "USD" }],
  };

  // A metric is askme's when askme alone writes it, or when one of its
  // dimensions names a resource askme declares.
  const scoped = (metric: Metric, ours: Set<string>): boolean =>
    metric.Namespace === "askme" ||
    (metric.Dimensions ?? []).some((dimension) => {
      const named = refSchema.safeParse(dimension.Value);
      return named.success && ours.has(named.data.Ref);
    });

  it("lets spend read the account's bill and nothing else", () => {
    const spend = alarmNamed("askme-spend");
    expect(spend, "the spend alarm").toBeDefined();
    expect(spend === undefined ? [] : metricsOf(spend)).toEqual([bill]);
    expect(spend?.Threshold).toBe("${ssm:/askme/alerts/monthly-spend}");
  });

  it("reads only askme's own metrics in every other alarm", () => {
    const ours = askmeResources();
    const wide = alarms()
      .filter((alarm) => alarm.AlarmName !== "askme-spend")
      .flatMap((alarm) =>
        metricsOf(alarm)
          .filter((metric) => !scoped(metric, ours))
          .map((metric) => `${alarm.AlarmName}: ${metric.MetricName}`),
      );
    expect(wide).toEqual([]);
  });

  // An expression that finds metrics for itself, by SEARCH or a Metrics
  // Insights query, reads whatever matches across the account. No dimension
  // scopes it, and metricsOf cannot see what it reads.
  it("finds no metric by search in any alarm", () => {
    const searching = alarms().flatMap((alarm) =>
      (alarm.Metrics ?? [])
        .filter((entry) => searches(entry.Expression ?? ""))
        .map((entry) => `${alarm.AlarmName}: ${entry.Id}`),
    );
    expect(searching).toEqual([]);
  });

  it("tells an expression that searches from one over its own metrics", () => {
    expect(searches("SUM(METRICS())")).toBe(false);
    expect(
      searches("IF(requests > 0, 100 * FILL(serverErrors, 0) / requests, 0)"),
    ).toBe(false);
    expect(
      searches(
        `SEARCH('{AWS/Lambda,FunctionName} MetricName="Errors"', 'Sum', 60)`,
      ),
    ).toBe(true);
    expect(
      searches('SELECT SUM(Errors) FROM SCHEMA("AWS/Lambda", FunctionName)'),
    ).toBe(true);
  });

  it("tells a scoped metric from an account-wide one", () => {
    const ours = new Set(["McpLambdaFunction"]);
    const lambda = (value: unknown): Metric => ({
      Namespace: "AWS/Lambda",
      MetricName: "Errors",
      Dimensions: [{ Name: "FunctionName", Value: value }],
    });
    expect(scoped(lambda(ref("McpLambdaFunction")), ours)).toBe(true);
    expect(scoped(lambda(ref("SomeoneElse")), ours)).toBe(false);
    expect(scoped(lambda("askme-prod-mcp"), ours)).toBe(false);
    expect(
      scoped({ Namespace: "AWS/Lambda", MetricName: "Errors" }, ours),
    ).toBe(false);
    expect(scoped(bill, ours)).toBe(false);
    expect(scoped({ Namespace: "askme", MetricName: "ErrorLines" }, ours)).toBe(
      true,
    );
  });
});

describe("fitness: the alarm set is the declared set (alerting.md)", () => {
  it("reads four alarms from alerting.md", () => {
    expect(declaredAlarmNames()).toEqual([
      "askme-error-lines",
      "askme-function-failures",
      "askme-server-errors",
      "askme-spend",
    ]);
  });

  it("declares exactly those alarms, and nothing else that alerts", () => {
    const alerts = declared().filter(([, resource]) =>
      alerting.has(resource.Type),
    );
    expect(
      alerts.every(
        ([, resource]) => resource.Type === "AWS::CloudWatch::Alarm",
      ),
    ).toBe(true);
    expect(
      alarms()
        .map((alarm) => alarm.AlarmName)
        .sort(),
    ).toEqual(declaredAlarmNames().sort());
  });
});

describe("fitness: saved queries use real events (alerting.md)", () => {
  it("names only events from the exported list", () => {
    const known = new Set<string>(events);
    const unknown = queries().flatMap((query) =>
      eventsIn(query.QueryString)
        .filter((event) => !known.has(event))
        .map((event) => `${query.Name}: ${event}`),
    );
    expect(queries().length).toBeGreaterThan(0);
    expect(unknown).toEqual([]);
  });

  it("finds the events a query names, in either quote", () => {
    expect(
      eventsIn(
        `filter message.event = "ask-posted" or message.event in ["token-missing", 'scope-missing']
        | filter type = "platform.report" and level = "ERROR"`,
      ),
    ).toEqual(["ask-posted", "token-missing", "scope-missing"]);
  });
});

describe("fitness: product numbers are saved queries (alerting.md)", () => {
  it("has one for every event the service logs", () => {
    const named = new Set(
      queries().flatMap((query) => eventsIn(query.QueryString)),
    );
    const missing = events.filter((event) => !named.has(event));
    expect(missing).toEqual([]);
  });

  it("reads every function's log group in each", () => {
    for (const query of queries()) {
      for (const name of functionNames()) {
        expect(query.LogGroupNames, query.Name).toContainEqual(
          ref(logGroupId(name)),
        );
      }
    }
  });
});

describe("fitness: alarm descriptions name the first query (alerting.md)", () => {
  it("say what kind each alarm is and name a saved query to run first", () => {
    const saved = queries().map((query) => query.Name);
    expect(alarms().length).toBeGreaterThan(0);
    for (const alarm of alarms()) {
      expect(alarm.AlarmDescription, alarm.AlarmName).toMatch(
        /^\[(?:tripwire|rate)\] /u,
      );
      const first = /\baskme\/[a-z-]+/u.exec(alarm.AlarmDescription)?.[0];
      expect(saved, alarm.AlarmName).toContain(first);
    }
  });
});

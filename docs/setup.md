# Setup

How to run askme's checks on a laptop. The accounts and settings a new deployment needs are in [bootstrap.md](bootstrap.md).

## What you need

Node.js 22.18 or later (see [.node-version](../.node-version)) and Docker. The integration tests run DynamoDB Local in Docker, and the gate starts it.

## The gate

```
npm ci
npx playwright install chromium
npm run gate
```

`npm run gate` runs format, lint, types, and the static, unit, integration and browser tests. CI runs the same command. [testing.md](testing.md) says what each tier checks.

## The eval set

`npm run eval` runs the eval set against the real model. On a laptop it reads the eval key from `OPENROUTER_API_KEY`. In a Claude cloud session the key is a network secret on the environment, and the command sends none of its own.

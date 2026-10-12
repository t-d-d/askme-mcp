// A stand-in for the eval set, for evals/config.static.ts. Like the eval,
// it prints from a passing test. It sits outside evals/, so `npm run eval`
// does not run it.
import { it } from "vitest";

it("prints a line and passes", () => {
  console.log("A passing test printed this line.");
});

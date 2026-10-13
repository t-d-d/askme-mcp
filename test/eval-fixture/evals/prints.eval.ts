// A stand-in eval for evals/config.static.ts. It sits outside evals/, so
// `npm run eval` does not run it.
import { it } from "vitest";

it("prints a line and passes", () => {
  console.log("A passing test printed this line.");
});

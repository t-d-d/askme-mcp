// How often the page asks for changes while it is visible (ADR 1). It can be
// tuned without a new decision.
export const pollMs = 5000;

// How soon the page tries again after any other load fails.
export const retryMs = 5000;

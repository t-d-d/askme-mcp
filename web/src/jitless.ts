// zod tries Function to see whether it may compile its parsers, and the
// page's CSP refuses that, with a violation each time (ADR 28). jitless skips
// the try. It must run before any schema is made, so main.tsx imports it
// first.
import { z } from "zod";

z.config({ jitless: true });

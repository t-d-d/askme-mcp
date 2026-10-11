import "@fontsource-variable/bricolage-grotesque/opsz.css";
import "./tokens.css";
import "./base.css";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { ClerkAuth } from "./clerk";

// A failed load shows at once, and the page's own timers try again, so
// nothing is retried behind its back.
const queries = new QueryClient({
  defaultOptions: { queries: { retry: false } },
});

const root = document.getElementById("root");
if (root === null) throw new Error("The page has no root element.");

createRoot(root).render(
  <StrictMode>
    <QueryClientProvider client={queries}>
      <ClerkAuth>
        <App />
      </ClerkAuth>
    </QueryClientProvider>
  </StrictMode>,
);

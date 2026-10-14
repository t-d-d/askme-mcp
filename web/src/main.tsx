import "./jitless";
import "@fontsource-variable/bricolage-grotesque/opsz.css";
import "./tokens.css";
import "./base.css";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { ClerkAuth } from "./clerk";
import { Fallback } from "./Fallback";

const root = document.getElementById("root");
if (root === null) throw new Error("The page has no root element.");

createRoot(root).render(
  <StrictMode>
    <Fallback>
      <ClerkAuth>
        <App />
      </ClerkAuth>
    </Fallback>
  </StrictMode>,
);

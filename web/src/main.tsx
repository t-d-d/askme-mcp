import "@fontsource-variable/bricolage-grotesque/opsz.css";
import "./tokens.css";
import "./base.css";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { SignedOut } from "./SignedOut";

const root = document.getElementById("root");
if (root === null) throw new Error("The page has no root element.");

createRoot(root).render(
  <StrictMode>
    <SignedOut />
  </StrictMode>,
);

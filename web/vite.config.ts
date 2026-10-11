import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// Builds the page into static files in web/dist (ADR 5).
export default defineConfig({
  plugins: [react()],
});

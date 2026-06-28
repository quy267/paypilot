// Named import (not `import path from "node:path"`): the agents/tsconfig base
// turns on verbatimModuleSyntax, which rejects default-importing a CJS builtin.
import { resolve } from "node:path";
import { cloudflare } from "@cloudflare/vite-plugin";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";
import agents from "agents/vite";

export default defineConfig({
  // Keep all four plugins — dropping agents()/cloudflare() breaks Workers/Agents routing.
  plugins: [agents(), react(), cloudflare(), tailwindcss()],
  // Mirror the tsconfig "@/*" path for the bundler. import.meta.dirname (Node 22)
  // replaces __dirname, which does not exist in an ESM ("type":"module") config.
  resolve: {
    alias: {
      "@": resolve(import.meta.dirname, "./src")
    }
  }
});

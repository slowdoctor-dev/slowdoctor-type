import { defineConfig } from "vite";

export default defineConfig({
  build: { outDir: "dist", emptyOutDir: true },
  // `npx wrangler dev` serves the API on 8787; `npm run dev` proxies to it
  server: { proxy: { "/api": "http://127.0.0.1:8787" } },
});

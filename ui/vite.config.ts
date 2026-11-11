import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import pkg from "./package.json" with { type: "json" };

const src = (p: string) => fileURLToPath(new URL(`./src/${p}`, import.meta.url));

// Tauri loads the dev server from a fixed URL (src-tauri/tauri.conf.json →
// build.devUrl), so the port must not drift.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  clearScreen: false,
  resolve: {
    alias: [
      // The components were ported from the Next.js app unchanged. These shims
      // give them the few Next APIs they use, on top of react-router.
      { find: "next/link", replacement: src("next/link.tsx") },
      { find: "next/navigation", replacement: src("next/navigation.ts") },
      { find: /^@\//, replacement: src("") },
    ],
  },
  define: {
    "process.env.NEXT_PUBLIC_APP_VERSION": JSON.stringify(pkg.version),
  },
  server: {
    port: 1420,
    strictPort: true,
    watch: { ignored: ["**/src-tauri/**"] },
    // "Was ist neu" imports the repo's CHANGELOG.md, which lies outside ui/.
    fs: {
      allow: [
        fileURLToPath(new URL(".", import.meta.url)),
        fileURLToPath(new URL("../CHANGELOG.md", import.meta.url)),
      ],
    },
  },
  build: {
    target: "es2022",
  },
});

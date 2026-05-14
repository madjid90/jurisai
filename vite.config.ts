// @lovable.dev/vite-tanstack-config already includes the following — do NOT add them manually
// or the app will break with duplicate plugins:
//   - tanstackStart, viteReact, tailwindcss, tsConfigPaths, cloudflare (build-only),
//     componentTagger (dev-only), VITE_* env injection, @ path alias, React/TanStack dedupe,
//     error logger plugins, and sandbox detection (port/host/strictPort).
// You can pass additional config via defineConfig({ vite: { ... } }) if needed.
import { defineConfig } from "@lovable.dev/vite-tanstack-config";

export default defineConfig({
  tanstackStart: {
    importProtection: {
      behavior: "error",
      client: {
        // Default was ["**/server/**"] which blocks createServerFn files
        // (*.functions.ts) that are designed to be imported from client code.
        // We restrict the pattern to only block actual server-only modules
        // (*.server.ts) while allowing server function RPC bridges.
        files: ["**/*.server.ts", "**/*.server.tsx"],
        specifiers: ["server-only"],
      },
    },
  },
});

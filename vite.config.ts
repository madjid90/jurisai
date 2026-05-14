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
      // Disable the default "**/server/**" file pattern that blocks ALL imports
      // from src/server/ in client code. Our *.functions.ts files use createServerFn
      // which is designed to be imported from client components — the bundler
      // automatically replaces the server implementation with an RPC stub.
      // Vite's mergeConfig concatenates arrays, so we cannot override the files
      // pattern. Setting enabled:false is the only reliable way to disable it.
      enabled: false,
    },
  },
});

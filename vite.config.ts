// Configuration Vite — cible Vercel via Nitro preset (migration depuis Lovable Cloud).
//
// Stack :
//   - TanStack Start (server functions + router fichier-based)
//   - Nitro (runtime serveur, preset 'vercel' auto-détecté en build)
//   - React 19 + Tailwind 4
//
// Avant : @lovable.dev/vite-tanstack-config + @cloudflare/vite-plugin
// Après : plugins vanilla TanStack/Nitro/React/Tailwind/tsConfigPaths

import { defineConfig } from "vite";
import viteReact from "@vitejs/plugin-react";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import { nitro } from "nitro/vite";
import tsConfigPaths from "vite-tsconfig-paths";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [
    tsConfigPaths(),
    tailwindcss(),
    tanstackStart({
      // src/server/*.functions.ts sont importés depuis le client (createServerFn
      // est remplacé automatiquement par un stub RPC côté bundle). On désactive
      // la protection par défaut qui bloque "**/server/**".
      importProtection: { enabled: false },
    }),
    nitro({
      // Preset 'vercel' lit automatiquement vercel.json et émet les Functions
      // (serverless Node par défaut) + crons. Pas besoin d'adapter manuel.
      preset: "vercel",
    }),
    viteReact(),
  ],
  // Alias @/ déjà géré par tsConfigPaths qui lit tsconfig.json
});

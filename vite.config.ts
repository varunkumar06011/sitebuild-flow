import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import tsConfigPaths from "vite-tsconfig-paths";
import { TanStackRouterVite } from "@tanstack/router-plugin/vite";

// Plain Vite SPA config — no TanStack Start, no Nitro, no SSR.
// The TanStack Router plugin is kept for file-based route generation (routeTree.gen.ts).
export default defineConfig(({ mode }) => {
  // Load .env into process.env so any shared env vars are available.
  // Note: server-side env vars (SUPABASE_SERVICE_ROLE_KEY, APP_JWT_SECRET) are
  // NOT used by the frontend — they live only in the Express server's env.
  const env = loadEnv(mode, process.cwd(), "");
  for (const [key, value] of Object.entries(env)) {
    if (process.env[key] === undefined) {
      process.env[key] = value;
    }
  }

  return {
    plugins: [
      TanStackRouterVite({ target: "react", autoCodeSplitting: true }),
      react(),
      tailwindcss(),
      tsConfigPaths(),
    ],
    server: {
      port: 5173,
    },
    build: {
      outDir: "dist",
      rolldownOptions: {
        external: ["@aws-sdk/client-ses"],
      },
    },
  };
});

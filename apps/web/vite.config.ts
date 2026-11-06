import { join } from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig, loadEnv } from "vite";
import { VitePWA } from "vite-plugin-pwa";
import { apiMiddleware, enableFakeProviders } from "./api/_lib/dev-api.js";

export default defineConfig({
  plugins: [
    react(),
    {
      // `npm run dev` serves /api like Vercel does; never part of a build.
      name: "critical-dev-api",
      apply: "serve",
      configureServer(server) {
        const { mode, envDir, root } = server.config;
        for (const [k, v] of Object.entries(loadEnv(mode, envDir || root, ""))) {
          process.env[k] ??= v;
        }
        if (enableFakeProviders(process.env)) {
          server.config.logger.info("critiCal: Google, iCloud, mapas y Gemini simulados");
        }
        server.middlewares.use(
          "/api",
          apiMiddleware(join(root, "api"), (file) => server.ssrLoadModule(file)),
        );
      },
    },
    VitePWA({
      // Our own worker (sw/sw.ts): precache plus Web Push.
      strategies: "injectManifest",
      srcDir: "sw",
      filename: "sw.ts",
      injectManifest: { globPatterns: ["**/*.{js,css,html,png,svg,webmanifest}"] },
      includeAssets: ["favicon.png", "apple-touch-icon.png", "privacy.html"],
      registerType: "autoUpdate",
      manifest: {
        name: "critiCal",
        short_name: "critiCal",
        lang: "es-UY",
        display: "standalone",
        start_url: "/",
        background_color: "#f2f2f2",
        theme_color: "#f2f2f2",
        icons: [
          { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
          { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
        ],
      },
    }),
  ],
  test: {
    name: "web",
    environment: "jsdom",
    include: ["src/**/*.test.{ts,tsx}"],
    setupFiles: ["src/test-setup.ts"],
    // A developer's .env.local (local Supabase, invented providers) must not change tests.
    env: { VITE_SUPABASE_URL: "", VITE_SUPABASE_PUBLISHABLE_KEY: "", VITE_FAKE_PROVIDERS: "" },
  },
});

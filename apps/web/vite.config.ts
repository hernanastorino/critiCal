import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  plugins: [
    react(),
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
  },
});

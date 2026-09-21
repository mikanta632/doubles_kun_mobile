import { defineConfig } from "vite";
import preact from "@preact/preset-vite";
import { VitePWA } from "vite-plugin-pwa";

// GitHub Pages のプロジェクトサイト（https://<user>.github.io/doubles_kun_mobile/）
export default defineConfig({
  base: "/doubles_kun_mobile/",
  plugins: [
    preact(),
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["icon.svg"],
      manifest: {
        name: "ダブルスくんモバイル",
        short_name: "ダブルスくん",
        description: "ダブルスの組み合わせをその場で作る",
        lang: "ja",
        start_url: "/doubles_kun_mobile/",
        scope: "/doubles_kun_mobile/",
        display: "standalone",
        background_color: "#f3f4f6",
        theme_color: "#2563eb",
        icons: [
          { src: "icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" },
          { src: "icon-192.png", sizes: "192x192", type: "image/png" },
          { src: "icon-512.png", sizes: "512x512", type: "image/png", purpose: "any maskable" },
        ],
      },
      workbox: {
        globPatterns: ["**/*.{js,css,html,svg,png,woff2}"],
      },
    }),
  ],
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
  },
});

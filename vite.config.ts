import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { defineConfig, type Plugin } from "vite";
import preact from "@preact/preset-vite";
import { VitePWA } from "vite-plugin-pwa";

// ビルドに埋め込む版の情報。公開先の version.json と比べて更新を検出する
const pkg = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf-8")) as { version: string };
const commit = (() => {
  try {
    return execSync("git rev-parse --short HEAD", { stdio: ["ignore", "pipe", "ignore"] }).toString().trim();
  } catch {
    return "dev";
  }
})();
const buildInfo = { version: pkg.version, commit, builtAt: new Date().toISOString() };

/** dist/version.json を書き出す。Service Worker のキャッシュには入れない（常に最新を取りに行く）。 */
function versionJson(): Plugin {
  return {
    name: "version-json",
    generateBundle() {
      this.emitFile({ type: "asset", fileName: "version.json", source: JSON.stringify(buildInfo) });
    },
  };
}

// GitHub Pages のプロジェクトサイト（https://<user>.github.io/doubles_kun_mobile/）
export default defineConfig({
  base: "/doubles_kun_mobile/",
  define: {
    __BUILD_INFO__: JSON.stringify(buildInfo),
  },
  plugins: [
    preact(),
    versionJson(),
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["favicon.png", "apple-touch-icon.png"],
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
        // デスクトップ版の icon.ico から作った（tools/ ではなく手元の Pillow で生成）
        icons: [
          { src: "icon-192.png", sizes: "192x192", type: "image/png" },
          { src: "icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
          { src: "icon-512-maskable.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
        ],
      },
      workbox: {
        // version.json は含めない（json を除外）。更新確認は必ずネットワークから読む
        globPatterns: ["**/*.{js,css,html,svg,png,woff2}"],
      },
    }),
  ],
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
  },
});

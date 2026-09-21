/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/client" />

/** vite.config.ts の define で埋め込むビルド情報 */
declare const __BUILD_INFO__: { version: string; commit: string; builtAt: string };

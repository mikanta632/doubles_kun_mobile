import { render } from "preact";
import { registerSW } from "virtual:pwa-register";
import { App } from "./app";
import "./styles.css";

// 新しい版が見つかったら自動で入れ替える（registerType: autoUpdate）。
// 明示的な確認と更新は設定タブの「更新を確認」から（src/version.ts）。
registerSW({ immediate: true });

render(<App />, document.getElementById("app")!);

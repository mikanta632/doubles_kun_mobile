/**
 * 版の確認と更新。
 *
 * ビルド時に埋め込んだ版（__BUILD_INFO__）と、公開先に置かれた version.json を比べる。
 * version.json は Service Worker のキャッシュに入れていないので、必ずネットワークから読む。
 * 違っていれば Service Worker に更新を頼み、新しい版が入ったらページを読み直す。
 */

export interface BuildInfo {
  version: string;
  commit: string;
  builtAt: string;
}

export const BUILD: BuildInfo = typeof __BUILD_INFO__ === "undefined" ? { version: "dev", commit: "dev", builtAt: "" } : __BUILD_INFO__;

export type UpdateCheck =
  | { status: "latest"; latest: BuildInfo }
  | { status: "newer"; latest: BuildInfo }
  | { status: "offline" }
  | { status: "unknown"; reason: string };

export function describe(b: BuildInfo): string {
  const when = b.builtAt ? new Date(b.builtAt).toLocaleString("ja-JP", { dateStyle: "short", timeStyle: "short" }) : "";
  return `v${b.version} (${b.commit})${when ? ` ${when}` : ""}`;
}

/** 公開先の最新版を取りに行って、いまの版と比べる。 */
export async function checkForUpdate(): Promise<UpdateCheck> {
  if (typeof navigator !== "undefined" && navigator.onLine === false) return { status: "offline" };
  try {
    const url = new URL("version.json", import.meta.env.BASE_URL.startsWith("http") ? import.meta.env.BASE_URL : location.origin + import.meta.env.BASE_URL);
    url.searchParams.set("t", String(Date.now()));
    const res = await fetch(url.toString(), { cache: "no-store" });
    if (!res.ok) return { status: "unknown", reason: `HTTP ${res.status}` };
    const latest = (await res.json()) as BuildInfo;
    if (!latest || typeof latest.commit !== "string") return { status: "unknown", reason: "形式が違います" };
    const same = latest.commit === BUILD.commit && latest.version === BUILD.version;
    return same ? { status: "latest", latest } : { status: "newer", latest };
  } catch (e) {
    return { status: "unknown", reason: (e as Error).message };
  }
}

/**
 * 新しい版を取り込んで読み直す。
 * Service Worker に更新を頼み、新しいものが入れ替わったら（controllerchange）読み直す。
 * 一定時間たっても入れ替わらなければ、そのまま読み直す。
 */
export async function applyUpdate(): Promise<void> {
  if (!("serviceWorker" in navigator)) {
    location.reload();
    return;
  }
  const reg = await navigator.serviceWorker.getRegistration();
  if (!reg) {
    location.reload();
    return;
  }
  let reloaded = false;
  const reload = () => {
    if (reloaded) return;
    reloaded = true;
    location.reload();
  };
  navigator.serviceWorker.addEventListener("controllerchange", reload, { once: true });
  try {
    await reg.update();
  } catch {
    // ネットワーク断など。下のタイムアウトで読み直す
  }
  const waiting = reg.waiting;
  if (waiting) waiting.postMessage({ type: "SKIP_WAITING" });
  setTimeout(reload, 8000);
}

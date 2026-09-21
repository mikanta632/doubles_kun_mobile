/** 書き出し・読み込み。デスクトップ版のファイル形式と互換。 */

import { matchFromJson, playerFromJson, type Match, type Player } from "./core/models";
import { stateFromJson, type AppState } from "./store";

/** デスクトップ版の project.json + players.json + matches.json を 1 つにまとめた形 */
export function bundleJson(s: AppState): string {
  return JSON.stringify(
    {
      schema_version: 1,
      app: "doubles_kun_mobile",
      name: s.name,
      exported_at: new Date().toISOString(),
      engine_config: s.config,
      match_settings: s.settings,
      selected_players: s.selected,
      players: s.players,
      matches: s.matches,
    },
    null,
    2,
  );
}

export function playersJson(s: AppState): string {
  return JSON.stringify(s.players, null, 2);
}

export function matchesJson(s: AppState): string {
  return JSON.stringify(s.matches, null, 2);
}

export type Imported =
  | { kind: "bundle"; state: AppState }
  | { kind: "players"; players: Player[] }
  | { kind: "matches"; matches: Match[] };

/** 中身を見て、まとめファイル・players.json・matches.json のどれかを判定する。 */
export function parseImport(text: string): Imported {
  const data = JSON.parse(text) as unknown;
  if (Array.isArray(data)) {
    if (data.length === 0) throw new Error("空の配列です。");
    const first = data[0] as Record<string, unknown>;
    if ("team_a" in first && "team_b" in first) {
      const matches = data.map((d) => matchFromJson(d as Record<string, unknown>)).filter((m): m is Match => m !== null);
      return { kind: "matches", matches };
    }
    if ("name" in first) {
      const players = data.map((d) => playerFromJson(d as Record<string, unknown>)).filter((p): p is Player => p !== null);
      return { kind: "players", players };
    }
    throw new Error("players.json でも matches.json でもないようです。");
  }
  if (data && typeof data === "object") {
    const d = data as Record<string, unknown>;
    if (Array.isArray(d.players) || Array.isArray(d.matches)) return { kind: "bundle", state: stateFromJson(d) };
    if (d.engine_config || d.match_settings) {
      // project.json 単体: 設定だけ読む
      return { kind: "bundle", state: stateFromJson({ ...d, players: [], matches: [] }) };
    }
  }
  throw new Error("読める形式ではありません。");
}

export function downloadText(filename: string, text: string): void {
  const blob = new Blob([text], { type: "application/json;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export async function shareText(filename: string, text: string): Promise<boolean> {
  if (typeof navigator === "undefined" || !("share" in navigator)) return false;
  try {
    const file = new File([text], filename, { type: "application/json" });
    const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean };
    if (nav.canShare && !nav.canShare({ files: [file] })) return false;
    await navigator.share({ files: [file], title: filename });
    return true;
  } catch {
    return false;
  }
}

export function todayStamp(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}`;
}

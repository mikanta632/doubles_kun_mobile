/** 書き出し・読み込み。デスクトップ版のファイル形式と互換。 */

import { matchFromJson, playerFromJson, type Match, type Player } from "./core/models";
import { memberPlayers, projectFromJson, type AppState, type Project } from "./store";

/**
 * デスクトップ版の project.json + players.json + matches.json を 1 つにまとめた形。
 * players はプロジェクトの名簿。database にはデータベース全体も入れておく（読み込むと足される）。
 */
export function bundleJson(s: AppState, p: Project): string {
  return JSON.stringify(
    {
      schema_version: 2,
      app: "doubles_kun_mobile",
      name: p.name,
      date: p.date,
      place: p.place,
      created_at: p.created_at,
      updated_at: p.updated_at,
      exported_at: new Date().toISOString(),
      engine_config: p.config,
      match_settings: p.settings,
      selected_players: p.selected,
      players: memberPlayers(s, p),
      matches: p.matches,
      database: s.db,
    },
    null,
    2,
  );
}

/** プロジェクトの参加者だけ。デスクトップ版のプロジェクトフォルダにそのまま置ける。 */
export function playersJson(s: AppState, p: Project): string {
  return JSON.stringify(memberPlayers(s, p), null, 2);
}

export function matchesJson(p: Project): string {
  return JSON.stringify(p.matches, null, 2);
}

export type Imported =
  | { kind: "bundle"; project: Project; players: Player[] }
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
    if (Array.isArray(d.players) || Array.isArray(d.matches) || d.engine_config || d.match_settings) {
      // project.json 単体なら設定だけ読める。id は付け直す（同じプロジェクトを二重に開かないため）
      const { project, players } = projectFromJson({ ...d, id: undefined });
      const database = Array.isArray(d.database)
        ? (d.database as Record<string, unknown>[]).map(playerFromJson).filter((p): p is Player => p !== null)
        : [];
      // データベース → 名簿の順で足す（名簿の方が新しい情報）
      return { kind: "bundle", project, players: [...database, ...players] };
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

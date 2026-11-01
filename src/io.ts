/** 書き出し・読み込み。デスクトップ版のファイル形式と互換。 */

import { matchFromJson, playerFromJson, type Match, type Player } from "./core/models";
import { memberPlayers, projectFromJson, type AppState, type PlayerPatch, type Project } from "./store";

/**
 * デスクトップ版の project.json + players.json + matches.json を 1 つにまとめた形。
 * players はプロジェクトの名簿。database にはデータベース全体も入れておく（読み込むと足される）。
 * members は名簿の名前（順も含む）。これがないと読み込み側は players の active な人だけを名簿にするので、
 * 試合に出たあと休会にした人が名簿から落ちる
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
      members: p.members,
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

// ---- データベース（全プロジェクト共通のメンバー） ----

/** データベース全体。players.json と同じ形なので、デスクトップ版のプロジェクトにも置ける。 */
export function databaseJson(s: AppState): string {
  return JSON.stringify(s.db, null, 2);
}

/** CSV の見出し。書き出しは日本語、読み込みは英語の名前（players.json のキー）も受け付ける */
const CSV_COLUMNS: Record<string, keyof PlayerPatch | "inactive"> = {
  名前: "name",
  氏名: "name",
  name: "name",
  所属: "team",
  team: "team",
  レート: "rating",
  rating: "rating",
  初期レート: "initial_rating",
  initial_rating: "initial_rating",
  休会: "inactive",
  休会中: "inactive",
  active: "active",
};

/** Excel で開けるように BOM と CRLF を付ける。休会中の人は「休会」の列に 1。 */
export function databaseCsv(s: AppState): string {
  const rows = [["名前", "所属", "レート", "初期レート", "休会"]];
  for (const p of s.db) rows.push([p.name, p.team ?? "", String(round2(p.rating)), String(round2(p.initial_rating)), p.active ? "" : "1"]);
  return "\ufeff" + rows.map((r) => r.map(csvCell).join(",")).join("\r\n") + "\r\n";
}

function round2(x: number): number {
  return Math.round(x * 100) / 100;
}

function csvCell(v: string): string {
  return /[",\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

/**
 * データベースに足すファイルを読む。JSON（players.json・このアプリのまとめファイル）と CSV に対応。
 * 文字コードは UTF-8 を試し、読めなければ Shift_JIS（Excel で保存した CSV）とみなす。
 * ファイルに無い項目は undefined のまま返す（登録済みの人の値を消さないため）。同じ名前は後の行を使う。
 */
export function parseDatabaseFile(bytes: ArrayBuffer): PlayerPatch[] {
  const text = decodeText(bytes).trim();
  if (!text) throw new Error("空のファイルです。");
  const rows = text.startsWith("[") || text.startsWith("{") ? jsonPatches(JSON.parse(text)) : csvPatches(text);
  const byName = new Map<string, PlayerPatch>();
  for (const r of rows) byName.set(r.name, { ...byName.get(r.name), ...r });
  if (byName.size === 0) throw new Error("名前の入った行がありません。");
  return [...byName.values()];
}

function decodeText(bytes: ArrayBuffer): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return new TextDecoder("shift_jis").decode(bytes);
  }
}

function jsonPatches(data: unknown): PlayerPatch[] {
  let rows: unknown[];
  if (Array.isArray(data)) rows = data;
  else if (data && typeof data === "object") {
    // まとめファイルなら、データベース → 名簿の順（名簿の方が新しい情報）
    const d = data as Record<string, unknown>;
    rows = [...(Array.isArray(d.database) ? d.database : []), ...(Array.isArray(d.players) ? d.players : [])];
  } else rows = [];
  if (rows.length > 0 && rows.every((r) => r && typeof r === "object" && "team_a" in r)) throw new Error("matches.json は試合のファイルです。設定タブの「読み込む」を使ってください。");
  const out: PlayerPatch[] = [];
  for (const r of rows) {
    if (!r || typeof r !== "object") continue;
    const d = r as Record<string, unknown>;
    const name = typeof d.name === "string" ? d.name.trim() : "";
    if (!name) continue;
    out.push({
      name,
      rating: optNum(d.rating),
      initial_rating: optNum(d.initial_rating),
      team: "team" in d ? (typeof d.team === "string" && d.team.trim() ? d.team.trim() : null) : undefined,
      active: "active" in d ? Boolean(d.active) : undefined,
    });
  }
  return out;
}

function csvPatches(text: string): PlayerPatch[] {
  const [header, ...rows] = parseCsv(text);
  const cols = header.map((h) => CSV_COLUMNS[h.trim()] ?? CSV_COLUMNS[h.trim().toLowerCase()]);
  if (!cols.includes("name")) throw new Error("「名前」の列がありません（1 行目に見出しが必要です）。");
  const out: PlayerPatch[] = [];
  for (const row of rows) {
    const x: PlayerPatch = { name: "" };
    cols.forEach((c, i) => {
      const v = (row[i] ?? "").trim();
      if (c === "name") x.name = v;
      else if (c === "team") x.team = v || null;
      else if (c === "rating" || c === "initial_rating") x[c] = optNum(v);
      else if (c === "inactive" && v) x.active = !truthy(v);
      else if (c === "inactive") x.active = true;
      else if (c === "active" && v) x.active = truthy(v);
    });
    if (x.name) out.push(x);
  }
  return out;
}

function truthy(v: string): boolean {
  return !/^(0|false|no|いいえ|×|x|-)$/i.test(v);
}

function optNum(v: unknown): number | undefined {
  if (v === null || v === undefined || v === "") return undefined;
  const x = typeof v === "number" ? v : Number(v);
  return Number.isFinite(x) ? x : undefined;
}

/** RFC 4180 の CSV（引用符の中の , と改行に対応）。空行は捨てる。 */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") {
      row.push(cell);
      cell = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(cell);
      if (row.some((v) => v !== "")) rows.push(row);
      row = [];
      cell = "";
    } else cell += c;
  }
  row.push(cell);
  if (row.some((v) => v !== "")) rows.push(row);
  return rows;
}

export function downloadText(filename: string, text: string, type = "application/json"): void {
  const blob = new Blob([text], { type: `${type};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export async function shareText(filename: string, text: string, type = "application/json"): Promise<boolean> {
  if (typeof navigator === "undefined" || !("share" in navigator)) return false;
  try {
    const file = new File([text], filename, { type });
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

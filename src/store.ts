/**
 * アプリの状態と保存。
 *
 * サーバーはないので端末の localStorage に保存する。
 *
 * メンバーは 3 層に分ける:
 *   1. データベース（db）      … この端末に登録した全プレイヤー。会をまたいで共有する
 *   2. 会の参加者（members）   … データベースから選んだ、この会に来ている人
 *   3. 試合に入れる人（selected） … 参加者のうち、次の試合の候補にする人
 * 集計は参加者だけを対象にする。
 *
 * 会（プロジェクト）は複数持てる。試合・設定・参加者は会ごと、データベースは共通。
 * デスクトップ版と同じ players.json / matches.json の形で書き出し・読み込みができる（io.ts）。
 */

import { DEFAULT_CONFIG, DEFAULT_MATCH_SETTINGS, configFromJson, type EngineConfig, type MatchSettings } from "./core/config";
import { recalculateAll } from "./core/elo";
import { matchFromJson, playerFromJson, type Match, type Player } from "./core/models";

export interface Project {
  id: string;
  name: string;
  created_at: string;
  updated_at: string;
  matches: Match[];
  config: EngineConfig;
  settings: MatchSettings;
  /** 会の参加者（データベース上の名前） */
  members: string[];
  /** 試合に入れる人（参加者のうち） */
  selected: string[];
}

export interface AppState {
  /** プレイヤーデータベース */
  db: Player[];
  projects: Project[];
  /** いま開いている会の id */
  current: string;
}

const KEY = "doubles_kun_mobile.v2";
const KEY_V1 = "doubles_kun_mobile.v1";

export function newProject(name: string, base?: Partial<Project>): Project {
  const now = new Date().toISOString();
  const p: Project = {
    id: uuid(),
    name: name || "ダブルスくん",
    created_at: now,
    updated_at: now,
    matches: [],
    config: { ...DEFAULT_CONFIG },
    settings: { ...DEFAULT_MATCH_SETTINGS },
    members: [],
    selected: [],
  };
  // undefined の項目は既定値のまま（`id: d.id` のように渡せるように）
  for (const [k, v] of Object.entries(base ?? {})) if (v !== undefined) (p as unknown as Record<string, unknown>)[k] = v;
  return p;
}

export function emptyState(): AppState {
  const p = newProject("ダブルスくん");
  return { db: [], projects: [p], current: p.id };
}

export function loadState(): AppState {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return stateFromJson(JSON.parse(raw));
    // 旧版（会が 1 つだけ）からの移行。旧データは念のため残す
    const old = localStorage.getItem(KEY_V1);
    if (old) {
      const s = migrateV1(JSON.parse(old));
      saveState(s);
      return s;
    }
  } catch {
    // 壊れていたら初期状態から
  }
  return emptyState();
}

export function saveState(s: AppState): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    // 容量超過やプライベートモード。画面上の状態はそのまま使える
  }
}

/** 旧版の状態（players / matches / selected が 1 組）を、データベース + 会 1 つに直す。 */
export function migrateV1(d: Record<string, unknown>): AppState {
  const { players, project } = projectFromJson(d);
  return { db: players, projects: [project], current: project.id };
}

export function stateFromJson(d: Record<string, unknown>): AppState {
  const db = dedupe(playersFromJson(d.db));
  const names = new Set(db.map((p) => p.name));
  const projects = Array.isArray(d.projects)
    ? (d.projects as Record<string, unknown>[]).map((p) => projectFromJson(p, names).project)
    : [];
  if (projects.length === 0) projects.push(newProject("ダブルスくん"));
  const current = typeof d.current === "string" && projects.some((p) => p.id === d.current) ? d.current : projects[0].id;
  return { db, projects, current };
}

/**
 * 会 1 つ分を JSON から読む。デスクトップ版の project.json + players.json + matches.json を
 * まとめた形（io.ts の bundle）と、この保存形式の両方を受け付ける。
 * 返す players は、その JSON に入っていたプレイヤー（データベースに足す分）。
 * known を渡すと、members / selected はその名前に限る。
 */
export function projectFromJson(d: Record<string, unknown>, known?: Set<string>): { project: Project; players: Player[] } {
  const players = dedupe(playersFromJson(d.players));
  const matches = Array.isArray(d.matches)
    ? (d.matches as Record<string, unknown>[]).map(matchFromJson).filter((m): m is Match => m !== null)
    : [];
  const valid = known ?? new Set(players.map((p) => p.name));
  const membersRaw = Array.isArray(d.members) ? (d.members as unknown[]).map(String) : players.filter((p) => p.active).map((p) => p.name);
  const members = [...new Set(membersRaw.filter((n) => valid.has(n)))];
  const memberSet = new Set(members);
  const selectedRaw = Array.isArray(d.selected) ? d.selected : Array.isArray(d.selected_players) ? d.selected_players : null;
  const selected = selectedRaw ? [...new Set((selectedRaw as unknown[]).map(String).filter((n) => memberSet.has(n)))] : [...members];
  const settingsRaw = (d.settings ?? d.match_settings) as Record<string, unknown> | undefined;
  const project = newProject(typeof d.name === "string" && d.name.trim() ? d.name.trim() : "ダブルスくん", {
    id: typeof d.id === "string" && d.id ? d.id : undefined,
    created_at: typeof d.created_at === "string" ? d.created_at : undefined,
    updated_at: typeof d.updated_at === "string" ? d.updated_at : undefined,
    matches,
    config: configFromJson((d.config ?? d.engine_config) as Record<string, unknown> | undefined),
    settings: {
      rating_match: settingsRaw?.rating_match === undefined ? true : Boolean(settingsRaw.rating_match),
      avoid_same_team: Boolean(settingsRaw?.avoid_same_team),
    },
    members,
    selected,
  });
  return { project, players };
}

function playersFromJson(v: unknown): Player[] {
  return Array.isArray(v) ? (v as Record<string, unknown>[]).map(playerFromJson).filter((p): p is Player => p !== null) : [];
}

export function dedupe(players: Player[]): Player[] {
  const seen = new Set<string>();
  return players.filter((p) => (seen.has(p.name) ? false : (seen.add(p.name), true)));
}

function uuid(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
  });
}

// ---- 会の出し入れ ----

export function currentProject(s: AppState): Project {
  return s.projects.find((p) => p.id === s.current) ?? s.projects[0];
}

/** いま開いている会だけを書き換える。updated_at も進める。 */
export function updateCurrent(s: AppState, fn: (p: Project, s: AppState) => Project): AppState {
  const cur = currentProject(s);
  const next = { ...fn(cur, s), updated_at: new Date().toISOString() };
  return { ...s, projects: s.projects.map((p) => (p.id === cur.id ? next : p)) };
}

export function addProject(s: AppState, project: Project, open = true): AppState {
  return { ...s, projects: [...s.projects, project], current: open ? project.id : s.current };
}

export function removeProject(s: AppState, id: string): AppState {
  const projects = s.projects.filter((p) => p.id !== id);
  if (projects.length === 0) return { ...emptyState(), db: s.db };
  return { ...s, projects, current: s.current === id ? projects[0].id : s.current };
}

// ---- メンバーの 3 層 ----

/** 会の参加者（データベース上の Player）。members の順。 */
export function memberPlayers(s: AppState, p: Project = currentProject(s)): Player[] {
  const byName = new Map(s.db.map((x) => [x.name, x]));
  return p.members.map((n) => byName.get(n)).filter((x): x is Player => x !== undefined);
}

/** 出場候補（参加者で、試合に入れるチェックが付いていて、いま試合中でない人）。 */
export function availablePlayers(s: AppState, p: Project = currentProject(s)): Player[] {
  const inPlay = new Set<string>();
  for (const m of p.matches) if (m.in_play) for (const n of [...m.team_a, ...m.team_b]) inPlay.add(n);
  const sel = new Set(p.selected);
  return memberPlayers(s, p).filter((x) => x.active && sel.has(x.name) && !inPlay.has(x.name));
}

export function playedIn(p: Project, name: string): boolean {
  return p.matches.some((m) => m.team_a.includes(name) || m.team_b.includes(name));
}

/** その名前がどれかの会の試合に出ているか。 */
export function playedAnywhere(s: AppState, name: string): boolean {
  return s.projects.some((p) => playedIn(p, name));
}

/** データベースの名前を変える。すべての会の試合・参加者にも反映する。 */
export function renamePlayer(s: AppState, from: string, to: string): AppState {
  if (from === to) return s;
  const r = (n: string) => (n === from ? to : n);
  return {
    ...s,
    db: s.db.map((p) => (p.name === from ? { ...p, name: to } : p)),
    projects: s.projects.map((p) => ({
      ...p,
      members: p.members.map(r),
      selected: p.selected.map(r),
      matches: p.matches.map((m) => ({ ...m, team_a: m.team_a.map(r), team_b: m.team_b.map(r) })),
    })),
  };
}

/** データベースから消す。参加者からも外す（試合には出ていない前提）。 */
export function deletePlayer(s: AppState, name: string): AppState {
  return {
    ...s,
    db: s.db.filter((p) => p.name !== name),
    projects: s.projects.map((p) => ({ ...p, members: p.members.filter((n) => n !== name), selected: p.selected.filter((n) => n !== name) })),
  };
}

/** データベースに players を足す（同じ名前は上書き）。 */
export function mergePlayers(s: AppState, players: readonly Player[]): AppState {
  const byName = new Map(s.db.map((p) => [p.name, p]));
  for (const p of players) byName.set(p.name, { ...(byName.get(p.name) ?? p), ...p });
  return { ...s, db: [...byName.values()] };
}

/** いま開いている会の試合から、データベースのレートを計算し直す。 */
export function recalcRatings(s: AppState, force = false): AppState {
  const p = currentProject(s);
  if (!force && !p.config.elo_auto_update) return s;
  const db = s.db.map((x) => ({ ...x }));
  recalculateAll(db, p.matches, { kFactor: p.config.elo_k_factor, weakWeight: p.config.pair_weak_weight, gameScale: p.config.game_scale });
  return { ...s, db };
}

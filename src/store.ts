/**
 * アプリの状態と保存。
 *
 * サーバーはないので端末の localStorage に保存する。
 *
 * メンバーは 3 層に分ける:
 *   1. データベース（db）      … この端末に登録した全プレイヤー。プロジェクトをまたいで共有する
 *   2. 名簿（members）        … データベースから選んだ、このプロジェクトに来ている人
 *   3. 試合に入れる人（selected） … 名簿のうち、次の試合の候補にする人
 * 集計は名簿の人だけを対象にする。
 *
 * プロジェクトは複数持てる。試合・設定・名簿はプロジェクトごと、データベースは共通。
 * デスクトップ版と同じ players.json / matches.json の形で書き出し・読み込みができる（io.ts）。
 */

import { DEFAULT_CONFIG, DEFAULT_MATCH_SETTINGS, configFromJson, type EngineConfig, type MatchSettings } from "./core/config";
import { applyMatches } from "./core/elo";
import { matchFromJson, newPlayer, playerFromJson, type Match, type Player } from "./core/models";

export interface Project {
  id: string;
  name: string;
  /** 開催日（YYYY-MM-DD。未定なら空） */
  date: string;
  /** 場所（空でもよい） */
  place: string;
  created_at: string;
  updated_at: string;
  matches: Match[];
  config: EngineConfig;
  settings: MatchSettings;
  /** 名簿（データベース上の名前） */
  members: string[];
  /** 試合に入れる人（名簿のうち） */
  selected: string[];
  /** 遅れて来た人（名前 → 仮の試合数と来た時点）。組むときの出場回数と連続待ちに使う */
  late: Record<string, LateJoin>;
}

/**
 * 遅れて来た人の扱い。plays は「すでにこれだけ出た」とみなす試合数（実際の出場に足す）。
 * at は来た時点（そのときの試合数）。連続待ちはここから数える（最初から待っていた扱いにしない）。
 */
export interface LateJoin {
  plays: number;
  at: number;
}

/** レートを計算し直す前の状態。「元に戻す」で使う */
export interface RatingSnapshot {
  /** いつ・何をする前か */
  at: string;
  label: string;
  /** 名前 → rating */
  ratings: Record<string, number>;
  /** p を推定して変えたときの、元の値 */
  weak?: { project: string; value: number };
}

export interface AppState {
  /** プレイヤーデータベース */
  db: Player[];
  projects: Project[];
  /** いま開いているプロジェクトの id */
  current: string;
  /** 見た目の設定（全プロジェクト共通） */
  prefs: Prefs;
  /** 直前のレートの計算し直しを取り消すための控え（なければ null） */
  rating_undo: RatingSnapshot | null;
  /** 保存形式の版。2 で K の既定値を 48 → 20 に移した */
  schema: number;
}

export const SCHEMA = 2;

export interface Prefs {
  /** レートと勝率予想を画面に出さない（組み方や書き出しには使う。見えないだけ） */
  hide_ratings: boolean;
}

export const DEFAULT_PREFS: Prefs = { hide_ratings: false };

const KEY = "doubles_kun_mobile.v2";
const KEY_V1 = "doubles_kun_mobile.v1";
/** 読めなかった保存データの退避先。初期状態で上書きする前に残しておく（復旧用） */
export const KEY_BROKEN = "doubles_kun_mobile.v2.broken";

export function newProject(name: string, base?: Partial<Project>): Project {
  const now = new Date().toISOString();
  const p: Project = {
    id: uuid(),
    name: name || "ダブルスくん",
    date: "",
    place: "",
    created_at: now,
    updated_at: now,
    matches: [],
    config: { ...DEFAULT_CONFIG },
    settings: { ...DEFAULT_MATCH_SETTINGS },
    members: [],
    selected: [],
    late: {},
  };
  // undefined の項目は既定値のまま（`id: d.id` のように渡せるように）
  for (const [k, v] of Object.entries(base ?? {})) if (v !== undefined) (p as unknown as Record<string, unknown>)[k] = v;
  return p;
}

/** 今日の日付（端末のローカル時刻で YYYY-MM-DD） */
export function todayIso(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function emptyState(): AppState {
  const p = newProject("ダブルスくん");
  return { db: [], projects: [p], current: p.id, prefs: { ...DEFAULT_PREFS }, rating_undo: null, schema: SCHEMA };
}

/** K の既定値を 48 から 20 に変えた（v0.9.0）。古い既定値のままのプロジェクトだけ 20 にする（一度だけ）。 */
const OLD_DEFAULT_K = 48;
function migrateK(projects: Project[]): Project[] {
  return projects.map((p) => (p.config.elo_k_factor === OLD_DEFAULT_K ? { ...p, config: { ...p.config, elo_k_factor: DEFAULT_CONFIG.elo_k_factor } } : p));
}

export function loadState(): AppState {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(KEY);
    if (raw) return stateFromJson(JSON.parse(raw));
    // 旧版（プロジェクトが 1 つだけ）からの移行。旧データは念のため残す
    const old = localStorage.getItem(KEY_V1);
    if (old) {
      const s = migrateV1(JSON.parse(old));
      saveState(s);
      return s;
    }
  } catch {
    // 壊れていたら初期状態から。ただし次の保存で元のデータが上書きされるので、
    // 読めなかった中身は別のキーに退避しておく（手で取り出して復旧できる）
    if (raw) {
      try {
        localStorage.setItem(KEY_BROKEN, raw);
      } catch {
        // 退避もできなければあきらめる
      }
    }
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

/** 旧版の状態（players / matches / selected が 1 組）を、データベース + プロジェクト 1 つに直す。 */
export function migrateV1(d: Record<string, unknown>): AppState {
  const { players, project } = projectFromJson(d);
  return { db: players, projects: migrateK([project]), current: project.id, prefs: { ...DEFAULT_PREFS }, rating_undo: null, schema: SCHEMA };
}

export function stateFromJson(d: Record<string, unknown>): AppState {
  const db = dedupe(playersFromJson(d.db));
  const names = new Set(db.map((p) => p.name));
  const projects = Array.isArray(d.projects)
    ? (d.projects as Record<string, unknown>[]).map((p) => projectFromJson(p, names).project)
    : [];
  if (projects.length === 0) projects.push(newProject("ダブルスくん"));
  const current = typeof d.current === "string" && projects.some((p) => p.id === d.current) ? d.current : projects[0].id;
  const prefsRaw = (d.prefs ?? {}) as Record<string, unknown>;
  const prefs: Prefs = { hide_ratings: Boolean(prefsRaw.hide_ratings) };
  const schema = typeof d.schema === "number" ? d.schema : 1;
  return {
    db,
    projects: schema < 2 ? migrateK(projects) : projects,
    current,
    prefs,
    rating_undo: snapshotFromJson(d.rating_undo),
    schema: SCHEMA,
  };
}

function snapshotFromJson(v: unknown): RatingSnapshot | null {
  if (!v || typeof v !== "object") return null;
  const d = v as Record<string, unknown>;
  if (!d.ratings || typeof d.ratings !== "object") return null;
  const ratings: Record<string, number> = {};
  for (const [k, x] of Object.entries(d.ratings as Record<string, unknown>)) if (typeof x === "number" && Number.isFinite(x)) ratings[k] = x;
  const w = d.weak as Record<string, unknown> | undefined;
  return {
    at: typeof d.at === "string" ? d.at : "",
    label: typeof d.label === "string" ? d.label : "",
    ratings,
    weak: w && typeof w.project === "string" && typeof w.value === "number" ? { project: w.project, value: w.value } : undefined,
  };
}

/**
 * プロジェクト 1 つ分を JSON から読む。デスクトップ版の project.json + players.json + matches.json を
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
  const late: Record<string, LateJoin> = {};
  if (d.late && typeof d.late === "object") {
    for (const [n, x] of Object.entries(d.late as Record<string, Record<string, unknown>>)) {
      if (!memberSet.has(n) || !x || typeof x.plays !== "number" || !Number.isFinite(x.plays) || x.plays < 0) continue;
      late[n] = { plays: Math.round(x.plays), at: typeof x.at === "number" && Number.isFinite(x.at) ? Math.max(0, Math.round(x.at)) : 0 };
    }
  }
  const project = newProject(typeof d.name === "string" && d.name.trim() ? d.name.trim() : "ダブルスくん", {
    id: typeof d.id === "string" && d.id ? d.id : undefined,
    date: typeof d.date === "string" ? d.date : undefined,
    place: typeof d.place === "string" ? d.place : undefined,
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
    late,
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

// ---- プロジェクトの出し入れ ----

export function currentProject(s: AppState): Project {
  return s.projects.find((p) => p.id === s.current) ?? s.projects[0];
}

/** いま開いているプロジェクトだけを書き換える。updated_at も進める。 */
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
  if (projects.length === 0) return { ...emptyState(), db: s.db, prefs: s.prefs, rating_undo: s.rating_undo };
  return { ...s, projects, current: s.current === id ? projects[0].id : s.current };
}

// ---- 遅れて来た人 ----

/** 組むときに足す仮の試合数と、来た時点（エンジン・一括計画・集計に渡す形） */
export function lateMaps(p: Project): { offsets: Map<string, number>; joined: Map<string, number> } {
  const entries = Object.entries(p.late).filter(([n]) => p.members.includes(n));
  return { offsets: new Map(entries.map(([n, x]) => [n, x.plays])), joined: new Map(entries.map(([n, x]) => [n, x.at])) };
}

/**
 * 遅れて来た人として記録する（plays は仮の試合数、0 でもよい）。null なら取り消す。
 * 来た時点は、初めて記録したときの試合数（あとで試合数だけ変えても動かさない）。
 */
export function setLate(p: Project, name: string, plays: number | null): Project {
  const late = { ...p.late };
  if (plays === null) delete late[name];
  else late[name] = { plays: Math.max(0, Math.round(plays)), at: p.late[name]?.at ?? p.matches.length };
  return { ...p, late };
}

// ---- メンバーの 3 層 ----

/** 名簿（データベース上の Player）。members の順。 */
export function memberPlayers(s: AppState, p: Project = currentProject(s)): Player[] {
  const byName = new Map(s.db.map((x) => [x.name, x]));
  return p.members.map((n) => byName.get(n)).filter((x): x is Player => x !== undefined);
}

/** 出場候補（名簿にいて、試合に入れるチェックが付いていて、いま試合中でない人）。 */
/** 出場候補（いまコートに入っている人も含む）。一括計画で使う */
export function attendingPlayers(s: AppState, p: Project = currentProject(s)): Player[] {
  const sel = new Set(p.selected);
  return memberPlayers(s, p).filter((x) => x.active && sel.has(x.name));
}

export function availablePlayers(s: AppState, p: Project = currentProject(s)): Player[] {
  const inPlay = new Set<string>();
  for (const m of p.matches) if (m.in_play) for (const n of [...m.team_a, ...m.team_b]) inPlay.add(n);
  return attendingPlayers(s, p).filter((x) => !inPlay.has(x.name));
}

export function playedIn(p: Project, name: string): boolean {
  return p.matches.some((m) => m.team_a.includes(name) || m.team_b.includes(name));
}

/** その名前がどれかのプロジェクトの試合に出ているか。 */
export function playedAnywhere(s: AppState, name: string): boolean {
  return s.projects.some((p) => playedIn(p, name));
}

/** データベースの名前を変える。すべてのプロジェクトの試合・名簿にも反映する。 */
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
      late: renameKey(p.late, from, to),
    })),
    rating_undo: s.rating_undo && { ...s.rating_undo, ratings: renameKey(s.rating_undo.ratings, from, to) },
  };
}

function renameKey<T>(o: Record<string, T>, from: string, to: string): Record<string, T> {
  if (!(from in o)) return o;
  const { [from]: v, ...rest } = o;
  return { ...rest, [to]: v };
}

/** names を除いた late（名簿から外したとき・削除したとき） */
export function dropLate(late: Record<string, LateJoin>, names: readonly string[]): Record<string, LateJoin> {
  if (!names.some((n) => n in late)) return late;
  return Object.fromEntries(Object.entries(late).filter(([n]) => !names.includes(n)));
}

/** データベースから消す。名簿からも外す（試合には出ていない前提）。 */
export function deletePlayer(s: AppState, name: string): AppState {
  return deletePlayers(s, [name]);
}

export function deletePlayers(s: AppState, names: readonly string[]): AppState {
  const set = new Set(names);
  const keep = (n: string) => !set.has(n);
  return {
    ...s,
    db: s.db.filter((p) => keep(p.name)),
    projects: s.projects.map((p) => ({ ...p, members: p.members.filter(keep), selected: p.selected.filter(keep), late: dropLate(p.late, names) })),
  };
}

/** データベースに players を足す（同じ名前は上書き）。 */
export function mergePlayers(s: AppState, players: readonly Player[]): AppState {
  const byName = new Map(s.db.map((p) => [p.name, p]));
  for (const p of players) byName.set(p.name, { ...(byName.get(p.name) ?? p), ...p });
  return { ...s, db: [...byName.values()] };
}

/** 読み込んだ 1 人分。ファイルに無かった項目は undefined（登録済みの人の値を残す）。 */
export type PlayerPatch = { name: string } & Partial<Omit<Player, "name">>;

/**
 * データベースに patches を足す。同じ名前の人は、ファイルにあった項目だけ上書きする。
 * レートだけあって初期レートがないときは、初期レートも同じ値にする（編集画面でレートを変えたときと同じ）。
 * 休会になった人は、どのプロジェクトでも試合の候補から外す。
 */
export function mergePlayerPatches(s: AppState, patches: readonly PlayerPatch[]): AppState {
  const byName = new Map(s.db.map((p) => [p.name, p]));
  for (const x of patches) {
    const base = byName.get(x.name) ?? newPlayer(x.name);
    byName.set(x.name, {
      name: x.name,
      rating: x.rating ?? base.rating,
      initial_rating: x.initial_rating ?? x.rating ?? base.initial_rating,
      team: x.team !== undefined ? x.team : base.team,
      active: x.active ?? base.active,
    });
  }
  const projects = s.projects.map((p) => ({ ...p, selected: p.selected.filter((n) => byName.get(n)?.active !== false) }));
  return { ...s, db: [...byName.values()], projects };
}

/** 何人かの所属・休会をまとめて変える。休会にした人は、どのプロジェクトでも試合の候補から外す。 */
export function updatePlayers(s: AppState, names: readonly string[], patch: Partial<Pick<Player, "team" | "active">>): AppState {
  const set = new Set(names);
  const db = s.db.map((p) => (set.has(p.name) ? { ...p, ...patch } : p));
  const projects = patch.active === false ? s.projects.map((p) => ({ ...p, selected: p.selected.filter((n) => !set.has(n)) })) : s.projects;
  return { ...s, db, projects };
}

/** データベースにだけ登録する。どのプロジェクトの名簿も変えない。 */
export function registerPlayer(s: AppState, name: string, rating = 1500): AppState {
  return { ...s, db: [...s.db, newPlayer(name, rating)] };
}

export interface ProjectRecord {
  project: Project;
  /** 名簿に入っているか */
  member: boolean;
  /** 結果の入った試合の数と勝敗 */
  played: number;
  wins: number;
  losses: number;
  draws: number;
}

/** その人が名簿に入っているか試合に出たプロジェクトと、そこでの成績。日付の新しい順。 */
export function playerHistory(s: AppState, name: string): ProjectRecord[] {
  const out: ProjectRecord[] = [];
  for (const p of s.projects) {
    const r: ProjectRecord = { project: p, member: p.members.includes(name), played: 0, wins: 0, losses: 0, draws: 0 };
    let appeared = false;
    for (const m of p.matches) {
      const side = m.team_a.includes(name) ? "A" : m.team_b.includes(name) ? "B" : null;
      if (side === null) continue;
      appeared = true;
      if (m.result === null) continue;
      r.played++;
      if (m.result === "D") r.draws++;
      else if (m.result === side) r.wins++;
      else r.losses++;
    }
    if (r.member || appeared) out.push(r);
  }
  return out.sort((a, b) => (b.project.date || "").localeCompare(a.project.date || "") || b.project.updated_at.localeCompare(a.project.updated_at));
}

/** レートの計算で試合を流す順：開催日の古い順（日付未定は最後）、同じ日なら作った順。プロジェクトの中は一覧の順。 */
export function projectsInPlayOrder(s: AppState): Project[] {
  return [...s.projects].sort((a, b) => Number(!a.date) - Number(!b.date) || a.date.localeCompare(b.date) || a.created_at.localeCompare(b.created_at));
}

/**
 * データベースのレートを、初期レートから全プロジェクトの試合で計算し直す。
 * K・p・G は試合ごとに、その試合のプロジェクトの設定を使う。
 */
export function recalcGlobal(s: AppState): AppState {
  const db = s.db.map((x) => ({ ...x, rating: x.initial_rating }));
  for (const p of projectsInPlayOrder(s)) {
    applyMatches(db, p.matches, { kFactor: p.config.elo_k_factor, weakWeight: p.config.pair_weak_weight, gameScale: p.config.game_scale });
  }
  return { ...s, db };
}

/**
 * 状態が変わるたびに呼ぶ。開いているプロジェクトで「試合結果でレートを自動更新」が ON なら、全試合で計算し直す。
 * （開いているプロジェクトの試合だけで計算すると、プロジェクトを切り替えるたびにレートが変わってしまう）
 */
export function recalcRatings(s: AppState, force = false): AppState {
  if (!force && !currentProject(s).config.elo_auto_update) return s;
  return recalcGlobal(s);
}

/** 自動更新が ON か（ON のときは、計算し直しの取り消しがすぐ上書きされるので出さない） */
export function autoRating(s: AppState): boolean {
  return currentProject(s).config.elo_auto_update;
}

/** いまのレート（と p）を控えてから fn を当てる。「元に戻す」で控えに戻せる。 */
export function withRatingUndo(s: AppState, label: string, fn: (s: AppState) => AppState, weakOf?: Project): AppState {
  const snap: RatingSnapshot = {
    at: new Date().toISOString(),
    label,
    ratings: Object.fromEntries(s.db.map((p) => [p.name, p.rating])),
    weak: weakOf ? { project: weakOf.id, value: weakOf.config.pair_weak_weight } : undefined,
  };
  return { ...fn(s), rating_undo: snap };
}

/** 控えに戻す。消えた人・消えたプロジェクトは飛ばす。 */
export function undoRatings(s: AppState): AppState {
  const u = s.rating_undo;
  if (!u) return s;
  const db = s.db.map((p) => (p.name in u.ratings ? { ...p, rating: u.ratings[p.name] } : p));
  const projects = u.weak
    ? s.projects.map((p) => (p.id === u.weak!.project ? { ...p, config: { ...p.config, pair_weak_weight: u.weak!.value } } : p))
    : s.projects;
  return { ...s, db, projects, rating_undo: null };
}

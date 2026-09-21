/**
 * アプリの状態と保存。
 *
 * サーバーはないので端末の localStorage に保存する。デスクトップ版と同じ
 * players.json / matches.json の形で書き出し・読み込みができる（io.ts）。
 */

import { DEFAULT_CONFIG, DEFAULT_MATCH_SETTINGS, configFromJson, type EngineConfig, type MatchSettings } from "./core/config";
import { matchFromJson, playerFromJson, type Match, type Player } from "./core/models";

export interface AppState {
  name: string;
  players: Player[];
  matches: Match[];
  config: EngineConfig;
  settings: MatchSettings;
  /** 出場候補（今日出る人）の名前 */
  selected: string[];
}

const KEY = "doubles_kun_mobile.v1";

export function emptyState(): AppState {
  return {
    name: "ダブルスくん",
    players: [],
    matches: [],
    config: { ...DEFAULT_CONFIG },
    settings: { ...DEFAULT_MATCH_SETTINGS },
    selected: [],
  };
}

export function loadState(): AppState {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return emptyState();
    return stateFromJson(JSON.parse(raw));
  } catch {
    return emptyState();
  }
}

export function saveState(s: AppState): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    // 容量超過やプライベートモード。画面上の状態はそのまま使える
  }
}

export function stateFromJson(d: Record<string, unknown>): AppState {
  const base = emptyState();
  const players = Array.isArray(d.players)
    ? (d.players as Record<string, unknown>[]).map(playerFromJson).filter((p): p is Player => p !== null)
    : [];
  const matches = Array.isArray(d.matches)
    ? (d.matches as Record<string, unknown>[]).map(matchFromJson).filter((m): m is Match => m !== null)
    : [];
  const names = new Set(players.map((p) => p.name));
  const selectedRaw = Array.isArray(d.selected) ? d.selected : Array.isArray(d.selected_players) ? d.selected_players : null;
  const selected = selectedRaw ? (selectedRaw as unknown[]).map(String).filter((n) => names.has(n)) : players.filter((p) => p.active).map((p) => p.name);
  const settingsRaw = (d.settings ?? d.match_settings) as Record<string, unknown> | undefined;
  return {
    name: typeof d.name === "string" && d.name ? d.name : base.name,
    players: dedupe(players),
    matches,
    config: configFromJson((d.config ?? d.engine_config) as Record<string, unknown> | undefined),
    settings: {
      rating_match: settingsRaw?.rating_match === undefined ? true : Boolean(settingsRaw.rating_match),
      avoid_same_team: Boolean(settingsRaw?.avoid_same_team),
    },
    selected,
  };
}

function dedupe(players: Player[]): Player[] {
  const seen = new Set<string>();
  return players.filter((p) => (seen.has(p.name) ? false : (seen.add(p.name), true)));
}

/** 出場候補（出席していて、候補に入っていて、いま試合中でない人）。 */
export function availablePlayers(s: AppState): Player[] {
  const inPlay = new Set<string>();
  for (const m of s.matches) if (m.in_play) for (const n of [...m.team_a, ...m.team_b]) inPlay.add(n);
  const sel = new Set(s.selected);
  return s.players.filter((p) => p.active && sel.has(p.name) && !inPlay.has(p.name));
}

export function activePlayers(s: AppState): Player[] {
  return s.players.filter((p) => p.active);
}

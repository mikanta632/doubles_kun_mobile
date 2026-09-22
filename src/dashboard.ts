/**
 * 集計（デスクトップ版 dashboard_viewmodel.py の移植）。
 * 「誰をケアすべきか」が分かる形にまとめる。判定はエンジンと同じ設定で行う。
 */

import type { EngineConfig } from "./core/config";
import { waitCapFor } from "./core/dayEngine";
import { computeDayMetrics, daySummary, distinctContacts } from "./core/dayMetrics";
import type { Match, Player } from "./core/models";

export const CONTACT_ALERT = 3;
export const BLOWOUT_ALERT = 2;

export type Level = "ok" | "warn" | "bad";

export interface Card {
  key: string;
  title: string;
  value: string;
  sub: string;
  level: Level;
}

export interface PersonRow {
  name: string;
  rating: number;
  plays: number;
  current_wait: number;
  max_wait: number;
  blowouts: number;
  contacts: number;
  unmet: string[];
  short_repeats: number;
  flags: { plays: boolean; current_wait: boolean; blowouts: boolean };
}

export interface TimelineCell {
  outcome: "win" | "lose" | "draw" | "pending";
  tip: string;
}

export interface RankingRow {
  rank: number;
  name: string;
  played: number;
  wins: number;
  losses: number;
  draws: number;
  win_rate: number;
  avg_games: number;
  point_diff: number;
}

export interface Dashboard {
  cards: Card[];
  people: { rows: PersonRow[]; meta: { wait_cap: number; plays_min: number; plays_max: number; rounds: number } };
  contacts: { names: string[]; matrix: Map<string, Map<string, [number, number]>>; max_count: number };
  timeline: { names: string[]; rounds: number; grid: Map<string, (TimelineCell | null)[]> };
  ranking: RankingRow[];
}

export function buildDashboard(players: readonly Player[], allMatches: readonly Match[], cfg: EngineConfig): Dashboard {
  const courts = Math.max(1, cfg.courts);
  const nameSet = new Set(players.map((p) => p.name));
  const matches = allMatches.filter((m) => [...m.team_a, ...m.team_b].some((n) => nameSet.has(n)));
  const ratings = new Map(players.map((p) => [p.name, p.initial_rating ?? p.rating]));
  const names = [...ratings.keys()].sort((a, b) => ratings.get(b)! - ratings.get(a)! || (a < b ? -1 : a > b ? 1 : 0));
  const rounds = Math.ceil(matches.length / courts);

  if (names.length === 0) {
    return {
      cards: [],
      people: { rows: [], meta: { wait_cap: 0, plays_min: 0, plays_max: 0, rounds: 0 } },
      contacts: { names: [], matrix: new Map(), max_count: 0 },
      timeline: { names: [], rounds: 0, grid: new Map() },
      ranking: [],
    };
  }

  const report = computeDayMetrics(matches, ratings, names, {
    courts,
    kFactor: cfg.elo_k_factor,
    winBand: cfg.day_win_prob_min,
    gameScale: cfg.game_scale,
    weakWeight: cfg.pair_weak_weight,
    applyElo: cfg.elo_auto_update,
  });
  const waitCap = waitCapFor(cfg, names.length, courts);

  // 一人ひとり
  const persons = names.map((n) => report.persons.get(n)!).filter(Boolean);
  const plays = persons.map((p) => p.plays);
  const playsMin = plays.length ? Math.min(...plays) : 0;
  const playsMax = plays.length ? Math.max(...plays) : 0;
  const spread = playsMax - playsMin;
  const rows: PersonRow[] = persons.map((pm) => {
    const met = new Set([...pm.partners, ...pm.opponents]);
    return {
      name: pm.name,
      rating: ratings.get(pm.name)!,
      plays: pm.plays,
      current_wait: pm.current_wait,
      max_wait: pm.max_wait,
      blowouts: pm.blowouts,
      contacts: distinctContacts(pm),
      unmet: names.filter((n) => n !== pm.name && !met.has(n)),
      short_repeats: pm.short_repeats,
      flags: {
        plays: pm.plays === playsMin && spread > cfg.day_play_slack,
        current_wait: pm.current_wait >= waitCap,
        blowouts: pm.blowouts >= BLOWOUT_ALERT,
      },
    };
  });
  rows.sort((a, b) => a.plays - b.plays || b.current_wait - a.current_wait || b.rating - a.rating);

  // カード
  const summary = daySummary(report);
  const completed = matches.filter((m) => m.result !== null).length;
  const inPlay = matches.filter((m) => m.in_play).length;
  const waitingNow = rows.length ? Math.max(...rows.map((r) => r.current_wait)) : 0;
  const waitingNames = rows.filter((r) => r.current_wait === waitingNow && waitingNow > 0).map((r) => r.name);
  const level = (bad: boolean, warn = false): Level => (bad ? "bad" : warn ? "warn" : "ok");
  const cards: Card[] = [
    { key: "matches", title: "試合数", value: String(matches.length), sub: `完了 ${completed}・進行中 ${inPlay}・${rounds} ラウンド`, level: "ok" },
    { key: "plays_spread", title: "出場回数の差", value: String(spread), sub: `最少 ${playsMin}・最多 ${playsMax}`, level: level(spread > cfg.day_play_slack + 1, spread > cfg.day_play_slack) },
    {
      key: "waiting",
      title: "最長の連続待ち",
      value: `${waitingNow} ラウンド`,
      sub: waitingNames.length ? waitingNames.slice(0, 3).join("、") + (waitingNames.length > 3 ? "…" : "") : "待っている人はいません",
      level: level(waitingNow >= waitCap, waitingNow >= waitCap - 1),
    },
    { key: "short_repeats", title: "再同席", value: String(summary?.short_repeats_total ?? 0), sub: "", level: level(false, (summary?.short_repeats_total ?? 0) > 0) },
    { key: "blowouts", title: "大差の試合", value: String(summary?.blowouts_total ?? 0), sub: "", level: level(false, (summary?.blowouts_total ?? 0) > 0) },
  ];

  // 同席
  const matrix = new Map<string, Map<string, [number, number]>>();
  for (const a of names) matrix.set(a, new Map(names.filter((b) => b !== a).map((b) => [b, [0, 0]])));
  const bump = (a: string, b: string, kind: 0 | 1) => {
    if (a === b || !nameSet.has(a) || !nameSet.has(b)) return;
    matrix.get(a)!.get(b)![kind]++;
    matrix.get(b)!.get(a)![kind]++;
  };
  for (const m of matches) {
    if (m.team_a.length !== 2 || m.team_b.length !== 2) continue;
    bump(m.team_a[0], m.team_a[1], 0);
    bump(m.team_b[0], m.team_b[1], 0);
    for (const a of m.team_a) for (const b of m.team_b) bump(a, b, 1);
  }
  let maxCount = 0;
  for (const row of matrix.values()) for (const v of row.values()) maxCount = Math.max(maxCount, v[0] + v[1]);

  // タイムライン
  const grid = new Map<string, (TimelineCell | null)[]>(names.map((n) => [n, []]));
  for (let r = 0; r < rounds; r++) {
    const group = matches.slice(r * courts, (r + 1) * courts);
    const placed = new Set<string>();
    group.forEach((m, court) => {
      const score = m.games_a !== null && m.games_b !== null ? `${m.games_a}-${m.games_b}` : "";
      const tip = `R${r + 1} コート${court + 1}: ${m.team_a.join("・")} vs ${m.team_b.join("・")} ${score}`.trimEnd();
      for (const [side, team] of [["A", m.team_a], ["B", m.team_b]] as const) {
        const outcome: TimelineCell["outcome"] = m.result === null ? "pending" : m.result === "D" ? "draw" : m.result === side ? "win" : "lose";
        for (const n of team) {
          if (grid.has(n)) {
            grid.get(n)!.push({ outcome, tip });
            placed.add(n);
          }
        }
      }
    });
    for (const n of names) if (!placed.has(n)) grid.get(n)!.push(null);
  }

  // 成績
  const stats = new Map(names.map((n) => [n, { played: 0, wins: 0, losses: 0, draws: 0, scored: 0, allowed: 0 }]));
  for (const m of matches) {
    if (m.result === null || m.games_a === null || m.games_b === null) continue;
    if (m.team_a.length !== 2 || m.team_b.length !== 2) continue;
    for (const [side, team, mine, theirs] of [["A", m.team_a, m.games_a, m.games_b], ["B", m.team_b, m.games_b, m.games_a]] as const) {
      for (const n of team) {
        const s = stats.get(n);
        if (!s) continue;
        s.played++;
        s.scored += mine;
        s.allowed += theirs;
        if (m.result === "D") s.draws++;
        else if (m.result === side) s.wins++;
        else s.losses++;
      }
    }
  }
  const ranking: RankingRow[] = [...stats.entries()].map(([name, s]) => ({
    rank: 0,
    name,
    played: s.played,
    wins: s.wins,
    losses: s.losses,
    draws: s.draws,
    win_rate: s.played ? s.wins / s.played : 0,
    avg_games: s.played ? s.scored / s.played : 0,
    point_diff: s.scored - s.allowed,
  }));
  ranking.sort((a, b) => Number(a.played === 0) - Number(b.played === 0) || b.win_rate - a.win_rate || b.point_diff - a.point_diff || b.wins - a.wins || (a.name < b.name ? -1 : 1));
  let rank = 0;
  for (const r of ranking) r.rank = r.played > 0 ? ++rank : 0;

  return {
    cards,
    people: { rows, meta: { wait_cap: waitCap, plays_min: playsMin, plays_max: playsMax, rounds } },
    contacts: { names, matrix, max_count: maxCount },
    timeline: { names, rounds, grid },
    ranking,
  };
}

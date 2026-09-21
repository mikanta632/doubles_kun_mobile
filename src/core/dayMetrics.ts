/** 「良い一日」の指標（デスクトップ版 day_metrics.py の移植）。 */

import { bandCutoffs, bandOf, pairKey } from "./dayEngine";
import type { Match } from "./models";
import { DEFAULT_GAME_SCALE, expectedWin, pairStrength } from "./winModel";

export interface PersonMetrics {
  name: string;
  band: number;
  plays: number;
  max_wait: number;
  current_wait: number;
  blowouts: number;
  weak_side: number;
  partners: Set<string>;
  opponents: Set<string>;
  mixed_matches: number;
  short_repeats: number;
}

export interface DaySummary {
  plays_spread: number;
  wait_worst: number;
  blowouts_total: number;
  blowouts_worst: number;
  weak_side_worst: number;
  contacts_worst: number;
  contacts_mean: number;
  contacts_edge_mean: number;
  contacts_mid_mean: number;
  mixing_worst: number;
  mixing_mean: number;
  short_repeats_total: number;
}

export interface DayReport {
  persons: Map<string, PersonMetrics>;
  match_count: number;
  courts: number;
}

export function distinctContacts(pm: PersonMetrics): number {
  return new Set([...pm.partners, ...pm.opponents]).size;
}

export function mixingRate(pm: PersonMetrics): number {
  return pm.plays ? pm.mixed_matches / pm.plays : 0;
}

export function daySummary(rep: DayReport): DaySummary | null {
  const ps = [...rep.persons.values()];
  if (ps.length === 0) return null;
  const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
  const plays = ps.map((p) => p.plays);
  const contacts = ps.map(distinctContacts);
  const edge = ps.filter((p) => p.band === 0 || p.band === 2);
  const mid = ps.filter((p) => p.band === 1);
  return {
    plays_spread: Math.max(...plays) - Math.min(...plays),
    wait_worst: Math.max(...ps.map((p) => p.max_wait)),
    blowouts_total: Math.floor(ps.reduce((a, p) => a + p.blowouts, 0) / 4),
    blowouts_worst: Math.max(...ps.map((p) => p.blowouts)),
    weak_side_worst: Math.max(...ps.map((p) => p.weak_side)),
    contacts_worst: Math.min(...contacts),
    contacts_mean: mean(contacts),
    contacts_edge_mean: mean(edge.map(distinctContacts)),
    contacts_mid_mean: mean(mid.map(distinctContacts)),
    mixing_worst: Math.min(...ps.map(mixingRate)),
    mixing_mean: mean(ps.map(mixingRate)),
    short_repeats_total: Math.floor(ps.reduce((a, p) => a + p.short_repeats, 0) / 2),
  };
}

export interface MetricsOptions {
  courts?: number;
  kFactor?: number;
  winBand?: number;
  gameScale?: number;
  weakWeight?: number;
  weakGap?: number;
  nBands?: number;
  applyElo?: boolean;
}

export function computeDayMetrics(matches: readonly Match[], ratings: Map<string, number>, present?: Iterable<string>, opts: MetricsOptions = {}): DayReport {
  const courts = Math.max(1, opts.courts ?? 1);
  const k = opts.kFactor ?? 48;
  const winBand = opts.winBand ?? 0.35;
  const g = opts.gameScale ?? DEFAULT_GAME_SCALE;
  const w = opts.weakWeight ?? 0.5;
  const weakGap = opts.weakGap ?? 250;
  const nBands = opts.nBands ?? 3;
  const applyElo = opts.applyElo ?? true;

  const current = new Map(ratings);
  const presentSet = new Set<string>();
  if (present === undefined) {
    for (const m of matches) for (const n of [...m.team_a, ...m.team_b]) presentSet.add(n);
  } else for (const n of present) presentSet.add(n);
  for (const n of presentSet) if (!current.has(n)) current.set(n, 1500);

  const cutoffs = bandCutoffs([...presentSet].map((n) => current.get(n)!), nBands);
  const persons = new Map<string, PersonMetrics>();
  const mk = (n: string): PersonMetrics => ({
    name: n,
    band: bandOf(current.get(n) ?? 1500, cutoffs),
    plays: 0,
    max_wait: 0,
    current_wait: 0,
    blowouts: 0,
    weak_side: 0,
    partners: new Set(),
    opponents: new Set(),
    mixed_matches: 0,
    short_repeats: 0,
  });
  for (const n of presentSet) persons.set(n, mk(n));
  const dyadLast = new Map<string, number>();

  const rounds: Match[][] = [];
  matches.forEach((m, i) => {
    if (i % courts === 0) rounds.push([]);
    rounds[rounds.length - 1].push(m);
  });

  rounds.forEach((group, rnd) => {
    const played = new Set<string>();
    const updates = new Map<string, number>();
    for (const m of group) {
      if (m.team_a.length !== 2 || m.team_b.length !== 2) continue;
      const names = [...m.team_a, ...m.team_b];
      for (const n of names) {
        if (!persons.has(n)) persons.set(n, mk(n));
        if (!current.has(n)) current.set(n, 1500);
        played.add(n);
      }
      const sa = pairStrength(current.get(m.team_a[0])!, current.get(m.team_a[1])!, w);
      const sb = pairStrength(current.get(m.team_b[0])!, current.get(m.team_b[1])!, w);
      const pA = expectedWin(sa, sb, g);
      const blowout = pA < winBand || pA > 1 - winBand;
      const bands = new Set(names.map((n) => persons.get(n)!.band));
      for (const n of names) {
        const pm = persons.get(n)!;
        pm.plays++;
        if (blowout) pm.blowouts++;
        if (bands.size > 1) pm.mixed_matches++;
      }
      for (const [a, b] of [m.team_a, m.team_b]) {
        persons.get(a)!.partners.add(b);
        persons.get(b)!.partners.add(a);
        if (Math.abs(current.get(a)! - current.get(b)!) >= weakGap) {
          const weak = current.get(a)! < current.get(b)! ? a : b;
          persons.get(weak)!.weak_side++;
        }
      }
      for (const a of m.team_a)
        for (const b of m.team_b) {
          persons.get(a)!.opponents.add(b);
          persons.get(b)!.opponents.add(a);
        }
      for (let i = 0; i < 4; i++)
        for (let j = i + 1; j < 4; j++) {
          const key = pairKey(names[i], names[j]);
          const last = dyadLast.get(key);
          if (last !== undefined && rnd - last <= 2) {
            persons.get(names[i])!.short_repeats++;
            persons.get(names[j])!.short_repeats++;
          }
          dyadLast.set(key, rnd);
        }
      if (applyElo && (m.result === "A" || m.result === "B" || m.result === "D")) {
        const actualA = m.result === "A" ? 1 : m.result === "B" ? 0 : 0.5;
        const deltaA = k * (actualA - pA);
        for (const n of m.team_a) updates.set(n, (updates.get(n) ?? 0) + deltaA);
        for (const n of m.team_b) updates.set(n, (updates.get(n) ?? 0) - deltaA);
      }
    }
    for (const [n, d] of updates) current.set(n, current.get(n)! + d);
    for (const n of presentSet) {
      const pm = persons.get(n)!;
      if (played.has(n)) pm.current_wait = 0;
      else {
        pm.current_wait++;
        pm.max_wait = Math.max(pm.max_wait, pm.current_wait);
      }
    }
  });

  return { persons, match_count: matches.length, courts };
}

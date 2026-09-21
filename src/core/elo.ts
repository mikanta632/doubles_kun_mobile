/** Elo レーティング。ペア強度モデルと 1 ゲーム基準の勝率で更新する。 */

import type { Match, Player } from "./models";
import { DEFAULT_GAME_SCALE, DEFAULT_WEAK_WEIGHT, expectedWin, pairStrength } from "./winModel";

export interface EloOptions {
  kFactor?: number;
  weakWeight?: number;
  gameScale?: number;
}

export function teamRating(ratings: number[], weakWeight = DEFAULT_WEAK_WEIGHT): number {
  if (ratings.length === 0) return 1500;
  if (ratings.length === 2) return pairStrength(ratings[0], ratings[1], weakWeight);
  return ratings.reduce((a, b) => a + b, 0) / ratings.length;
}

/** 各人の初期レートに戻し、全試合をリスト順に再計算する。players を書き換える。 */
export function recalculateAll(players: Player[], matches: readonly Match[], opts: EloOptions = {}): void {
  const k = opts.kFactor ?? 48;
  const w = opts.weakWeight ?? DEFAULT_WEAK_WEIGHT;
  const g = opts.gameScale ?? DEFAULT_GAME_SCALE;
  for (const p of players) p.rating = p.initial_rating;
  const byName = new Map(players.map((p) => [p.name, p]));
  for (const m of matches) {
    if (!m.result) continue;
    const a = m.team_a.map((n) => byName.get(n)).filter((p): p is Player => p !== undefined);
    const b = m.team_b.map((n) => byName.get(n)).filter((p): p is Player => p !== undefined);
    if (a.length !== 2 || b.length !== 2) continue;
    const ra = teamRating(a.map((p) => p.rating), w);
    const rb = teamRating(b.map((p) => p.rating), w);
    const ea = expectedWin(ra, rb, g);
    const eb = 1 - ea;
    const [actualA, actualB] = m.result === "A" ? [1, 0] : m.result === "B" ? [0, 1] : [0.5, 0.5];
    const da = k * (actualA - ea);
    const db = k * (actualB - eb);
    const updates = new Map<string, number>();
    for (const p of a) updates.set(p.name, p.rating + da);
    for (const p of b) updates.set(p.name, p.rating + db);
    for (const p of players) {
      const v = updates.get(p.name);
      if (v !== undefined) p.rating = round2(v);
    }
  }
}

/** Python の round(x, 2)（偶数丸め）に合わせる。 */
function round2(x: number): number {
  const s = x * 100;
  const f = Math.floor(s);
  const frac = s - f;
  let r: number;
  if (frac > 0.5) r = f + 1;
  else if (frac < 0.5) r = f;
  else r = f % 2 === 0 ? f : f + 1;
  return r / 100;
}

/** ペア強度モデルの弱い側の重み p を、試合結果（ゲーム数）から推定する。 */

import type { Match } from "./models";
import { pairStrength } from "./winModel";

const LN10 = Math.log(10);
const P_RANGE = Array.from({ length: 81 }, (_, i) => (i + 10) / 100);
const G_RANGE = Array.from({ length: 77 }, (_, i) => 200 + 50 * i);
const CHI2_95_HALF = 1.92;
const CONCLUSIVE_WIDTH = 0.3;

export interface PairModelEstimate {
  weak_weight: number;
  ci_low: number;
  ci_high: number;
  game_scale: number;
  n_matches: number;
  n_games: number;
  log_likelihood: number;
  log_likelihood_half: number;
}

export function isConclusive(e: PairModelEstimate): boolean {
  return e.ci_high - e.ci_low <= CONCLUSIVE_WIDTH;
}

export function differsFromHalf(e: PairModelEstimate): boolean {
  return !(e.ci_low <= 0.5 && 0.5 <= e.ci_high);
}

export function estimateSummary(e: PairModelEstimate): string {
  const lines = [
    `対象: ${e.n_matches} 試合 / ${e.n_games} ゲーム`,
    `推定された弱い側の重み p = ${e.weak_weight.toFixed(2)}（95% 区間 ${e.ci_low.toFixed(2)}〜${e.ci_high.toFixed(2)}）`,
  ];
  if (!isConclusive(e)) lines.push("区間が広く、まだ判断できません。0.50（単純平均）のままをおすすめします。");
  else if (differsFromHalf(e))
    lines.push("傾向: " + (e.weak_weight > 0.5 ? "格差ペアは平均より弱い（弱い側が狙われる）" : "格差ペアは平均より強い（強い側が引っ張る）"));
  else lines.push("0.50（単純平均）と区別がつく差はありません。");
  return lines.join("\n");
}

type Sample = [number, number, number, number, number, number];

function collectSamples(matches: readonly Match[], ratings: Map<string, number>): Sample[] {
  const out: Sample[] = [];
  for (const m of matches) {
    if (m.result !== "A" && m.result !== "B" && m.result !== "D") continue;
    if (m.games_a === null || m.games_b === null) continue;
    if (m.team_a.length !== 2 || m.team_b.length !== 2) continue;
    const names = [...m.team_a, ...m.team_b];
    if (names.some((n) => !ratings.has(n))) continue;
    const ga = Math.trunc(m.games_a);
    const gb = Math.trunc(m.games_b);
    if (ga + gb <= 0) continue;
    out.push([ratings.get(m.team_a[0])!, ratings.get(m.team_a[1])!, ratings.get(m.team_b[0])!, ratings.get(m.team_b[1])!, ga, gb]);
  }
  return out;
}

function logLikelihood(samples: Sample[], p: number, g: number): number {
  let total = 0;
  for (const [a1, a2, b1, b2, ga, gb] of samples) {
    const d = pairStrength(a1, a2, p) - pairStrength(b1, b2, p);
    const z = (LN10 * d) / g;
    let logQ: number;
    let log1Q: number;
    if (z >= 0) {
      logQ = -Math.log1p(Math.exp(-z));
      log1Q = -z - Math.log1p(Math.exp(-z));
    } else {
      logQ = z - Math.log1p(Math.exp(z));
      log1Q = -Math.log1p(Math.exp(z));
    }
    total += ga * logQ + gb * log1Q;
  }
  return total;
}

export function estimatePairModel(matches: readonly Match[], ratings: Map<string, number>): PairModelEstimate | null {
  const samples = collectSamples(matches, ratings);
  if (samples.length === 0) return null;
  const nGames = samples.reduce((a, s) => a + s[4] + s[5], 0);

  const profile: [number, number, number][] = [];
  for (const p of P_RANGE) {
    let bestG = G_RANGE[0];
    let bestLl = -Infinity;
    for (const g of G_RANGE) {
      const ll = logLikelihood(samples, p, g);
      if (ll > bestLl) {
        bestLl = ll;
        bestG = g;
      }
    }
    profile.push([p, bestG, bestLl]);
  }
  let best = profile[0];
  for (const e of profile) if (e[2] > best[2]) best = e;
  const [pHat, gHat, llMax] = best;
  const inside = profile.filter((e) => e[2] >= llMax - CHI2_95_HALF).map((e) => e[0]);
  let llHalf = -Infinity;
  for (const g of G_RANGE) llHalf = Math.max(llHalf, logLikelihood(samples, 0.5, g));

  return {
    weak_weight: pHat,
    ci_low: Math.min(...inside),
    ci_high: Math.max(...inside),
    game_scale: gHat,
    n_matches: samples.length,
    n_games: nGames,
    log_likelihood: llMax,
    log_likelihood_half: llHalf,
  };
}

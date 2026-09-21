/**
 * デスクトップ版（Python）が書き出した正解データと突き合わせる。
 * tools/make_golden.py を Python 側で実行すると tests/golden/*.json が更新される。
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { PyRandom } from "../src/core/rng";
import { gameWinProb, pairStrength, ratingDiffForProb } from "../src/core/winModel";
import { configFromJson } from "../src/core/config";
import { GoodDayEngine, bandCutoffs, bandOf, countPlays, waitCapFor } from "../src/core/dayEngine";
import { optimizePlan, planSummary } from "../src/core/planOptimizer";
import { recalculateAll } from "../src/core/elo";
import { computeDayMetrics, daySummary } from "../src/core/dayMetrics";
import { differsFromHalf, estimatePairModel, isConclusive } from "../src/core/pairModelEstimator";
import type { Match, MatchPairing, Player } from "../src/core/models";

function golden<T>(name: string): T {
  return JSON.parse(readFileSync(new URL(`./golden/${name}.json`, import.meta.url), "utf-8")) as T;
}

const names = (p: MatchPairing) => [[p[0][0].name, p[0][1].name], [p[1][0].name, p[1][1].name]];

describe("乱数（Python random 互換）", () => {
  it.each(golden<any[]>("rng"))("seed $seed", (c) => {
    const r = new PyRandom(BigInt(c.seed));  // seed は JSON の精度を超えるので文字列
    expect(Array.from({ length: 5 }, () => r.random())).toEqual(c.random);
    expect(Array.from({ length: 5 }, () => r.randrange(10))).toEqual(c.randrange10);
    expect(Array.from({ length: 3 }, () => r.randrange(1000003))).toEqual(c.randrange_big);
    const xs = Array.from({ length: 12 }, (_, i) => i);
    r.shuffle(xs);
    expect(xs).toEqual(c.shuffle12);
    expect(Array.from({ length: 5 }, () => r.choice(["a", "b", "c", "d", "e"]))).toEqual(c.choice);
    const keyed = Array.from({ length: 8 }, (_, i) => ({ i, k: [i % 3, r.random()] }));
    keyed.sort((a, b) => a.k[0] - b.k[0] || a.k[1] - b.k[1]);
    expect(keyed.map((e) => e.i)).toEqual(c.sorted_with_random_key);
  });
});

describe("勝率モデル", () => {
  const g = golden<any>("win_model");
  it("1 ゲームの勝率", () => {
    for (const c of g.win) expect(gameWinProb(c.a, c.b, c.scale)).toBeCloseTo(c.prob, 12);
  });
  it("勝率からレート差", () => {
    for (const c of g.diff) expect(ratingDiffForProb(c.target, c.scale)).toBeCloseTo(c.diff, 9);
  });
  it("ペア強度", () => {
    for (const c of g.pair) expect(pairStrength(c.r1, c.r2, c.p)).toBeCloseTo(c.s, 12);
  });
});

describe("良い一日エンジン（貪欲法の再生）", () => {
  it.each(golden<any[]>("day_engine"))("$name", (sc) => {
    const cfg = configFromJson(sc.config);
    const players: Player[] = sc.players;
    const rng = new PyRandom(sc.seed);
    const matches: Match[] = [];
    sc.steps.forEach((step: any, i: number) => {
      const inPlay = matches.filter((m) => m.in_play).length;
      const engine = new GoodDayEngine(players, matches, {
        config: cfg,
        courts: cfg.courts,
        freeCourts: Math.max(1, cfg.courts - inPlay),
        allPlayers: players,
        rng,
        plays: countPlays(players, matches),
      });
      const props = engine.generateMatches(sc.rating_match, sc.avoid_same_team);
      expect(props.slice(0, 6).map(names), `step ${i}`).toEqual(step.proposals);
      if (props.length === 0) return;
      expect(engine.explain(props[0]), `explain ${i}`).toBe(step.explain);
      expect(engine.waitCap()).toBe(step.wait_cap);
      expect(engine.dyadCap()).toBe(step.dyad_cap);
      matches.push(sc.matches[i]);
    });
  });
});

describe("一括計画（焼きなまし）", () => {
  it.each(golden<any[]>("plan_optimizer"))("$name", (sp) => {
    const past: Match[] = sp.past ?? [];
    const r = optimizePlan(sp.players, past, sp.n_matches, {
      courts: sp.courts,
      seed: sp.seed,
      setIters: sp.set_iters,
      orderIters: sp.order_iters,
    });
    if (sp.result === null) {
      expect(r).toBeNull();
      return;
    }
    expect(r).not.toBeNull();
    expect(r!.matches.map(names)).toEqual(sp.result.matches);
    const { matches: _m, summary, ...nums } = sp.result;
    const { matches: _n, ...got } = r!;
    expect(got).toEqual(nums);
    expect(planSummary(r!)).toBe(summary);
  });

  it("進捗と中止が効く", () => {
    const players: Player[] = golden<any[]>("plan_optimizer")[0].players;
    const seen: number[] = [];
    optimizePlan(players, [], 6, { seed: 1, setIters: 5000, orderIters: 3000, progress: (a) => seen.push(a) });
    expect(seen.length).toBeGreaterThan(2);
    expect(optimizePlan(players, [], 6, { seed: 1, stop: () => true })).toBeNull();
  });
});

describe("Elo・指標・推定", () => {
  const days = golden<any[]>("day_engine");
  it.each(golden<any[]>("services"))("$name", (sv) => {
    const sc = days.find((d) => d.name === sv.name)!;
    const cfg = configFromJson(sc.config);
    const players: Player[] = sc.players.map((p: Player) => ({ ...p }));
    const matches: Match[] = sc.matches;
    recalculateAll(players, matches, { kFactor: cfg.elo_k_factor, weakWeight: cfg.pair_weak_weight, gameScale: cfg.game_scale });
    expect(Object.fromEntries(players.map((p) => [p.name, p.rating]))).toEqual(sv.elo_after);

    const ratings0 = new Map<string, number>(sc.players.map((p: Player) => [p.name, p.rating]));
    expect(waitCapFor(cfg, players.length, cfg.courts)).toBe(sv.wait_cap);
    const cutoffs = bandCutoffs(players.map((p) => p.rating));
    expect(cutoffs).toEqual(sv.cutoffs);
    expect(Object.fromEntries(players.map((p) => [p.name, bandOf(p.rating, cutoffs)]))).toEqual(sv.bands);

    for (const [applyElo, expected] of [[false, sv.metrics], [true, sv.metrics_elo]] as const) {
      const rep = computeDayMetrics(matches, ratings0, players.map((p) => p.name), {
        courts: cfg.courts, kFactor: cfg.elo_k_factor, winBand: cfg.day_win_prob_min,
        gameScale: cfg.game_scale, weakWeight: cfg.pair_weak_weight, applyElo,
      });
      const persons = Object.fromEntries([...rep.persons.values()].map((pm) => [pm.name, {
        plays: pm.plays, max_wait: pm.max_wait, current_wait: pm.current_wait, blowouts: pm.blowouts,
        partners: [...pm.partners].sort(), opponents: [...pm.opponents].sort(),
        mixed_matches: pm.mixed_matches, short_repeats: pm.short_repeats, band: pm.band,
      }]));
      expect(persons).toEqual(expected.persons);
      const s = daySummary(rep)!;
      for (const [k, v] of Object.entries(expected.summary)) expect(s[k as keyof typeof s], k).toBeCloseTo(v as number, 9);
    }

    const est = estimatePairModel(matches, ratings0);
    if (sv.estimate === null) {
      expect(est).toBeNull();
    } else {
      expect(est).not.toBeNull();
      const { conclusive, differs_from_half, ...nums } = sv.estimate;
      for (const [k, v] of Object.entries(nums)) expect(est![k as keyof typeof est], k).toBeCloseTo(v as number, 6);
      expect(isConclusive(est!)).toBe(conclusive);
      expect(differsFromHalf(est!)).toBe(differs_from_half);
    }
  });
});

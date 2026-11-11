/**
 * 遅れて来た人の扱い・全プロジェクトでのレート計算と取り消し・K の既定値の移行。
 */
import { describe, expect, it } from "vitest";
import { DEFAULT_CONFIG } from "../src/core/config";
import { DayLedger, GoodDayEngine, countPlays } from "../src/core/dayEngine";
import { newMatch, newPlayer, pairingToMatch, type Match } from "../src/core/models";
import { PyRandom } from "../src/core/rng";
import { emptyState, lateMaps, newProject, recalcGlobal, renamePlayer, deletePlayers, setLate, stateFromJson, undoRatings, withRatingUndo, type AppState } from "../src/store";

const done = (a: string[], b: string[], r: "A" | "B" = "A"): Match => ({ ...newMatch(a, b), games_a: r === "A" ? 6 : 2, games_b: r === "A" ? 2 : 6, result: r });

describe("遅れて来た人", () => {
  it("連続待ちは来た時点から数える", () => {
    const ms = Array.from({ length: 6 }, () => done(["A", "B"], ["C", "D"]));
    expect(new DayLedger(ms, 1).waitedRounds("Z")).toBe(6);
    expect(new DayLedger(ms, 1, new Map([["Z", 4]])).waitedRounds("Z")).toBe(2);
    expect(new DayLedger(ms, 1, new Map([["Z", 6]])).waitedRounds("Z")).toBe(0);
  });

  /** 8 人・1 面で 6 試合のあと Z が来て、さらに 6 試合組んだときの Z の出場数 */
  function lateRun(late: boolean): number {
    const players = "ABCDEFGH".split("").map((n, i) => newPlayer(n, 1400 + i * 20));
    const cfg = { ...DEFAULT_CONFIG, courts: 1 };
    const rng = new PyRandom(1);
    let matches: Match[] = [];
    const add = (m: Match) => (matches = [...matches, { ...m, result: "A", games_a: 6, games_b: 3 }]);
    for (let i = 0; i < 6; i++) add(pairingToMatch(new GoodDayEngine(players, matches, { config: cfg, rng }).generateCandidates(false, false)[0].match));
    const all = [...players, newPlayer("Z")];
    const at = matches.length;
    let z = 0;
    for (let i = 0; i < 6; i++) {
      const plays = countPlays(all, matches);
      if (late) plays.set("Z", plays.get("Z")! + 3); // ほかの人は 3 回ずつ出ている
      const m = pairingToMatch(new GoodDayEngine(all, matches, { config: cfg, rng, plays, joined: late ? new Map([["Z", at]]) : undefined }).generateCandidates(false, false)[0].match);
      if ([...m.team_a, ...m.team_b].includes("Z")) z++;
      add(m);
    }
    return z;
  }

  it("何もしないと続けて入るが、仮の試合数を入れるとほかの人並みになる", () => {
    expect(lateRun(false)).toBeGreaterThanOrEqual(5);
    // 6 試合 × 4 人 ÷ 9 人 ≒ 2.7 回
    expect(lateRun(true)).toBeLessThanOrEqual(3);
  });

  it("記録・取り消し、名前の変更と削除についていく", () => {
    let p = newProject("x", { members: ["A", "B"], matches: [done(["A", "B"], ["C", "D"])] });
    p = setLate(p, "A", 2);
    expect(p.late.A).toEqual({ plays: 2, at: 1 });
    p = setLate({ ...p, matches: [...p.matches, done(["A", "B"], ["C", "D"])] }, "A", 3);
    expect(p.late.A).toEqual({ plays: 3, at: 1 }); // 来た時点は動かさない
    expect(lateMaps(p).offsets.get("A")).toBe(3);
    const s: AppState = { ...emptyState(), db: [newPlayer("A"), newPlayer("B")], projects: [p], current: p.id };
    expect(renamePlayer(s, "A", "A2").projects[0].late).toEqual({ A2: { plays: 3, at: 1 } });
    expect(deletePlayers(s, ["A"]).projects[0].late).toEqual({});
    expect(setLate(p, "A", null).late).toEqual({});
  });
});

describe("全プロジェクトでのレート計算", () => {
  function fixture(): AppState {
    const db = ["A", "B", "C", "D"].map((n) => newPlayer(n));
    // 日付の新しいプロジェクトを先に置く（計算は日付の古い順）
    const p2 = newProject("秋", { date: "2026-10-01", config: { ...DEFAULT_CONFIG, elo_k_factor: 40 }, matches: [done(["A", "B"], ["C", "D"], "B")] });
    const p1 = newProject("春", { date: "2026-04-01", config: { ...DEFAULT_CONFIG, elo_k_factor: 20 }, matches: [done(["A", "B"], ["C", "D"])] });
    return { ...emptyState(), db, projects: [p2, p1], current: p2.id };
  }

  it("日付の古い順に、プロジェクトごとの K で当てる", () => {
    const s = recalcGlobal(fixture());
    // 春（K=20）で A・B が +10、秋（K=40）で C・D が勝つ。A・B の期待勝率は 1510 対 1490 なので 0.5 より少し上
    const a = s.db.find((p) => p.name === "A")!.rating;
    expect(a).toBeGreaterThan(1500 + 10 - 40);
    expect(a).toBeLessThan(1500 + 10 - 20);
    expect(s.db.find((p) => p.name === "C")!.rating).toBeCloseTo(3000 - a, 5);
  });

  it("元に戻すと計算前のレート（と p）に戻る", () => {
    const s0 = fixture();
    s0.db[0].rating = 1234;
    const s1 = withRatingUndo(s0, "テスト", (s) => recalcGlobal({ ...s, projects: s.projects.map((p) => (p.id === s.current ? { ...p, config: { ...p.config, pair_weak_weight: 0.6 } } : p)) }), s0.projects[0]);
    expect(s1.rating_undo?.ratings.A).toBe(1234);
    const s2 = undoRatings(s1);
    expect(s2.db[0].rating).toBe(1234);
    expect(s2.projects[0].config.pair_weak_weight).toBe(DEFAULT_CONFIG.pair_weak_weight);
    expect(s2.rating_undo).toBeNull();
  });
});

describe("K の既定値", () => {
  it("新しいプロジェクトは 20", () => {
    expect(newProject("x").config.elo_k_factor).toBe(20);
  });

  it("古い保存データの K=48 は一度だけ 20 にし、ほかの値と移行後の 48 はそのまま", () => {
    const p48 = newProject("a", { config: { ...DEFAULT_CONFIG, elo_k_factor: 48 } });
    const p32 = newProject("b", { config: { ...DEFAULT_CONFIG, elo_k_factor: 32 } });
    const old = JSON.parse(JSON.stringify({ db: [], projects: [p48, p32], current: p48.id }));
    const s = stateFromJson(old);
    expect(s.projects.map((p) => p.config.elo_k_factor)).toEqual([20, 32]);
    expect(s.schema).toBe(2);
    const again = stateFromJson(JSON.parse(JSON.stringify({ ...s, projects: [p48] })));
    expect(again.projects[0].config.elo_k_factor).toBe(48);
  });
});

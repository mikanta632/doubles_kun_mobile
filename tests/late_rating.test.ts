/**
 * 遅れて来た人の扱い・レートを 1 つの固定値にまとめる移行と取り消し・K の既定値の移行。
 */
import { describe, expect, it } from "vitest";
import { DEFAULT_CONFIG } from "../src/core/config";
import { DayLedger, GoodDayEngine, countPlays } from "../src/core/dayEngine";
import { newMatch, newPlayer, pairingToMatch, type Match } from "../src/core/models";
import { PyRandom } from "../src/core/rng";
import { emptyState, lateMaps, newProject, renamePlayer, deletePlayers, setLate, stateFromJson, undoRatings, updateCurrent, withRatingUndo, type AppState } from "../src/store";

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

describe("レートは 1 つの固定値", () => {
  it("古い保存データの初期レートと更新後レートは、更新後（一覧に出ていた値）にまとめ、初期レートは控えに残す", () => {
    const a = { ...newPlayer("A", 1500), rating: 1532.5 };
    const b = newPlayer("B", 1450);
    const p = newProject("x", { members: ["A", "B"], config: { ...DEFAULT_CONFIG, elo_auto_update: true } });
    const s = stateFromJson(JSON.parse(JSON.stringify({ db: [a, b], projects: [p], current: p.id, schema: 2 })));
    expect(s.db.map((x) => [x.rating, x.initial_rating])).toEqual([[1532.5, 1532.5], [1450, 1450]]);
    expect(s.projects[0].config.elo_auto_update).toBe(false);
    expect(s.rating_undo?.ratings).toEqual({ A: 1500 });
    // 元に戻すと初期レートの方にそろう
    const back = undoRatings(s);
    expect(back.db.map((x) => [x.rating, x.initial_rating])).toEqual([[1500, 1500], [1450, 1450]]);
    // 移行済みのデータを読み直しても、控えは作り直さない
    expect(stateFromJson(JSON.parse(JSON.stringify({ ...s, rating_undo: null }))).rating_undo).toBeNull();
  });

  it("p の推定を元に戻すと、p とレートが控えに戻る", () => {
    const p = newProject("x");
    const s0: AppState = { ...emptyState(), db: [newPlayer("A", 1234)], projects: [p], current: p.id };
    const s1 = withRatingUndo(s0, "p の推定", (s) => updateCurrent(s, (q) => ({ ...q, config: { ...q.config, pair_weak_weight: 0.6 } })), p);
    expect(s1.projects[0].config.pair_weak_weight).toBe(0.6);
    const s2 = undoRatings(s1);
    expect(s2.projects[0].config.pair_weak_weight).toBe(DEFAULT_CONFIG.pair_weak_weight);
    expect(s2.db[0].rating).toBe(1234);
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
    expect(s.schema).toBe(3);
    const again = stateFromJson(JSON.parse(JSON.stringify({ ...s, projects: [p48] })));
    expect(again.projects[0].config.elo_k_factor).toBe(48);
  });
});

describe("元に戻すの控え", () => {
  it("読み込みでレートを上書きした人は控えから外し、ほかの人の分は残す", async () => {
    const { mergePlayerPatches, mergePlayers } = await import("../src/store");
    const s0: AppState = { ...emptyState(), db: [newPlayer("A"), newPlayer("B")], rating_undo: { at: "", label: "x", ratings: { A: 1400, B: 1450 } } };
    expect(mergePlayerPatches(s0, [{ name: "A", rating: 1600 }]).rating_undo?.ratings).toEqual({ B: 1450 });
    expect(mergePlayerPatches(s0, [{ name: "A", team: "総務" }]).rating_undo?.ratings).toEqual({ A: 1400, B: 1450 });
    expect(mergePlayers(s0, [newPlayer("A", 1600), newPlayer("B", 1600)]).rating_undo).toBeNull();
  });
});

describe("試合の削除", () => {
  it("選んだ試合を消し、遅れて来た人の来た時点は前の試合を消した分だけ詰める", async () => {
    const { deleteMatches } = await import("../src/store");
    const ms = Array.from({ length: 5 }, () => done(["A", "B"], ["C", "D"]));
    const p = { ...newProject("x", { members: ["Z", "Y"], matches: ms }), late: { Z: { plays: 2, at: 3 }, Y: { plays: 1, at: 1 } } };
    const q = deleteMatches(p, [ms[0].id, ms[4].id]);
    expect(q.matches.map((m) => m.id)).toEqual([ms[1].id, ms[2].id, ms[3].id]);
    expect(q.late).toEqual({ Z: { plays: 2, at: 2 }, Y: { plays: 1, at: 0 } });
  });
});

describe("プロジェクトのメンバー", () => {
  it("並びを保って足し、足した人は組み合わせに入れる（休会中は除く）。外した人は遅れて来たの記録も消す。試合に出た人は外さない", async () => {
    const { setRoster } = await import("../src/store");
    const p0 = { ...newProject("x", { members: ["A", "B", "C"], selected: ["A", "C"], matches: [done(["A", "X"], ["Y", "Z"])] }), late: { C: { plays: 1, at: 0 } } };
    const p = setRoster(p0, ["C", "D", "E"], new Set(["A", "B", "C", "D"]));
    expect(p.members).toEqual(["A", "C", "D", "E"]); // A は試合に出ているので残る
    expect(p.selected).toEqual(["A", "C", "D"]); // E は休会中なので入れない
    expect(setRoster(p0, ["A", "B"], new Set(["A", "B", "C"])).late).toEqual({});
  });
});

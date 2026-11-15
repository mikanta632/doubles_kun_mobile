/**
 * 「次の試合を組む」の候補（試合中の人を外す）と、連続ラウンドの回避。
 */
import { describe, expect, it } from "vitest";
import { GoodDayEngine, countPlays, notesOf } from "../src/core/dayEngine";
import { DEFAULT_CONFIG } from "../src/core/config";
import { PyRandom } from "../src/core/rng";
import { newMatch, newPlayer, type Match, type Player } from "../src/core/models";
import { newProject, proposalPool, restRounds, type Project } from "../src/store";

const people = (n: number): Player[] => Array.from({ length: n }, (_, i) => newPlayer(String.fromCharCode(65 + i), 1500));
const m = (names: string, state: "queued" | "play" | "done" = "queued"): Match => {
  const x = newMatch([names[0], names[1]], [names[2], names[3]]);
  if (state === "play") x.in_play = true;
  if (state === "done") Object.assign(x, { games_a: 6, games_b: 4, result: "A" });
  return x;
};
const project = (matches: Match[], courts: number): Project => newProject("t", { matches, config: { ...DEFAULT_CONFIG, courts } });
const names = (ps: Player[]) => ps.map((p) => p.name).join("");

describe("proposalPool", () => {
  it("2 面とも試合中で待機が空なら、試合中の 8 人は候補に入らない", () => {
    const pool = proposalPool(project([m("ABCD", "play"), m("EFGH", "play")], 2), people(10), 2);
    expect(names(pool.players)).toBe("IJ");
    expect(pool.playing).toHaveLength(8);
  });

  it("1 面で試合中なら、その 4 人は次の試合の候補に入らない", () => {
    const pool = proposalPool(project([m("ABCD", "play")], 1), people(8), 1);
    expect(names(pool.players)).toBe("EFGH");
  });

  it("待機が面数ぶん以上あり、試合中の試合が 2 ラウンド以上前なら、その人は候補に残す", () => {
    // 1 面: ABCD 試合中(R1)・EFGH 待機(R2)。次は R3 なので ABCD はそれまでに終わっている
    const pool = proposalPool(project([m("ABCD", "play"), m("EFGH")], 1), people(8), 1);
    expect(names(pool.players)).toBe("ABCDEFGH");
    expect(pool.playing).toHaveLength(0);
  });

  it("待機が面数より少なければ、古いラウンドの試合中の人も外す（空いた面にすぐ入るため）", () => {
    // 2 面: #1 が長引いて試合中のまま、#2〜#4 は終了。次の #5 は空いた面にすぐ入る
    const pool = proposalPool(project([m("ABCD", "play"), m("EFGH", "done"), m("IJKL", "done"), m("EFIJ", "done")], 2), people(12), 2);
    expect(pool.players.map((p) => p.name)).not.toContain("A");
    expect(pool.playing).toEqual(["A", "B", "C", "D"]);
  });

  it("同じラウンドの待機に入っている人は外す", () => {
    const pool = proposalPool(project([m("ABCD")], 2), people(10), 2);
    expect(names(pool.players)).toBe("EFGHIJ");
  });

  it("ラウンドの切れ目では、前のラウンドの待機の人も候補に残す（連続はエンジンがなるべく避ける）", () => {
    const pool = proposalPool(project([m("ABCD", "done"), m("EFGH")], 2), people(10), 2);
    expect(names(pool.players)).toBe("ABCDEFGHIJ");
  });

  it("同じラウンドの終わった試合の人は外すが、4 人に足りなければ戻す", () => {
    expect(names(proposalPool(project([m("ABCD", "done")], 2), people(10), 2).players)).toBe("EFGHIJ");
    expect(names(proposalPool(project([m("ABCD", "done")], 2), people(6), 2).players)).toBe("ABCDEF");
  });
});

describe("連続ラウンドの回避", () => {
  const propose = (players: Player[], matches: Match[], courts: number, avoid: boolean, attending?: Player[]) =>
    new GoodDayEngine(players, matches, {
      config: { ...DEFAULT_CONFIG, courts },
      courts,
      allPlayers: players,
      rng: new PyRandom(1),
      plays: countPlays(players, matches),
      attending,
      avoidConsecutive: avoid,
    });

  it("無効なら consecutive はいつも 0（デスクトップ版と同じ順位）", () => {
    const e = propose(people(9), [m("ABCD", "done")], 1, false);
    expect(e.generateCandidates().every((c) => c.consecutive === 0 && c.restKey === null)).toBe(true);
  });

  it("8 人 1 面でも、休んだ 4 人どうしに固まらない（いろいろな人と同席する）", () => {
    const ps = people(8);
    const matches: Match[] = [];
    for (let i = 0; i < 10; i++) {
      const best = propose(ps, matches, 1, true).generateCandidates()[0];
      const [[a1, a2], [b1, b2]] = best.match;
      matches.push(m(a1.name + a2.name + b1.name + b2.name, "done"));
    }
    const met = new Map(ps.map((p) => [p.name, new Set<string>()]));
    for (const x of matches) for (const a of [...x.team_a, ...x.team_b]) for (const b of [...x.team_a, ...x.team_b]) if (a !== b) met.get(a)!.add(b);
    expect(Math.min(...[...met.values()].map((s) => s.size))).toBeGreaterThanOrEqual(5);
  });

  it("有効なら、前のラウンドに出た人をなるべく入れない（待機の試合も出たものとして数える）", () => {
    const ps = people(9);
    // 1 面: ABCD 終了・EFGH 待機。次は EFGH の直後なので、EFGH 以外の 5 人から 4 人
    const e = propose(ps, [m("ABCD", "done"), m("EFGH")], 1, true);
    const best = e.generateCandidates()[0];
    expect(best.consecutive).toBe(0);
    expect([...best.four].some((n) => "EFGH".includes(n))).toBe(false);
  });

  it("避けられない人数の「続けて出る人」は気になる点に出さない", () => {
    // 10 人 2 面: R1 の 8 人のうち、次のラウンドでは少なくとも 2 人が続けて出る
    const e = propose(people(10), [m("ABCD", "done"), m("EFGH", "done")], 2, true);
    const cands = e.generateCandidates();
    const min = Math.min(...e.lastCandidates.map((c) => c.consecutive));
    expect(min).toBe(2);
    expect(notesOf(cands[0], min)).not.toContain("続けて出る人 2 人");
    const worse = e.lastCandidates.find((c) => c.consecutive === 4)!;
    expect(notesOf(worse, min)).toContain("続けて出る人 4 人");
  });

  it("出番待ちの連続待ち（restRounds）はエンジンの waitedRounds と同じ", () => {
    const ps = people(10);
    const past = [m("ABCD", "done"), m("EFGH", "done"), m("ABEF", "done"), m("CDIJ", "play"), m("ABGH")];
    const e = propose(ps, past, 2, true);
    for (const p of ps) expect(restRounds(past, p.name, past.length, 2), p.name).toBe(e.ledger.waitedRounds(p.name));
    // 待機の試合（#5, R3）に入っている人は、その試合までの休み
    expect(restRounds(past, "G", 4, 2)).toBe(1);
  });

  it("attending を渡すと、候補から外した人も出席者として数える（連続待ちの上限が縮まない）", () => {
    const all = people(10);
    const cands = all.slice(4);
    const past = [m("ABCD")];
    expect(propose(cands, past, 2, true).waitCap()).toBe(1);
    expect(propose(cands, past, 2, true, all).waitCap()).toBe(4);
  });
});

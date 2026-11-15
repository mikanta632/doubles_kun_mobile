/**
 * 正解データ（tests/golden/day_engine.json）の提案を、いまのエンジンで作り直す。
 * 組み合わせの決め方を意図して変えたときに使う（npm run golden）。差分を見て、変化が意図どおりか確かめてからコミットする。
 *
 * 再生のしかたは tests/golden.test.ts と同じ。各ステップで提案を出したあと、記録済みの試合（matches）を足して次へ進む。
 * ほかの正解データ（乱数・勝率・一括計画・Elo・指標・推定）はもとはデスクトップ版が書き出したもので、固定のまま使う。
 */
import { readFileSync, writeFileSync } from "node:fs";
import { configFromJson } from "../src/core/config";
import { GoodDayEngine, countPlays } from "../src/core/dayEngine";
import type { Match, MatchPairing, Player } from "../src/core/models";
import { PyRandom } from "../src/core/rng";

const path = new URL("../tests/golden/day_engine.json", import.meta.url);
const days = JSON.parse(readFileSync(path, "utf-8")) as any[];
const names = (p: MatchPairing) => [[p[0][0].name, p[0][1].name], [p[1][0].name, p[1][1].name]];

let changed = 0;
for (const sc of days) {
  const cfg = configFromJson(sc.config);
  const players: Player[] = sc.players;
  const rng = new PyRandom(sc.seed);
  const matches: Match[] = [];
  sc.steps.forEach((step: any, i: number) => {
    for (let j = 0; j < matches.length; j++) matches[j] = { ...matches[j], in_play: sc.busy_last && j === matches.length - 1 };
    const busy = new Set(matches.filter((m) => m.in_play).flatMap((m) => [...m.team_a, ...m.team_b]));
    const candidates = players.filter((p) => !busy.has(p.name));
    const inPlay = matches.filter((m) => m.in_play).length;
    const engine = new GoodDayEngine(candidates, matches, {
      config: cfg,
      courts: cfg.courts,
      freeCourts: Math.max(1, cfg.courts - inPlay),
      allPlayers: players,
      rng,
      plays: countPlays(candidates, matches),
    });
    const props = engine.generateMatches(sc.rating_match, sc.avoid_same_team);
    const next = { ...step, proposals: props.slice(0, 6).map(names), explain: props.length ? engine.explain(props[0]) : "" };
    if (props.length) Object.assign(next, { wait_cap: engine.waitCap(), dyad_cap: engine.dyadCap() });
    if (JSON.stringify(next) !== JSON.stringify(step)) changed++;
    sc.steps[i] = next;
    matches.push(sc.matches[i]);
  });
}
writeFileSync(path, JSON.stringify(days, null, 1) + "\n", "utf-8");
console.log(`day_engine.json: ${changed} ステップを更新しました`);

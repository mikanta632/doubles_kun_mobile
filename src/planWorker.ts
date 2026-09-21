/** 一括計画を別スレッドで走らせる（数十秒かかるので画面を止めない）。 */

import type { EngineConfig } from "./core/config";
import type { Match, Player } from "./core/models";
import { optimizePlan } from "./core/planOptimizer";

export interface PlanRequest {
  players: Player[];
  past: Match[];
  nMatches: number;
  config: EngineConfig;
}

export type PlanMessage =
  | { type: "progress"; done: number; total: number }
  | { type: "done"; result: null | { matches: string[][][]; plays_spread: number; dyad_max: number; dyad_over: number; pair_repeats: number; out_of_band: number; max_wait: number; conflicts: number; courts: number } };

self.onmessage = (ev: MessageEvent<PlanRequest>) => {
  const { players, past, nMatches, config } = ev.data;
  let last = 0;
  const r = optimizePlan(players, past, nMatches, {
    config,
    progress: (done, total) => {
      const now = Date.now();
      if (now - last > 100 || done === total) {
        last = now;
        (self as unknown as Worker).postMessage({ type: "progress", done, total } satisfies PlanMessage);
      }
    },
  });
  const result =
    r === null
      ? null
      : {
          ...r,
          matches: r.matches.map((p) => [[p[0][0].name, p[0][1].name], [p[1][0].name, p[1][1].name]]),
        };
  (self as unknown as Worker).postMessage({ type: "done", result } satisfies PlanMessage);
};

/** エンジン設定。デスクトップ版の engine_config と同じキー。 */

export interface EngineConfig {
  elo_k_factor: number;
  elo_auto_update: boolean;
  game_scale: number;
  pair_weak_weight: number;
  courts: number;
  day_win_prob_min: number;
  day_play_slack: number;
  day_wait_cap: number;
  day_wait_slack: number;
  day_recency_decay: number;
  day_recent_rounds: number;
  day_dyad_slack: number;
}

export const DEFAULT_CONFIG: EngineConfig = {
  elo_k_factor: 48,
  elo_auto_update: false,
  game_scale: 500,
  pair_weak_weight: 0.5,
  courts: 1,
  day_win_prob_min: 0.35,
  day_play_slack: 1,
  day_wait_cap: 0,
  day_wait_slack: 2,
  day_recency_decay: 0.5,
  day_recent_rounds: 3,
  day_dyad_slack: 2,
};

/** 辞書から作る。知らないキー（旧方式の重みなど）は捨てる。 */
export function configFromJson(d: Record<string, unknown> | null | undefined): EngineConfig {
  const out: EngineConfig = { ...DEFAULT_CONFIG };
  if (!d) return out;
  if ("elo_enabled" in d && !("elo_auto_update" in d)) out.elo_auto_update = Boolean(d.elo_enabled);
  for (const key of Object.keys(DEFAULT_CONFIG) as (keyof EngineConfig)[]) {
    if (!(key in d)) continue;
    const v = d[key];
    if (key === "elo_auto_update") out[key] = Boolean(v);
    else if (typeof v === "number" && Number.isFinite(v)) (out as unknown as Record<string, unknown>)[key] = v;
  }
  out.courts = Math.max(1, Math.min(3, Math.trunc(out.courts)));
  return out;
}

export interface MatchSettings {
  rating_match: boolean;
  avoid_same_team: boolean;
}

export const DEFAULT_MATCH_SETTINGS: MatchSettings = { rating_match: true, avoid_same_team: false };

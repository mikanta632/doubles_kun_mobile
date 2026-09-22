/**
 * 「良い一日」を目指すマッチングエンジン（デスクトップ版 day_engine.py の移植）。
 *
 * 参加者一人ひとりについて「出場回数が公平」「長く待たない」「大差の試合がない」
 * 「いろいろな人と組み・当たる」「同じ人と続けて同席しない」を満たすことを目標にする。
 *
 * 1. 台帳 (DayLedger): 人ごと・2 人組ごとの履歴
 * 2. フィルタ: 公平性・接戦・保護をしきい値で判定。全滅したら決まった順に緩める
 * 3. スコア: 通った候補を多様性だけで採点する
 * 4. 同点処理: 期待勝率が 50% に近いもの、次に乱数
 *
 * 計算順・乱数の消費順は Python 版と同じにしてある（正解データで一致を確認）。
 */

import type { EngineConfig } from "./config";
import { DEFAULT_CONFIG } from "./config";
import type { Match, MatchPairing, Player } from "./models";
import { PyRandom } from "./rng";
import { expectedWin, pairStrength } from "./winModel";

export const PARTNER = "partner";
export const OPPONENT = "opponent";
type Relation = typeof PARTNER | typeof OPPONENT;

export const FILTER_LABELS: Record<string, string> = {
  band_strict: "接戦の幅",
  slack1: "出場回数の余裕",
  dyad_cap: "同席回数の上限",
  band_wide: "接戦の幅（広め）",
  slack2: "出場回数の余裕（＋1）",
  must_include: "連続待ちの上限",
};

export const RELAXATION_LADDER: string[][] = [
  [],
  ["band_strict"],
  ["band_strict", "slack1"],
  ["band_strict", "slack1", "dyad_cap"],
  ["band_strict", "slack1", "dyad_cap", "band_wide"],
  ["band_strict", "slack1", "dyad_cap", "band_wide", "slack2"],
  ["band_strict", "slack1", "dyad_cap", "band_wide", "slack2", "must_include"],
];
export const HEAVY_RELAX_LEVEL = 4;

export function pairKey(a: string, b: string): string {
  return a <= b ? `${a}\u0000${b}` : `${b}\u0000${a}`;
}

/** 組み合わせ（2 ペア）を、ペアの順・ペア内の順によらないキーにする。 */
export function matchKey(teamA: readonly string[], teamB: readonly string[]): string {
  const ka = pairKey(teamA[0], teamA[1]);
  const kb = pairKey(teamB[0], teamB[1]);
  return ka <= kb ? `${ka}\u0001${kb}` : `${kb}\u0001${ka}`;
}

/**
 * 比較に使う実数を 1e-9 刻みに丸める。
 * 10**x や log1p は環境（libm、V8 の版）で最後の 1 ビットが変わることがある。
 * 順位付けや受理判定は「等しいか」で分岐するので、そのままだと環境ごとに結果が変わりうる。
 * floor(x·1e9 + 0.5)/1e9 は IEEE の基本演算だけなので Python 版とも同じ値になる。
 */
export function quantize(x: number): number {
  return Math.floor(x * 1e9 + 0.5) / 1e9;
}

export function waitCapFor(config: EngineConfig, nPlayers: number, courts: number): number {
  if (config.day_wait_cap > 0) return config.day_wait_cap;
  const perRound = 4 * Math.max(1, courts);
  if (nPlayers <= perRound) return 1;
  return Math.ceil(nPlayers / perRound) + config.day_wait_slack;
}

export function bandCutoffs(ratings: number[], nBands = 3): number[] {
  const xs = [...ratings].sort((a, b) => a - b);
  const n = xs.length;
  if (n === 0) return [];
  const out: number[] = [];
  for (let i = 1; i < nBands; i++) out.push(xs[Math.min(n - 1, Math.floor((n * i) / nBands))]);
  return out;
}

export function bandOf(rating: number, cutoffs: number[]): number {
  let b = 0;
  for (const c of cutoffs) if (rating >= c) b++;
  return b;
}

export class DayLedger {
  courts: number;
  turn: number;
  round: number;
  lastPlayedRound = new Map<string, number>();
  dyadLast = new Map<string, [number, Relation]>();
  dyadCount = new Map<string, number>();
  partnerCount = new Map<string, number>();
  /** 全く同じ組み合わせ（同じ 2 ペア）の回数 */
  matchCount = new Map<string, number>();
  contacts = new Map<string, Set<string>>();

  constructor(pastMatches: readonly Match[], courts: number) {
    this.courts = Math.max(1, courts);
    this.turn = pastMatches.length;
    this.round = Math.floor(this.turn / this.courts);
    pastMatches.forEach((m, i) => {
      if (m.team_a.length !== 2 || m.team_b.length !== 2) return;
      this.record(m.team_a, m.team_b, Math.floor(i / this.courts));
    });
  }

  record(teamA: readonly string[], teamB: readonly string[], rnd: number): void {
    const names = [...teamA, ...teamB];
    for (const n of names) {
      this.lastPlayedRound.set(n, rnd);
      if (!this.contacts.has(n)) this.contacts.set(n, new Set());
    }
    for (let i = 0; i < 4; i++)
      for (let j = i + 1; j < 4; j++) {
        const k = pairKey(names[i], names[j]);
        this.dyadCount.set(k, (this.dyadCount.get(k) ?? 0) + 1);
      }
    const mk = matchKey(teamA, teamB);
    this.matchCount.set(mk, (this.matchCount.get(mk) ?? 0) + 1);
    for (const [a, b] of [teamA, teamB]) {
      const k = pairKey(a, b);
      this.dyadLast.set(k, [rnd, PARTNER]);
      this.partnerCount.set(k, (this.partnerCount.get(k) ?? 0) + 1);
      this.contacts.get(a)!.add(b);
      this.contacts.get(b)!.add(a);
    }
    for (const a of teamA)
      for (const b of teamB) {
        this.dyadLast.set(pairKey(a, b), [rnd, OPPONENT]);
        this.contacts.get(a)!.add(b);
        this.contacts.get(b)!.add(a);
      }
  }

  waitedRounds(name: string): number {
    const last = this.lastPlayedRound.get(name);
    if (last === undefined) return this.round;
    return Math.max(0, this.round - last - 1);
  }

  contactCount(name: string): number {
    return this.contacts.get(name)?.size ?? 0;
  }
}

export interface DayCandidate {
  match: MatchPairing;
  four: Set<string>;
  winProbA: number;
  failed: Set<string>;
  components: { recency: number; repeat: number; novelty: number; mixing: number };
  total: number;
  tie: number;
  rand: number;
  newContacts: number;
  bands: number;
  imbalance: number;
  recent: number;
  repeatMax: number;
  repeatExcess: number;
  pairRepeat: number;
  /** 全く同じ組み合わせ（同じ 2 ペア）が過去にあった回数 */
  exactRepeat: number;
  /** 同じ所属どうしのペアの数（0〜2） */
  sameTeam: number;
  level: number;
  planScore: number | null;
}

/** 優先順位の上位キー。全く同じ組み合わせの再現を最初に見る（他に候補がある限り選ばない） */
export function tier(c: DayCandidate): number[] {
  const heavy = c.level >= HEAVY_RELAX_LEVEL ? 1 : 0;
  return [c.exactRepeat, c.repeatMax, c.repeatExcess, heavy, c.pairRepeat, c.imbalance, c.recent, c.level];
}

function sortKey(c: DayCandidate): number[] {
  return [...tier(c), c.total, c.tie, c.rand];
}

function cmpKeys(a: number[], b: number[]): number {
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    if (a[i] < b[i]) return -1;
    if (a[i] > b[i]) return 1;
  }
  return a.length - b.length;
}

function relaxed(c: DayCandidate): string[] {
  return RELAXATION_LADDER[c.level].filter((f) => c.failed.has(f));
}

function combinations<T>(xs: readonly T[], k: number): T[][] {
  const out: T[][] = [];
  const n = xs.length;
  if (k > n) return out;
  const idx = Array.from({ length: k }, (_, i) => i);
  for (;;) {
    out.push(idx.map((i) => xs[i]));
    let i = k - 1;
    while (i >= 0 && idx[i] === i + n - k) i--;
    if (i < 0) break;
    idx[i]++;
    for (let j = i + 1; j < k; j++) idx[j] = idx[j - 1] + 1;
  }
  return out;
}

export interface EngineOptions {
  config?: EngineConfig;
  courts?: number;
  freeCourts?: number;
  allPlayers?: readonly Player[];
  rng?: PyRandom;
  /** 出場回数（省略時は past_matches から数える） */
  plays?: Map<string, number>;
}

export class GoodDayEngine {
  static LOOKAHEAD_BEAM = 6;
  static MAX_POOL = 20;
  static PLAN_POOL = 12;
  static DIVERSITY_OUTPUT = 40;
  static LEVEL_PLAN_PENALTY = 10;
  static NO_PLAN_PENALTY = 50;
  static W_RECENCY = 3;
  static W_REPEAT = 2;
  static W_NOVELTY = 3;
  static W_MIXING = 1;

  players: Player[];
  pastMatches: Match[];
  config: EngineConfig;
  courts: number;
  freeCourts: number;
  rng: PyRandom;
  ratingOf = new Map<string, number>();
  plays: Map<string, number>;
  ledger: DayLedger;
  cutoffs: number[];
  lastCandidates: DayCandidate[] = [];

  constructor(players: readonly Player[], pastMatches: readonly Match[] = [], opts: EngineOptions = {}) {
    this.players = [...players];
    this.pastMatches = [...pastMatches];
    this.config = opts.config ?? DEFAULT_CONFIG;
    this.courts = Math.max(1, opts.courts ?? this.config.courts);
    this.freeCourts = Math.max(1, Math.min(opts.freeCourts ?? 1, this.courts));
    this.rng = opts.rng ?? new PyRandom();
    for (const p of opts.allPlayers ?? []) this.ratingOf.set(p.name, p.rating);
    for (const p of this.players) this.ratingOf.set(p.name, p.rating);
    this.plays = opts.plays ?? countPlays(this.players, this.pastMatches);
    this.ledger = new DayLedger(this.pastMatches, this.courts);
    this.cutoffs = bandCutoffs(this.players.map((p) => p.rating));
  }

  dyadCap(nPlayers = this.players.length): number {
    const total = (nPlayers * (nPlayers - 1)) / 2;
    if (total <= 0) return 99;
    const expected = (6 * this.ledger.turn) / total;
    return Math.max(2, Math.trunc(expected) + this.config.day_dyad_slack);
  }

  waitCap(nPlayers = this.players.length): number {
    return waitCapFor(this.config, nPlayers, this.courts);
  }

  generateMatches(ratingMatchOn = true, avoidSameTeamOn = true, allowOldPairs = true, maxMatches = 10): MatchPairing[] {
    const ranked = this.rank(ratingMatchOn, avoidSameTeamOn, allowOldPairs);
    this.lastCandidates = ranked;
    let matches = this.diversify(ranked).map((c) => c.match);
    if (maxMatches > 0) matches = matches.slice(0, maxMatches);
    return matches;
  }

  explain(pairing: MatchPairing): string {
    const [[a1, a2], [b1, b2]] = pairing;
    const four = new Set([a1.name, a2.name, b1.name, b2.name]);
    const teams = new Set([pairKey(a1.name, a2.name), pairKey(b1.name, b2.name)]);
    for (const c of this.lastCandidates) {
      if (!setEq(c.four, four)) continue;
      const [[x1, x2], [y1, y2]] = c.match;
      const t = new Set([pairKey(x1.name, x2.name), pairKey(y1.name, y2.name)]);
      if (setEq(t, teams)) return this.explainCandidate(c);
    }
    return "";
  }

  rank(ratingMatchOn: boolean, avoidSameTeamOn: boolean, allowOldPairs: boolean): DayCandidate[] {
    if (this.players.length < 4) return [];
    const cands = this.evaluateAll(this.players, ratingMatchOn, avoidSameTeamOn, allowOldPairs);
    if (cands.length === 0) return [];

    let bestTier = tier(cands[0]);
    for (const c of cands) {
      const t = tier(c);
      if (cmpKeys(t, bestTier) < 0) bestTier = t;
    }
    let first = cands.filter((c) => cmpKeys(tier(c), bestTier) === 0);
    const rest = cands.filter((c) => cmpKeys(tier(c), bestTier) !== 0);
    first = stableSortBy(first, sortKey);
    const restSorted = stableSortBy(rest, sortKey);

    if (this.freeCourts > 1 && this.players.length >= 8) {
      const beam = first.slice(0, GoodDayEngine.LOOKAHEAD_BEAM);
      for (const c of beam) {
        const remaining = this.players.filter((p) => !c.four.has(p.name));
        c.planScore = c.total + this.planRest(remaining, this.freeCourts - 1, ratingMatchOn, avoidSameTeamOn, allowOldPairs);
      }
      const sortedBeam = stableSortBy(beam, (c) => [c.planScore!, c.tie, c.rand]);
      first = [...sortedBeam, ...first.slice(GoodDayEngine.LOOKAHEAD_BEAM)];
    }
    return [...first, ...restSorted];
  }

  private planRest(players: Player[], courtsLeft: number, ratingMatchOn: boolean, avoidSameTeamOn: boolean, allowOldPairs: boolean): number {
    if (courtsLeft <= 0) return 0;
    if (players.length < 4) return 0;
    const cands = this.evaluateAll(players, ratingMatchOn, avoidSameTeamOn, allowOldPairs, GoodDayEngine.PLAN_POOL);
    if (cands.length === 0) return GoodDayEngine.NO_PLAN_PENALTY;
    let best = cands[0];
    let bestKey = sortKey(best);
    for (const c of cands) {
      const k = sortKey(c);
      if (cmpKeys(k, bestKey) < 0) {
        best = c;
        bestKey = k;
      }
    }
    let score = tier(best).reduce((a, b) => a + b, 0) * GoodDayEngine.LEVEL_PLAN_PENALTY + best.total;
    if (courtsLeft > 1) {
      const remaining = players.filter((p) => !best.four.has(p.name));
      score += this.planRest(remaining, courtsLeft - 1, ratingMatchOn, avoidSameTeamOn, allowOldPairs);
    }
    return score;
  }

  private diversify(ranked: DayCandidate[]): DayCandidate[] {
    if (ranked.length <= 1) return ranked;
    const pool = ranked.slice(0, GoodDayEngine.DIVERSITY_OUTPUT * 5);
    const tail = ranked.slice(pool.length);
    const totals = pool.map((c) => c.total);
    const penalty = Math.max(0.5, (Math.max(...totals) - Math.min(...totals)) / 3);
    const usage = new Map<string, number>();
    const result: DayCandidate[] = [];
    const remaining = [...pool];
    const n = Math.min(GoodDayEngine.DIVERSITY_OUTPUT, remaining.length);
    for (let i = 0; i < n; i++) {
      let bestIdx = 0;
      let bestKey: number[] | null = null;
      for (let j = 0; j < remaining.length; j++) {
        const c = remaining[j];
        let use = 0;
        for (const nm of c.four) use += usage.get(nm) ?? 0;
        const key = [...tier(c), c.total + penalty * use, c.tie, c.rand];
        if (bestKey === null || cmpKeys(key, bestKey) < 0) {
          bestKey = key;
          bestIdx = j;
        }
      }
      const best = remaining.splice(bestIdx, 1)[0];
      result.push(best);
      for (const nm of best.four) usage.set(nm, (usage.get(nm) ?? 0) + 1);
    }
    return [...result, ...remaining, ...tail];
  }

  private evaluateAll(players: Player[], ratingMatchOn: boolean, avoidSameTeamOn: boolean, allowOldPairs: boolean, poolLimit?: number): DayCandidate[] {
    const cfg = this.config;
    const nPlayers = players.length;
    if (nPlayers < 4) return [];
    const maxPool = poolLimit ?? GoodDayEngine.MAX_POOL;

    const playsOf = (p: Player) => this.plays.get(p.name) ?? 0;
    let minPlays = Infinity;
    for (const p of players) minPlays = Math.min(minPlays, playsOf(p));
    const slack = Math.max(0, cfg.day_play_slack);
    let pool = players.filter((p) => playsOf(p) <= minPlays + slack + 1);
    if (pool.length < 4) pool = [...players];
    if (pool.length > maxPool) {
      // 出場が少ない順、次に長く待っている順。同点は乱数で散らす
      // （Python の sorted と同じく、key は元の並び順に 1 回ずつ計算する）
      const keyed = pool.map((p) => ({ p, k: [playsOf(p), -this.ledger.waitedRounds(p.name), this.rng.random()] }));
      keyed.sort((x, y) => cmpKeys(x.k, y.k));
      pool = keyed.slice(0, maxPool).map((x) => x.p);
    }

    const cap = this.waitCap(nPlayers);
    const waiting = players
      .filter((p) => this.ledger.waitedRounds(p.name) >= cap)
      .map((p) => ({ p, k: -this.ledger.waitedRounds(p.name) }));
    waiting.sort((x, y) => x.k - y.k);
    const must = waiting.slice(0, 4).map((x) => x.p);
    for (const p of must) if (!pool.includes(p)) pool.push(p);

    const playsAll = players.map(playsOf);
    const fairness: [number, number, number] = [minPlays, Math.max(...playsAll), playsAll.filter((x) => x === minPlays).length];
    let cands = this.enumerate(pool, must, ratingMatchOn, avoidSameTeamOn, allowOldPairs, fairness, slack);
    if (cands.length === 0 && must.length > 0) {
      cands = this.enumerate(pool, [], ratingMatchOn, avoidSameTeamOn, allowOldPairs, fairness, slack);
      for (const c of cands) c.failed.add("must_include");
    }
    for (const c of cands) c.level = levelOf(c.failed);
    return cands.filter((c) => c.level >= 0);
  }

  private enumerate(pool: Player[], must: Player[], ratingMatchOn: boolean, avoidSameTeamOn: boolean, allowOldPairs: boolean, fairness: [number, number, number], slack: number): DayCandidate[] {
    const mustNames = new Set(must.map((p) => p.name));
    const others = pool.filter((p) => !mustNames.has(p.name));
    const k = 4 - must.length;
    if (k < 0) return [];
    const [minPlays, maxPlays, nAtMin] = fairness;
    const decay = this.config.day_recency_decay;
    const recentRounds = Math.max(0, this.config.day_recent_rounds);
    const weakWeight = this.config.pair_weak_weight;
    const cap = this.dyadCap(this.players.length);
    const cands: DayCandidate[] = [];

    for (const combo of combinations(others, k)) {
      const group = [...must, ...combo];
      const names = group.map((p) => p.name);
      const groupPlays = names.map((nm) => this.plays.get(nm) ?? 0);

      const groupFailed = new Set<string>();
      for (const pl of groupPlays) {
        const over = pl - minPlays;
        if (over > slack + 1) {
          groupFailed.add("slack2");
          groupFailed.add("slack1");
        } else if (over > slack) groupFailed.add("slack1");
      }

      const afterMax = Math.max(maxPlays, Math.max(...groupPlays) + 1);
      const afterMin = groupPlays.filter((x) => x === minPlays).length === nAtMin ? minPlays + 1 : minPlays;
      const imbalance = Math.max(0, afterMax - afterMin - 1);

      let recency = 0;
      let repeat = 0;
      let recent = 0;
      let repeatExcess = 0;
      let repeatMax = 0;
      for (let i = 0; i < 4; i++)
        for (let j = i + 1; j < 4; j++) {
          const key = pairKey(names[i], names[j]);
          const count = this.ledger.dyadCount.get(key) ?? 0;
          repeat += Math.log1p(count);
          repeatExcess += Math.max(0, count - 1);
          repeatMax = Math.max(repeatMax, count);
          if (count + 1 > cap) groupFailed.add("dyad_cap");
          const entry = this.ledger.dyadLast.get(key);
          if (entry === undefined) continue;
          const rounds = this.ledger.round - entry[0];
          const w = entry[1] === PARTNER ? 2 : 1;
          recency += w * decay ** Math.max(0, rounds - 1);
          if (rounds <= recentRounds) recent += w;
        }
      recency /= 6;
      repeat /= 6;

      let novelty = 0;
      let newContacts = 0;
      for (let i = 0; i < 4; i++) {
        const known = this.ledger.contacts.get(names[i]);
        let fresh = 0;
        for (let j = 0; j < 4; j++) if (i !== j && !(known?.has(names[j]) ?? false)) fresh++;
        novelty += fresh / 3 / (1 + (known?.size ?? 0));
        newContacts += fresh;
      }
      novelty /= 4;
      newContacts = Math.floor(newContacts / 2);

      let bands = 0;
      if (ratingMatchOn && this.cutoffs.length > 0) {
        bands = new Set(group.map((p) => bandOf(p.rating, this.cutoffs))).size;
      }
      const mixingPen = bands ? (bands === 1 ? 1 : bands === 2 ? 0.3 : 0) : 0;

      const four = new Set(names);
      const [p0, p1, p2, p3] = group;
      const splits: [Player, Player, Player, Player][] = [
        [p0, p1, p2, p3],
        [p0, p2, p1, p3],
        [p0, p3, p1, p2],
      ];
      for (const [a1, a2, b1, b2] of splits) {
        // 同じ所属どうしのペアは捨てずに減点する（なるべく避ける）
        let sameTeam = 0;
        if (avoidSameTeamOn) {
          if (a1.team && a1.team === a2.team) sameTeam++;
          if (b1.team && b1.team === b2.team) sameTeam++;
        }
        if (!allowOldPairs) {
          const ka = this.ledger.dyadLast.get(pairKey(a1.name, a2.name));
          const kb = this.ledger.dyadLast.get(pairKey(b1.name, b2.name));
          if ((ka && ka[1] === PARTNER) || (kb && kb[1] === PARTNER)) continue;
        }
        const failed = new Set(groupFailed);
        const exactRepeat = this.ledger.matchCount.get(matchKey([a1.name, a2.name], [b1.name, b2.name])) ?? 0;
        const pairRepeat =
          (this.ledger.partnerCount.get(pairKey(a1.name, a2.name)) ?? 0) +
          (this.ledger.partnerCount.get(pairKey(b1.name, b2.name)) ?? 0);
        let winProb = 0.5;
        let tie = 0;
        if (ratingMatchOn) {
          const sa = pairStrength(a1.rating, a2.rating, weakWeight);
          const sb = pairStrength(b1.rating, b2.rating, weakWeight);
          winProb = expectedWin(sa, sb, this.config.game_scale);
          const lo = this.config.day_win_prob_min;
          if (winProb < lo || winProb > 1 - lo) failed.add("band_strict");
          const wide = Math.max(0, lo - 0.05);
          if (winProb < wide || winProb > 1 - wide) failed.add("band_wide");
          tie = quantize(Math.abs(winProb - 0.5));
        }
        const total = quantize(
          GoodDayEngine.W_RECENCY * recency +
            GoodDayEngine.W_REPEAT * repeat -
            GoodDayEngine.W_NOVELTY * novelty +
            GoodDayEngine.W_MIXING * mixingPen +
            this.config.day_same_team_weight * sameTeam,
        );
        cands.push({
          match: [[a1, a2], [b1, b2]],
          four,
          winProbA: winProb,
          failed,
          components: { recency, repeat, novelty: -novelty, mixing: mixingPen },
          total,
          tie,
          rand: this.rng.random(),
          newContacts,
          bands,
          imbalance,
          recent,
          repeatMax,
          repeatExcess,
          pairRepeat,
          exactRepeat,
          sameTeam,
          level: 0,
          planScore: null,
        });
      }
    }
    return cands;
  }

  private explainCandidate(c: DayCandidate): string {
    const parts: string[] = [];
    if (c.bands) parts.push(`勝率 ${pct(c.winProbA)}`);
    const r = relaxed(c);
    parts.push(r.length ? "緩和: " + r.map((f) => FILTER_LABELS[f] ?? f).join("・") : "緩和なし");
    parts.push(c.components.recency > 0 ? "直近に同席した組あり" : "直近の重なりなし");
    parts.push(`初対面 ${c.newContacts} 組`);
    if (c.bands) parts.push(`実力帯 ${c.bands} 種`);
    if (c.sameTeam) parts.push(`同じ所属のペア ${c.sameTeam} 組`);
    if (c.exactRepeat) parts.push(`同じ組み合わせ ${c.exactRepeat} 回目`);
    return parts.join(" ／ ");
  }
}

/** Python の f"{x:.0%}"（偶数丸め）に合わせる。 */
function pct(x: number): string {
  const v = x * 100;
  const f = Math.floor(v);
  const frac = v - f;
  let r: number;
  if (frac > 0.5) r = f + 1;
  else if (frac < 0.5) r = f;
  else r = f % 2 === 0 ? f : f + 1;
  return `${r}%`;
}

function levelOf(failed: Set<string>): number {
  for (let level = 0; level < RELAXATION_LADDER.length; level++) {
    const allowed = new Set(RELAXATION_LADDER[level]);
    let ok = true;
    for (const f of failed) if (!allowed.has(f)) ok = false;
    if (ok) return level;
  }
  return -1;
}

function setEq(a: Set<string>, b: Set<string>): boolean {
  if (a.size !== b.size) return false;
  for (const x of a) if (!b.has(x)) return false;
  return true;
}

function stableSortBy<T>(xs: readonly T[], key: (x: T) => number[]): T[] {
  const keyed = xs.map((x, i) => ({ x, i, k: key(x) }));
  keyed.sort((p, q) => cmpKeys(p.k, q.k) || p.i - q.i);
  return keyed.map((e) => e.x);
}

/** 出場回数（結果の有無を問わず、ダブルスの試合をすべて数える）。 */
export function countPlays(players: readonly Player[], matches: readonly Match[]): Map<string, number> {
  const plays = new Map<string, number>();
  for (const p of players) plays.set(p.name, 0);
  for (const m of matches) {
    if (m.team_a.length !== 2 || m.team_b.length !== 2) continue;
    for (const n of [...m.team_a, ...m.team_b]) if (plays.has(n)) plays.set(n, plays.get(n)! + 1);
  }
  return plays;
}

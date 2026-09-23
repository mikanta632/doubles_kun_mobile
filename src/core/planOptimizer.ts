/**
 * 一日分の組み合わせをまとめて作る（焼きなまし。デスクトップ版 plan_optimizer.py の移植）。
 *
 * 第1段階  ラウンドごとの「誰と誰が組むか」を最適化する（並び順は見ない）
 * 第2段階  ラウンドを並べ替えて、待ち時間と直近の再同席を直す
 *
 * ラウンドを単位にして中の顔ぶれが重ならないように動かすので、同ラウンドの重複は
 * 構造上 0 になる。乱数の消費順は Python 版と同じ。
 *
 * ラウンドは試合一覧の通し番号 ÷ コート数で区切られる（エンジン・ダッシュボードと同じ）。
 * 既存の試合数がコート数で割り切れないときは、最初のラウンドを残りの面数だけにして
 * 区切りを合わせ、そのラウンドの既存の試合に出ている人は入れない。いまコートに
 * 入っている人も、人数に余裕があれば最初のラウンドから外す。
 */

import type { EngineConfig } from "./config";
import { DEFAULT_CONFIG } from "./config";
import type { Match, MatchPairing, Player } from "./models";
import { PyRandom } from "./rng";
import { quantize } from "./dayEngine";
import { gameWinProb, pairStrength } from "./winModel";

const W_FAIR = 200;
const W_PAIR = 20;
const W_CLOSE = 20;
const W_WAIT = 30;
const W_RECENT = 4;

type Four = [string, string, string, string];
export type ProgressFn = (done: number, total: number) => void;
export type StopFn = () => boolean;

export interface PlanResult {
  matches: MatchPairing[];
  plays_spread: number;
  dyad_max: number;
  dyad_over: number;
  pair_repeats: number;
  out_of_band: number;
  max_wait: number;
  conflicts: number;
  courts: number;
}

export function planSummary(r: PlanResult): string {
  return (
    `${r.matches.length} 試合を作成しました。\n` +
    `出場回数の差 ${r.plays_spread} ／ 同席回数の最多 ${r.dyad_max} 回（3 回以上は ${r.dyad_over} 組）\n` +
    `同じペアの再現 ${r.pair_repeats} 組 ／ 接戦の幅を外れた試合 ${r.out_of_band} ／ 最長の連続待ち ${r.max_wait} ラウンド`
  );
}

/** 同じペアの再現の罰（2 回目から (回数 − 1)²） */
function excess(v: number): number {
  return v > 1 ? (v - 1) ** 2 : 0;
}

function fourOf(m: Match): Four | null {
  if (m.team_a.length !== 2 || m.team_b.length !== 2) return null;
  return [m.team_a[0], m.team_a[1], m.team_b[0], m.team_b[1]];
}

function key2(a: string, b: string): string {
  return a <= b ? `${a}\u0000${b}` : `${b}\u0000${a}`;
}

/**
 * 不変条件: 同じラウンドの中に同じ人は 1 度しか出てこない（locked を含む）。
 * 評価値の各項（同席回数の二乗和・ペア再現の罰）は count で差分更新する。
 */
class Plan {
  names: string[];
  nameset: Set<string>;
  ratings: Map<string, number>;
  cfg: EngineConfig;
  rng: PyRandom;
  n: number;
  courts: number;
  dyad = new Map<string, number>();
  pair = new Map<string, number>();
  plays = new Map<string, number>();
  /** 今いる人どうしの同席回数の二乗和 */
  dyadSq = 0;
  /** 今いる人どうしのペア再現の罰の合計 */
  pairPen = 0;
  hDyad: Map<string, number>;
  hPair: Map<string, number>;
  hPlays: Map<string, number>;
  nRounds: number;
  roundOf: number[];
  roundSlots: number[][];
  /** ラウンドごとの、計画の外で決まっている出場者（最初のラウンドだけ） */
  locked: Set<string>[];
  members: Set<string>[];
  close = 0;
  slots: string[][];

  constructor(names: string[], ratings: Map<string, number>, history: Four[], cfg: EngineConfig, rng: PyRandom, nNew: number, courts: number, firstSize?: number, locked?: Set<string>) {
    this.names = [...names];
    this.nameset = new Set(this.names);
    this.ratings = ratings;
    this.cfg = cfg;
    this.rng = rng;
    this.n = nNew;
    this.courts = courts;
    for (const x of this.names) this.plays.set(x, 0);
    for (const f of history) this.count(f, +1, true);
    this.hDyad = new Map(this.dyad);
    this.hPair = new Map(this.pair);
    this.hPlays = new Map(this.plays);

    // 最初のラウンドは既存の試合の続き（firstSize 面）、最後のラウンドは試合数が少ないことがある
    let size = Math.min(courts, firstSize || courts);
    this.roundSlots = [];
    for (let i = 0; i < nNew; ) {
      const k = Math.min(size, nNew - i);
      this.roundSlots.push(Array.from({ length: k }, (_, j) => i + j));
      i += k;
      size = courts;
    }
    this.nRounds = this.roundSlots.length;
    this.roundOf = new Array<number>(nNew).fill(0);
    this.roundSlots.forEach((idxs, r) => {
      for (const i of idxs) this.roundOf[i] = r;
    });
    this.locked = Array.from({ length: this.nRounds }, () => new Set<string>());
    if (locked && locked.size > 0 && this.nRounds > 0) this.locked[0] = new Set(locked);
    this.members = this.locked.map((lk) => new Set(lk));

    this.slots = Array.from({ length: nNew }, () => []);
    const counts = new Map(this.plays);
    this.roundSlots.forEach((idxs, r) => {
      const need = 4 * idxs.length;
      const keyed = this.names.filter((x) => !this.locked[r].has(x)).map((x) => ({ x, k: [counts.get(x) ?? 0, rng.random()] }));
      keyed.sort((a, b) => a.k[0] - b.k[0] || a.k[1] - b.k[1]);
      const picked = keyed.slice(0, need).map((e) => e.x);
      rng.shuffle(picked);
      idxs.forEach((i, k) => {
        const four = picked.slice(4 * k, 4 * k + 4);
        this.slots[i] = four;
        for (const x of four) this.members[r].add(x);
        for (const x of four) counts.set(x, (counts.get(x) ?? 0) + 1);
      });
    });
    for (const f of this.slots) {
      this.count(f as Four, +1);
      this.close += this.closeness(f);
    }
  }

  private count(f: readonly string[], sign: number, history = false): void {
    for (const x of f) {
      if (this.plays.has(x) || !history) this.plays.set(x, (this.plays.get(x) ?? 0) + sign);
    }
    for (const [a, b] of [[f[0], f[1]], [f[2], f[3]]]) {
      const k = key2(a, b);
      const v = this.pair.get(k) ?? 0;
      this.pair.set(k, v + sign);
      if (this.nameset.has(a) && this.nameset.has(b)) this.pairPen += excess(v + sign) - excess(v);
    }
    for (let i = 0; i < 4; i++)
      for (let j = i + 1; j < 4; j++) {
        const k = key2(f[i], f[j]);
        const v = this.dyad.get(k) ?? 0;
        this.dyad.set(k, v + sign);
        if (this.nameset.has(f[i]) && this.nameset.has(f[j])) this.dyadSq += (v + sign) * (v + sign) - v * v;
      }
  }

  closeness(f: readonly string[]): number {
    const lo = this.cfg.day_win_prob_min;
    const sa = pairStrength(this.ratings.get(f[0])!, this.ratings.get(f[1])!, this.cfg.pair_weak_weight);
    const sb = pairStrength(this.ratings.get(f[2])!, this.ratings.get(f[3])!, this.cfg.pair_weak_weight);
    const q = gameWinProb(sa, sb, this.cfg.game_scale);
    // 受理判定は「コストが等しいか」で分岐するので、環境差が出ないよう丸める
    if (q < lo) return quantize(lo - q);
    if (q > 1 - lo) return quantize(q - (1 - lo));
    return 0;
  }

  cost(): number {
    let mx = -Infinity;
    let mn = Infinity;
    for (const x of this.names) {
      const v = this.plays.get(x) ?? 0;
      if (v > mx) mx = v;
      if (v < mn) mn = v;
    }
    const fair = mx - mn;
    return W_FAIR * Math.max(0, fair - 1) + this.dyadSq + W_PAIR * this.pairPen + W_CLOSE * this.close;
  }

  apply(i: number, next: string[]): void {
    const old = this.slots[i];
    const r = this.roundOf[i];
    this.count(old, -1);
    this.count(next, +1);
    this.close += this.closeness(next) - this.closeness(old);
    this.slots[i] = next;
    const members = new Set<string>(this.locked[r]);
    for (const j of this.roundSlots[r]) for (const x of this.slots[j]) members.add(x);
    this.members[r] = members;
  }

  private sitters(r: number): string[] {
    const inside = this.members[r];
    return this.names.filter((x) => !inside.has(x));
  }

  propose(): [number, string[]][] {
    const rng = this.rng;
    const i = rng.randrange(this.n);
    const r = this.roundOf[i];
    const f = [...this.slots[i]];
    let mode = rng.random();

    if (mode < 0.3) {
      rng.shuffle(f);
      return [[i, f]];
    }
    if (mode < 0.55) {
      const others = this.roundSlots[r].filter((j) => j !== i);
      if (others.length > 0) {
        const j = rng.choice(others);
        const g = [...this.slots[j]];
        const a = rng.randrange(4);
        const b = rng.randrange(4);
        const t = f[a];
        f[a] = g[b];
        g[b] = t;
        return [[i, f], [j, g]];
      }
      mode = 0.9;
    }
    if (mode < 0.8) {
      const s = this.sitters(r);
      if (s.length === 0) return [];
      const v = rng.choice(s); // Python は右辺を先に評価する
      f[rng.randrange(4)] = v;
      return [[i, f]];
    }
    const j = rng.randrange(this.n);
    const r2 = this.roundOf[j];
    if (r2 === r) return [];
    const g = [...this.slots[j]];
    const a = rng.randrange(4);
    const b = rng.randrange(4);
    if (this.members[r].has(g[b]) || this.members[r2].has(f[a])) return [];
    const t = f[a];
    f[a] = g[b];
    g[b] = t;
    return [[i, f], [j, g]];
  }
}

function optimizeSet(plan: Plan, iters: number, progress: ProgressFn | undefined, stop: StopFn | undefined, base: number, total: number): void {
  let cur = plan.cost();
  for (let t = 0; t < iters; t++) {
    if (stop && (t & 1023) === 0 && stop()) return;
    if (progress && (t & 2047) === 0) progress(base + t, total);
    const mv = plan.propose();
    if (mv.length === 0) continue;
    const olds = mv.map(([i]) => [i, [...plan.slots[i]]] as [number, string[]]);
    for (const [i, f] of mv) plan.apply(i, f);
    const nxt = plan.cost();
    const temp = 3 * (1 - t / Math.max(1, iters)) + 0.01;
    if (nxt <= cur || plan.rng.random() < Math.exp((cur - nxt) / temp)) cur = nxt;
    else for (const [i, f] of olds) plan.apply(i, f);
  }
}

function orderCost(rounds: string[][][], names: string[], target: number, recentRounds: number): number {
  const played = new Map<string, number[]>();
  for (const x of names) played.set(x, []);
  const last = new Map<string, number>();
  let recent = 0;
  rounds.forEach((matches, r) => {
    for (const f of matches) {
      for (const x of f) played.get(x)?.push(r);
      for (let i = 0; i < 4; i++)
        for (let j = i + 1; j < 4; j++) {
          const k = key2(f[i], f[j]);
          const l = last.get(k);
          if (l !== undefined && r - l <= recentRounds) recent += recentRounds + 1 - (r - l);
          last.set(k, r);
        }
    }
  });
  const nRounds = rounds.length;
  let wait = 0;
  for (const rs of played.values()) {
    let prev = -1;
    for (const r of [...new Set(rs)].sort((a, b) => a - b)) {
      const gap = r - prev - 1;
      if (gap > target) wait += (gap - target) ** 2;
      prev = r;
    }
    const gap = nRounds - prev - 1;
    if (gap > target) wait += (gap - target) ** 2;
  }
  return W_WAIT * wait + W_RECENT * recent;
}

/** fixedHead: 最初のラウンドを先頭に固定する（既存の試合の続きのとき） */
function optimizeOrder(rounds: string[][][], names: string[], courts: number, recentRounds: number, rng: PyRandom, iters: number, progress: ProgressFn | undefined, stop: StopFn | undefined, base: number, total: number, fixedHead = false): string[][][] {
  const target = Math.max(1, Math.ceil(names.length / (4 * courts)));
  const head = fixedHead && rounds.length > 0 ? [rounds[0]] : [];
  const others = rounds.slice(head.length);
  // 試合数の少ない最後のラウンドは末尾に固定する
  const tail = others.length > 1 && others[others.length - 1].length < courts ? others[others.length - 1] : null;
  const body = tail !== null ? others.slice(0, -1) : [...others];
  const rest = tail !== null ? [tail] : [];
  const n = body.length;
  if (n < 2) return [...head, ...body, ...rest];
  let cur = orderCost([...head, ...body, ...rest], names, target, recentRounds);
  for (let t = 0; t < iters; t++) {
    if (stop && (t & 1023) === 0 && stop()) break;
    if (progress && (t & 2047) === 0) progress(base + t, total);
    const i = rng.randrange(n);
    const j = rng.randrange(n);
    if (i === j) continue;
    [body[i], body[j]] = [body[j], body[i]];
    const nxt = orderCost([...head, ...body, ...rest], names, target, recentRounds);
    const temp = 50 * (1 - t / Math.max(1, iters)) + 0.1;
    if (nxt <= cur || rng.random() < Math.exp((cur - nxt) / temp)) cur = nxt;
    else [body[i], body[j]] = [body[j], body[i]];
  }
  return [...head, ...body, ...rest];
}

export interface PlanOptions {
  config?: EngineConfig;
  courts?: number;
  setIters?: number;
  orderIters?: number;
  seed?: number | bigint;
  progress?: ProgressFn;
  stop?: StopFn;
}

/**
 * nMatches 試合をまとめて組む。4 人そろわない・試合数 0 なら null。
 * players にはいまコートに入っている人も含める（最初のラウンドからは外す）。
 */
export function optimizePlan(players: readonly Player[], pastMatches: readonly Match[], nMatches: number, opts: PlanOptions = {}): PlanResult | null {
  const cfg = opts.config ?? DEFAULT_CONFIG;
  let courts = Math.max(1, opts.courts ?? cfg.courts);
  const names = players.map((p) => p.name);
  if (names.length < 4 || nMatches < 1) return null;
  courts = Math.max(1, Math.min(courts, Math.floor(names.length / 4)));

  const ratings = new Map(players.map((p) => [p.name, p.rating]));
  const history: Four[] = [];
  for (const m of pastMatches) {
    const f = fourOf(m);
    if (f) history.push(f);
  }
  for (const f of history) for (const x of f) if (!ratings.has(x)) ratings.set(x, 1500);

  // 既存の試合の続き: 最後のラウンドが埋まりきっていなければ、残りの面から始める
  const offset = pastMatches.length % courts;
  const firstSize = offset ? courts - offset : courts;
  const locked = new Set<string>();
  if (offset) for (const m of pastMatches.slice(pastMatches.length - offset)) for (const x of [...m.team_a, ...m.team_b]) locked.add(x);
  // いまコートに入っている人は、人数に余裕があれば最初のラウンドから外す
  const inPlay = new Set<string>();
  for (const m of pastMatches) if (m.in_play) for (const x of [...m.team_a, ...m.team_b]) inPlay.add(x);
  const free = names.filter((x) => !locked.has(x) && !inPlay.has(x));
  if (free.length >= 4 * Math.min(firstSize, nMatches)) for (const x of inPlay) locked.add(x);

  const rng = new PyRandom(opts.seed);
  const si = opts.setIters ?? Math.max(20000, 4000 * nMatches);
  const oi = opts.orderIters ?? Math.max(10000, 1000 * nMatches);
  const total = si + oi;

  const plan = new Plan(names, ratings, history, cfg, rng, nMatches, courts, firstSize, locked);
  optimizeSet(plan, si, opts.progress, opts.stop, 0, total);
  if (opts.stop && opts.stop()) return null;

  let rounds = plan.roundSlots.map((idxs) => idxs.map((i) => [...plan.slots[i]]));
  rounds = optimizeOrder(rounds, names, courts, Math.max(0, cfg.day_recent_rounds), rng, oi, opts.progress, opts.stop, si, total, plan.locked[0].size > 0 || firstSize < courts);
  opts.progress?.(total, total);

  const seq = rounds.flat();
  const byName = new Map(players.map((p) => [p.name, p]));
  const matches: MatchPairing[] = seq.map((f) => [
    [byName.get(f[0])!, byName.get(f[1])!],
    [byName.get(f[2])!, byName.get(f[3])!],
  ]);
  return {
    matches,
    plays_spread: playsSpread(seq, names, plan.hPlays),
    dyad_max: dyadMax(seq, plan.hDyad, names),
    dyad_over: dyadOver(seq, plan.hDyad, names),
    pair_repeats: pairRepeats(seq, plan.hPair, names),
    out_of_band: seq.filter((f) => plan.closeness(f) > 0).length,
    max_wait: maxWait(rounds, names),
    conflicts: conflicts(rounds, plan.locked[0]),
    courts,
  };
}

function counts(seq: string[][], base: Map<string, number>, names: string[]): Map<string, number> {
  const c = new Map(base);
  for (const f of seq)
    for (let i = 0; i < 4; i++)
      for (let j = i + 1; j < 4; j++) {
        const k = key2(f[i], f[j]);
        c.set(k, (c.get(k) ?? 0) + 1);
      }
  const ns = new Set(names);
  const out = new Map<string, number>();
  for (const [k, v] of c) {
    const i = k.indexOf("\u0000");
    if (ns.has(k.slice(0, i)) && ns.has(k.slice(i + 1))) out.set(k, v);
  }
  return out;
}

function playsSpread(seq: string[][], names: string[], base: Map<string, number>): number {
  const c = new Map(names.map((x) => [x, base.get(x) ?? 0]));
  for (const f of seq) for (const x of f) if (c.has(x)) c.set(x, c.get(x)! + 1);
  if (c.size === 0) return 0;
  const vs = [...c.values()];
  return Math.max(...vs) - Math.min(...vs);
}

function dyadMax(seq: string[][], base: Map<string, number>, names: string[]): number {
  const c = counts(seq, base, names);
  return c.size ? Math.max(...c.values()) : 0;
}

function dyadOver(seq: string[][], base: Map<string, number>, names: string[]): number {
  let n = 0;
  for (const v of counts(seq, base, names).values()) if (v >= 3) n++;
  return n;
}

function pairRepeats(seq: string[][], base: Map<string, number>, names: string[]): number {
  const c = new Map(base);
  for (const f of seq) {
    for (const k of [key2(f[0], f[1]), key2(f[2], f[3])]) c.set(k, (c.get(k) ?? 0) + 1);
  }
  const ns = new Set(names);
  let n = 0;
  for (const [k, v] of c) {
    const i = k.indexOf("\u0000");
    if (v > 1 && ns.has(k.slice(0, i)) && ns.has(k.slice(i + 1))) n++;
  }
  return n;
}

function maxWait(rounds: string[][][], names: string[]): number {
  const played = new Map<string, number[]>(names.map((x) => [x, []]));
  rounds.forEach((matches, r) => {
    for (const f of matches) for (const x of f) played.get(x)?.push(r);
  });
  const nRounds = rounds.length;
  let worst = 0;
  for (const rs of played.values()) {
    let prev = -1;
    for (const r of [...new Set(rs)].sort((a, b) => a - b)) {
      worst = Math.max(worst, r - prev - 1);
      prev = r;
    }
    worst = Math.max(worst, nRounds - prev - 1);
  }
  return worst;
}

/** 同じラウンドに同じ人が重なった数。最初のラウンドは既存の試合の出場者も数える */
function conflicts(rounds: string[][][], lockedFirst: Set<string>): number {
  let total = 0;
  rounds.forEach((matches, r) => {
    const seen = new Map<string, number>();
    if (r === 0) for (const x of lockedFirst) seen.set(x, 1);
    for (const f of matches) for (const x of f) seen.set(x, (seen.get(x) ?? 0) + 1);
    for (const v of seen.values()) if (v > 1) total += v - 1;
  });
  return total;
}

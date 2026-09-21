/**
 * Python の random.Random と同じ乱数（MT19937 + Python 流の seed 初期化）。
 *
 * デスクトップ版（Python）と同じ seed で同じ提案・同じ計画を出すために、
 * 生成器だけでなく shuffle / choice / randrange / sample の消費順まで揃えている。
 * 正解データ（tests/golden/rng.json）で一致を確認する。
 */

const N = 624;
const M = 397;
const MATRIX_A = 0x9908b0df;
const UPPER = 0x80000000;
const LOWER = 0x7fffffff;

export class PyRandom {
  private mt = new Uint32Array(N);
  private mti = N + 1;

  constructor(seed?: number | bigint) {
    if (seed === undefined) {
      seed = BigInt(Math.floor(Math.random() * 2 ** 53)) ^ BigInt(Date.now());
    }
    this.seed(seed);
  }

  /** Python: random.seed(int) → init_by_array(abs(seed) を 32bit ずつ) */
  seed(seed: number | bigint): void {
    let n = typeof seed === "bigint" ? seed : BigInt(Math.trunc(seed));
    if (n < 0n) n = -n;
    const key: number[] = [];
    if (n === 0n) key.push(0);
    while (n > 0n) {
      key.push(Number(n & 0xffffffffn));
      n >>= 32n;
    }
    this.initByArray(key);
  }

  private initGenrand(s: number): void {
    const mt = this.mt;
    mt[0] = s >>> 0;
    for (let i = 1; i < N; i++) {
      const prev = mt[i - 1] ^ (mt[i - 1] >>> 30);
      // 1812433253 * prev + i  （32bit で切り詰め）
      mt[i] = (Math.imul(1812433253, prev) + i) >>> 0;
    }
    this.mti = N;
  }

  private initByArray(key: number[]): void {
    const mt = this.mt;
    this.initGenrand(19650218);
    let i = 1;
    let j = 0;
    const len = key.length;
    for (let k = Math.max(N, len); k > 0; k--) {
      const prev = mt[i - 1] ^ (mt[i - 1] >>> 30);
      mt[i] = ((mt[i] ^ Math.imul(prev, 1664525)) + key[j] + j) >>> 0;
      i++;
      j++;
      if (i >= N) {
        mt[0] = mt[N - 1];
        i = 1;
      }
      if (j >= len) j = 0;
    }
    for (let k = N - 1; k > 0; k--) {
      const prev = mt[i - 1] ^ (mt[i - 1] >>> 30);
      mt[i] = ((mt[i] ^ Math.imul(prev, 1566083941)) - i) >>> 0;
      i++;
      if (i >= N) {
        mt[0] = mt[N - 1];
        i = 1;
      }
    }
    mt[0] = 0x80000000;
  }

  /** genrand_int32 */
  private next32(): number {
    const mt = this.mt;
    if (this.mti >= N) {
      let kk = 0;
      for (; kk < N - M; kk++) {
        const y = (mt[kk] & UPPER) | (mt[kk + 1] & LOWER);
        mt[kk] = mt[kk + M] ^ (y >>> 1) ^ (y & 1 ? MATRIX_A : 0);
      }
      for (; kk < N - 1; kk++) {
        const y = (mt[kk] & UPPER) | (mt[kk + 1] & LOWER);
        mt[kk] = mt[kk + (M - N)] ^ (y >>> 1) ^ (y & 1 ? MATRIX_A : 0);
      }
      const y = (mt[N - 1] & UPPER) | (mt[0] & LOWER);
      mt[N - 1] = mt[M - 1] ^ (y >>> 1) ^ (y & 1 ? MATRIX_A : 0);
      this.mti = 0;
    }
    let y = mt[this.mti++];
    y ^= y >>> 11;
    y ^= (y << 7) & 0x9d2c5680;
    y ^= (y << 15) & 0xefc60000;
    y ^= y >>> 18;
    return y >>> 0;
  }

  /** random(): genrand_res53 */
  random(): number {
    const a = this.next32() >>> 5;
    const b = this.next32() >>> 6;
    return (a * 67108864 + b) / 9007199254740992;
  }

  /** getrandbits(k)、k ≤ 32 のみ */
  getrandbits(k: number): number {
    if (k <= 0) return 0;
    if (k > 32) throw new Error("getrandbits: k > 32 は未対応");
    return this.next32() >>> (32 - k);
  }

  /** _randbelow_with_getrandbits */
  randbelow(n: number): number {
    if (n <= 0) throw new Error("randbelow: n <= 0");
    const k = 32 - Math.clz32(n); // n.bit_length()
    let r = this.getrandbits(k);
    while (r >= n) r = this.getrandbits(k);
    return r;
  }

  randrange(n: number): number {
    return this.randbelow(n);
  }

  choice<T>(seq: readonly T[]): T {
    if (seq.length === 0) throw new Error("choice: 空の列");
    return seq[this.randbelow(seq.length)];
  }

  shuffle<T>(xs: T[]): void {
    for (let i = xs.length - 1; i > 0; i--) {
      const j = this.randbelow(i + 1);
      const t = xs[i];
      xs[i] = xs[j];
      xs[j] = t;
    }
  }

  /** random.sample のうち、母集団が小さいとき（pool 方式）の経路だけ */
  sample<T>(population: readonly T[], k: number): T[] {
    const n = population.length;
    if (k < 0 || k > n) throw new Error("sample: k が不正");
    let setsize = 21;
    if (k > 5) setsize += 4 ** Math.ceil(Math.log(k * 3) / Math.log(4));
    if (n > setsize) throw new Error("sample: 大きな母集団（set 方式）は未対応");
    const pool = population.slice();
    const result: T[] = new Array(k);
    for (let i = 0; i < k; i++) {
      const j = this.randbelow(n - i);
      result[i] = pool[j];
      pool[j] = pool[n - i - 1];
    }
    return result;
  }
}

/**
 * 勝率モデル。レート差から「1 ゲームを取る確率」を求める（試合の勝率ではない）。
 * 1 ゲーム基準にすると、試合形式が変わっても意味が変わらない。
 */

export const DEFAULT_GAME_SCALE = 500;
export const DEFAULT_WEAK_WEIGHT = 0.5;

export function gameWinProb(ratingA: number, ratingB: number, gameScale = DEFAULT_GAME_SCALE): number {
  const scale = Math.max(1, gameScale);
  return 1 / (1 + 10 ** ((ratingB - ratingA) / scale));
}

export const expectedWin = gameWinProb;

/** 1 ゲームの勝率が target になるレート差（設定画面の説明用）。 */
export function ratingDiffForProb(target: number, gameScale = DEFAULT_GAME_SCALE): number {
  const t = Math.min(Math.max(target, 1e-9), 1 - 1e-9);
  return Math.max(1, gameScale) * Math.log10(t / (1 - t));
}

/** ダブルスのペア強度 S = p × 弱い側 + (1 − p) × 強い側。 */
export function pairStrength(r1: number, r2: number, weakWeight = DEFAULT_WEAK_WEIGHT): number {
  const lo = r1 <= r2 ? r1 : r2;
  const hi = r1 <= r2 ? r2 : r1;
  const p = Math.min(Math.max(weakWeight, 0), 1);
  return p * lo + (1 - p) * hi;
}

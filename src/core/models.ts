/** データ型。デスクトップ版の players.json / matches.json と同じ形にする。 */

export interface Player {
  name: string;
  rating: number;
  initial_rating: number;
  team: string | null;
  active: boolean;
}

export type MatchResult = "A" | "B" | "D" | null;

export interface Match {
  id: string;
  team_a: string[];
  team_b: string[];
  games_a: number | null;
  games_b: number | null;
  result: MatchResult;
  in_play: boolean;
  created_at: number; // 秒（Python の time.time() と同じ）
  updated_at: number;
}

export type Pair = [Player, Player];
export type MatchPairing = [Pair, Pair];

export function newPlayer(name: string, rating = 1500, team: string | null = null): Player {
  return { name, rating, initial_rating: rating, team, active: true };
}

export function newMatch(team_a: string[], team_b: string[]): Match {
  const now = Date.now() / 1000;
  return {
    id: uuid(),
    team_a: [...team_a],
    team_b: [...team_b],
    games_a: null,
    games_b: null,
    result: null,
    in_play: false,
    created_at: now,
    updated_at: now,
  };
}

export function allPlayers(m: Match): string[] {
  return [...m.team_a, ...m.team_b];
}

export function isDoubles(m: Match): boolean {
  return m.team_a.length === 2 && m.team_b.length === 2;
}

export function pairingToMatch(p: MatchPairing): Match {
  const [[a1, a2], [b1, b2]] = p;
  return newMatch([a1.name, a2.name], [b1.name, b2.name]);
}

function uuid(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
  });
}

/** JSON から Player を読む（足りない項目は補う）。 */
export function playerFromJson(d: Record<string, unknown>): Player | null {
  const name = typeof d.name === "string" ? d.name.trim() : "";
  if (!name) return null;
  const rating = num(d.rating, 1500);
  const initial = num(d.initial_rating, rating);
  return {
    name,
    rating,
    initial_rating: initial,
    team: typeof d.team === "string" && d.team ? d.team : null,
    active: d.active === undefined ? true : Boolean(d.active),
  };
}

export function matchFromJson(d: Record<string, unknown>): Match | null {
  if (!Array.isArray(d.team_a) || !Array.isArray(d.team_b)) return null;
  const result = d.result === "A" || d.result === "B" || d.result === "D" ? d.result : null;
  return {
    id: typeof d.id === "string" && d.id ? d.id : uuid(),
    team_a: d.team_a.map(String),
    team_b: d.team_b.map(String),
    games_a: d.games_a === null || d.games_a === undefined ? null : num(d.games_a, 0),
    games_b: d.games_b === null || d.games_b === undefined ? null : num(d.games_b, 0),
    result,
    in_play: Boolean(d.in_play),
    created_at: num(d.created_at, 0),
    updated_at: num(d.updated_at, 0),
  };
}

function num(v: unknown, fallback: number): number {
  const x = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
  return Number.isFinite(x) ? x : fallback;
}

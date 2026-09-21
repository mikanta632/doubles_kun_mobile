import { useMemo, useState } from "preact/hooks";
import type { ViewProps } from "../app";
import { GoodDayEngine } from "../core/dayEngine";
import { recalculateAll } from "../core/elo";
import { pairingToMatch, type Match, type MatchPairing, type MatchResult } from "../core/models";
import { gameWinProb, pairStrength } from "../core/winModel";
import { availablePlayers, type AppState } from "../store";
import { Sheet } from "./Sheet";
import { Wheel, type WheelOption } from "./Wheel";

interface Proposal {
  pairings: MatchPairing[];
  explains: string[];
  index: number;
}

export function MatchesView({ state, update, notify }: ViewProps) {
  const [proposal, setProposal] = useState<Proposal | null>(null);
  const [editing, setEditing] = useState<Match | null>(null);

  const available = useMemo(() => availablePlayers(state), [state]);
  const inPlay = state.matches.filter((m) => m.in_play).length;
  const courts = Math.max(1, state.config.courts);

  const propose = () => {
    if (available.length < 4) {
      notify("出場できる人が 4 人未満です。メンバータブで参加する人を選んでください。");
      return;
    }
    const engine = new GoodDayEngine(available, state.matches, {
      config: state.config,
      courts,
      freeCourts: Math.max(1, courts - inPlay),
      allPlayers: state.players,
    });
    const pairings = engine.generateMatches(state.settings.rating_match, state.settings.avoid_same_team);
    if (pairings.length === 0) {
      notify("この条件では試合を組めませんでした。");
      setProposal(null);
      return;
    }
    setProposal({ pairings, explains: pairings.map((p) => engine.explain(p)), index: 0 });
  };

  const adopt = () => {
    if (!proposal) return;
    const m = pairingToMatch(proposal.pairings[proposal.index]);
    update((s) => ({ ...s, matches: [...s.matches, m] }));
    setProposal(null);
  };

  const current = proposal ? proposal.pairings[proposal.index] : null;
  const prob = current ? winProb(current, state) : null;

  return (
    <>
      <div class="topbar">
        <div>
          <h1>試合</h1>
          <div class="sub">
            出場できる人 {available.length} 人・コート {courts} 面{inPlay > 0 && `・進行中 ${inPlay}`}
          </div>
        </div>
        <button class="btn primary" onClick={propose} disabled={available.length < 4}>次の試合を組む</button>
      </div>

      {current && proposal && (
        <div class="card proposal">
          <div class="muted">案 {proposal.index + 1} / {proposal.pairings.length}</div>
          <div class="team">{current[0][0].name}・{current[0][1].name}</div>
          <div class="vs">vs</div>
          <div class="team">{current[1][0].name}・{current[1][1].name}</div>
          {prob !== null && state.settings.rating_match && <div class="prob">上のペアが 1 ゲームを取る確率 {Math.round(prob * 100)}%</div>}
          <div class="muted" style="margin-top:4px">{proposal.explains[proposal.index]}</div>
          <div class="row" style="margin-top:12px; justify-content:center">
            <button class="btn" onClick={() => setProposal(null)}>閉じる</button>
            <button class="btn" onClick={() => setProposal({ ...proposal, index: (proposal.index + 1) % proposal.pairings.length })} disabled={proposal.pairings.length < 2}>別の案</button>
            <button class="btn primary" onClick={adopt}>この組み合わせにする</button>
          </div>
        </div>
      )}

      {state.matches.length === 0 ? (
        <div class="empty">まだ試合がありません。「次の試合を組む」から始めます。</div>
      ) : (
        <div class="card">
          <div class="row between" style="margin-bottom:4px">
            <h2 style="margin:0">試合一覧</h2>
            <span class="muted">タップで結果を入力</span>
          </div>
          {[...state.matches].reverse().map((m, ri) => {
            const no = state.matches.length - ri;
            return (
              <div class={"match" + (m.in_play ? " inplay" : "")} key={m.id} onClick={() => setEditing(m)}>
                <div class="no">{no}<br /><span style="font-size:10px">R{Math.floor((no - 1) / courts) + 1}</span></div>
                <div class="teams">
                  <div class={m.result === "A" ? "win" : m.result === "B" ? "lose" : ""}>{m.team_a.join("・")}</div>
                  <div class={m.result === "B" ? "win" : m.result === "A" ? "lose" : ""}>{m.team_b.join("・")}</div>
                </div>
                <div class="score">
                  {m.games_a !== null && m.games_b !== null ? (
                    <>{m.games_a}<br />{m.games_b}</>
                  ) : m.in_play ? (
                    <span class="pill play">進行中</span>
                  ) : (
                    <span class="pill">未入力</span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {editing && <ResultSheet match={editing} state={state} update={update} notify={notify} onClose={() => setEditing(null)} />}
    </>
  );
}

function winProb(p: MatchPairing, s: AppState): number {
  const sa = pairStrength(p[0][0].rating, p[0][1].rating, s.config.pair_weak_weight);
  const sb = pairStrength(p[1][0].rating, p[1][1].rating, s.config.pair_weak_weight);
  return gameWinProb(sa, sb, s.config.game_scale);
}

/** ゲーム数の選択肢。先頭は「未入力」 */
const GAME_OPTIONS: WheelOption<number | null>[] = [{ value: null, label: "－" }, ...Array.from({ length: 10 }, (_, i) => ({ value: i, label: String(i) }))];

function ResultSheet({ match, state, update, onClose }: ViewProps & { match: Match; onClose: () => void }) {
  const [ga, setGa] = useState<number | null>(match.games_a);
  const [gb, setGb] = useState<number | null>(match.games_b);
  const [inPlay, setInPlay] = useState(match.in_play);
  const no = state.matches.findIndex((m) => m.id === match.id) + 1;

  const save = () => {
    const a = ga;
    const b = gb;
    const both = a !== null && b !== null;
    const result: MatchResult = both ? (a > b ? "A" : a < b ? "B" : "D") : null;
    update((s) => {
      const matches: Match[] = s.matches.map((m) =>
        m.id === match.id
          ? { ...m, games_a: both ? a : null, games_b: both ? b : null, result, in_play: both ? false : inPlay, updated_at: Date.now() / 1000 }
          : m,
      );
      const players = s.players.map((p) => ({ ...p }));
      if (s.config.elo_auto_update) {
        recalculateAll(players, matches, { kFactor: s.config.elo_k_factor, weakWeight: s.config.pair_weak_weight, gameScale: s.config.game_scale });
      }
      return { ...s, matches, players };
    });
    onClose();
  };

  const remove = () => {
    if (!confirm(`試合 ${no} を削除しますか？`)) return;
    update((s) => {
      const matches = s.matches.filter((m) => m.id !== match.id);
      const players = s.players.map((p) => ({ ...p }));
      if (s.config.elo_auto_update) {
        recalculateAll(players, matches, { kFactor: s.config.elo_k_factor, weakWeight: s.config.pair_weak_weight, gameScale: s.config.game_scale });
      }
      return { ...s, matches, players };
    });
    onClose();
  };

  return (
    <Sheet title={`試合 ${no} の結果`} onClose={onClose}>
      <div class="stack">
        <div class="scorebox">
          <div class="who">{match.team_a.join("・")}</div>
          <div class="muted">vs</div>
          <div class="who">{match.team_b.join("・")}</div>
          <Wheel class="score" options={GAME_OPTIONS} value={ga} onChange={setGa} />
          <div class="muted">-</div>
          <Wheel class="score" options={GAME_OPTIONS} value={gb} onChange={setGb} />
        </div>
        <label class="check">
          <input type="checkbox" checked={inPlay} onChange={(e) => setInPlay((e.target as HTMLInputElement).checked)} />
          進行中（この 4 人は次の試合に入れない）
        </label>
        <div class="row between">
          <button class="btn danger" onClick={remove}>削除</button>
          <div class="row">
            <button class="btn" onClick={() => { setGa(null); setGb(null); }}>結果を消す</button>
            <button class="btn primary" onClick={save}>保存</button>
          </div>
        </div>
      </div>
    </Sheet>
  );
}

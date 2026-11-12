import { useMemo } from "preact/hooks";
import type { ViewProps } from "../app";
import { countPlays } from "../core/dayEngine";
import { newPlayer, type Match } from "../core/models";
import { gameWinProb, pairStrength } from "../core/winModel";
import { deleteMatches } from "../store";
import { Sheet } from "./Sheet";

/**
 * 試合タブで試合をタップしたときの詳細。勝率予想・4 人のレートと出場回数・結果を出し、
 * ここから開始・結果の入力・削除ができる。
 * 勝率予想はいまのレートで計算する（レートは固定値）。レートを隠す設定なら、レートも勝率も出さない。
 */
export function MatchDetailSheet(props: ViewProps & { match: Match; courts: number; onResult: () => void; onStart: () => void; onClose: () => void }) {
  const { state, project, match, courts, updateProject, notify, onResult, onStart, onClose } = props;
  const hide = state.prefs.hide_ratings;
  const no = project.matches.findIndex((m) => m.id === match.id) + 1;
  const round = Math.floor((no - 1) / courts) + 1;
  const status = match.result !== null ? "終了" : match.in_play ? "進行中" : "待機";

  const byName = useMemo(() => new Map(state.db.map((p) => [p.name, p])), [state.db]);
  const playerOf = (n: string) => byName.get(n) ?? newPlayer(n);
  const plays = useMemo(() => countPlays([...match.team_a, ...match.team_b].map(playerOf), project.matches), [match, project.matches, byName]);

  const w = project.config.pair_weak_weight;
  const doubles = match.team_a.length === 2 && match.team_b.length === 2;
  const strength = (team: string[]) => pairStrength(playerOf(team[0]).rating, playerOf(team[1]).rating, w);
  const sa = doubles ? strength(match.team_a) : null;
  const sb = doubles ? strength(match.team_b) : null;
  const pa = sa !== null && sb !== null && !hide ? Math.round(gameWinProb(sa, sb, project.config.game_scale) * 100) : null;

  const ga = match.games_a;
  const gb = match.games_b;
  const winner = match.result === "A" ? match.team_a.join("・") : match.result === "B" ? match.team_b.join("・") : null;
  const verdict = match.result === null ? null : match.result === "D" ? "引き分け" : `${winner} の勝ち`;
  // 予想と結果のずれ（予想で不利だった側が勝ったか）
  const upset = pa !== null && (match.result === "A" ? pa < 50 : match.result === "B" ? pa > 50 : false);

  const remove = () => {
    if (!confirm(`試合 #${no}（${status}）を削除しますか？`)) return;
    updateProject((p) => deleteMatches(p, [match.id]));
    notify(`試合 #${no} を削除しました。`);
    onClose();
  };

  const team = (names: string[], side: "a" | "b", s: number | null, pct: number | null) => (
    <div class="team">
      <span class={"bar " + side} />
      <span class="names">
        {names.join("・")}
        {s !== null && !hide && <small class="mono" style="display:block;font-size:12px;font-weight:400;color:var(--muted)">ペアの強さ {Math.round(s)}</small>}
      </span>
      {pct !== null && <span class="pct">{pct}<small>%</small></span>}
    </div>
  );

  return (
    <Sheet title="試合の詳細" eyebrow={`R${round}・#${no}・${status}`} onClose={onClose}>
      <div class="matchup">
        {team(match.team_a, "a", sa, pa)}
        {pa !== null && <div class="split"><div class="a" style={`width:${pa}%`} /><div class="b" /></div>}
        {team(match.team_b, "b", sb, pa === null ? null : 100 - pa)}
      </div>
      {pa !== null && <div class="foot" style="margin-top:-10px">右の数字はレートから見た 1 ゲームの勝率予想（いまのレートで計算）</div>}

      {verdict && (
        <div class="verdict">
          <span class="k">結果</span>
          <span class="v">
            {ga !== null && gb !== null && <span class="mono" style="margin-right:10px">{ga} - {gb}</span>}
            {verdict}
            {upset && <span class="muted" style="margin-left:8px">（予想は不利）</span>}
          </span>
        </div>
      )}

      <div class="panel">
        {[...match.team_a, ...match.team_b].map((n, i) => (
          <div class="member two" key={n}>
            <span class="who" style="cursor:default">
              <span class="nm" style="display:flex;align-items:center;gap:8px"><span class={"bar " + (i < match.team_a.length ? "a" : "b")} style="width:3px;height:14px;flex:none" />{n}</span>
              <span class="tm">{playerOf(n).team ?? "所属なし"}</span>
            </span>
            <span class="num">
              {!hide && <b>{Math.round(playerOf(n).rating)}</b>}
              <span>出場 {plays.get(n) ?? 0}{project.late[n]?.plays ? ` (+${project.late[n].plays})` : ""}</span>
            </span>
          </div>
        ))}
      </div>

      <div class="actions">
        <button class="btn danger tall" onClick={remove}>削除</button>
        <span class="grow" />
        {status === "待機" && <button class="btn tall" onClick={() => { onStart(); onClose(); }}>開始</button>}
        <button class="btn primary tall" onClick={onResult}>{match.result === null ? "結果を入力" : "結果を直す"}</button>
      </div>
    </Sheet>
  );
}

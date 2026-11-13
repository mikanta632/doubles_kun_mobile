import { useMemo } from "preact/hooks";
import type { ViewProps } from "../app";
import { countPlays } from "../core/dayEngine";
import type { Player } from "../core/models";
import { attendingPlayers, setLate } from "../store";
import { HistorySection } from "./PlayerEditSheet";
import { Sheet } from "./Sheet";

/**
 * メンバータブで名前をタップしたときのシート。記録を見て、このプロジェクトでの「遅れて来た」（仮の試合数）を決める。
 * データベースの人（名前・所属・レート・休会）はここでは変えない（設定 → メンバーのデータベース）。
 * メンバーから外すのはプロジェクトの編集で行う。
 */
export function MemberSheet(props: ViewProps & { player: Player; onClose: () => void }) {
  const { state, project, player, updateProject, onClose } = props;
  const late = project.late[player.name];

  // ほかの参加者の出場回数（仮の試合数を含む）の最少。遅れて来た人をここに合わせると、その人ばかり入らない
  const othersMin = useMemo(() => {
    const others = attendingPlayers(state, project).filter((p) => p.name !== player.name);
    if (others.length === 0) return 0;
    const plays = countPlays(others, project.matches);
    return Math.min(...others.map((p) => (plays.get(p.name) ?? 0) + (project.late[p.name]?.plays ?? 0)));
  }, [state, project, player.name]);
  const actual = useMemo(() => countPlays([player], project.matches).get(player.name) ?? 0, [player, project.matches]);
  // 実際の出場と合わせて最少に届く数
  const suggest = Math.max(0, othersMin - actual);

  const set = (plays: number | null) => updateProject((p) => setLate(p, player.name, plays));

  return (
    <Sheet title="メンバー" eyebrow={project.name} onClose={onClose}>
      <div class="panel">
        <div class="member two">
          <span class="who" style="cursor:default">
            <span class="nm">{player.name}</span>
            <span class="tm">{player.team ?? "所属なし"}{player.active ? "" : "・休会中"}</span>
          </span>
          {!state.prefs.hide_ratings && <span class="num"><b>{Math.round(player.rating)}</b><span>レート</span></span>}
        </div>
      </div>

      <section class="section">
        <div class="section-h"><h2>遅れて来た</h2>{late && <span class="mono">{late.at} 試合目のあとから</span>}</div>
        {late ? (
          <div class="panel">
            <div class="lrow static">
              <span class="body">
                <span>仮の試合数</span>
                <span class="sub">出場 {actual} 回にこの数を足して組みます</span>
              </span>
              <div class="seg" role="group" aria-label="仮の試合数">
                <button onClick={() => set(late.plays - 1)} disabled={late.plays <= 0} aria-label="1 減らす">−</button>
                <button class="mono" style="cursor:default" tabIndex={-1}>{late.plays}</button>
                <button onClick={() => set(late.plays + 1)} aria-label="1 増やす">＋</button>
              </div>
            </div>
            <div class="lrow static">
              <button class="btn text" onClick={() => set(suggest)} disabled={late.plays === suggest}>いまの最少に合わせる（{suggest}）</button>
              <span class="grow" />
              <button class="btn text" onClick={() => set(null)}>取り消す</button>
            </div>
          </div>
        ) : (
          <button class="btn block" onClick={() => set(suggest)}>遅れて来た人にする（仮の試合数 {suggest}）</button>
        )}
        <div class="foot">
          遅れて来た人は、ほかの人に出場回数を追いつこうとして続けて入りがちです。仮の試合数を足しておくと、それを避けられます。
          連続で待った回数も、来た時点から数えます。
        </div>
      </section>

      <HistorySection state={state} project={project} name={player.name} />
      <div class="foot">メンバーから外すのはプロジェクトの編集で、名前・所属・レートの変更は設定の「メンバーのデータベース」で行います。</div>
      <div class="actions">
        <span class="grow" />
        <button class="btn tall" onClick={onClose}>閉じる</button>
      </div>
    </Sheet>
  );
}

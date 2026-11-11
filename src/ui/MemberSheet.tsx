import type { ViewProps } from "../app";
import type { Player } from "../core/models";
import { playedIn } from "../store";
import { HistorySection } from "./PlayerEditSheet";
import { toggleMember } from "./ProjectSheets";
import { Sheet } from "./Sheet";

/**
 * メンバータブで名前をタップしたときのシート。プロジェクト側からはデータベースの人を変えない：
 * 名前・所属・レート・休会の変更や削除はできず（設定 → メンバーのデータベースで行う）、名簿から外すことだけできる。
 */
export function MemberSheet(props: ViewProps & { player: Player; onClose: () => void }) {
  const { state, project, player, onClose } = props;
  const playedHere = playedIn(project, player.name);

  const remove = () => {
    toggleMember(props, player.name);
    onClose();
  };

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
      <HistorySection state={state} project={project} name={player.name} />
      <button class="btn block" onClick={remove} disabled={playedHere}>
        {playedHere ? "試合に出ているので名簿から外せません" : "このプロジェクトの名簿から外す"}
      </button>
      <div class="foot">名前・所属・レートの変更や削除は、設定の「メンバーのデータベース」で行います。</div>
      <div class="actions">
        <span class="grow" />
        <button class="btn tall" onClick={onClose}>閉じる</button>
      </div>
    </Sheet>
  );
}

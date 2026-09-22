import { useMemo, useState } from "preact/hooks";
import type { ViewProps } from "../app";
import { countPlays } from "../core/dayEngine";
import type { Player } from "../core/models";
import { memberPlayers, playedIn } from "../store";
import { PlayerEditSheet } from "./PlayerEditSheet";

/**
 * メンバータブ。プロジェクトの名簿のうち、今日試合に入れる人にチェックを付ける。
 * 名簿そのもの（データベースから誰を入れるか）はプロジェクトタブで作る。
 */
export function AttendanceView(props: ViewProps & { onGoProject: () => void }) {
  const { state, project, updateProject, notify, onGoProject } = props;
  const [editing, setEditing] = useState<Player | null>(null);

  const members = useMemo(() => memberPlayers(state, project), [state, project]);
  const plays = useMemo(() => countPlays(members, project.matches), [members, project.matches]);
  const selected = new Set(project.selected);
  const nSelected = members.filter((p) => p.active && selected.has(p.name)).length;

  const toggle = (name: string) =>
    updateProject((p) => ({ ...p, selected: p.selected.includes(name) ? p.selected.filter((n) => n !== name) : [...p.selected, name] }));

  const removeMember = (name: string) => {
    if (playedIn(project, name)) {
      notify("このプロジェクトの試合に出ている人は名簿から外せません。「試合に入れる」のチェックを外してください。");
      return;
    }
    updateProject((p) => ({ ...p, members: p.members.filter((n) => n !== name), selected: p.selected.filter((n) => n !== name) }));
  };

  return (
    <>
      <div class="topbar">
        <div>
          <h1>メンバー</h1>
          <div class="sub">「{project.name}」の名簿。試合に入れる人にチェック。{nSelected} / {members.length} 人</div>
        </div>
        {members.length > 0 && (
          <div class="row">
            <button class="btn small" onClick={() => updateProject((p) => ({ ...p, selected: memberPlayers(state, p).filter((x) => x.active).map((x) => x.name) }))}>全員選択</button>
            <button class="btn small" onClick={() => updateProject((p) => ({ ...p, selected: [] }))}>全員解除</button>
          </div>
        )}
      </div>

      {members.length === 0 ? (
        <div class="card">
          <div class="empty">「{project.name}」の名簿がまだありません。</div>
          <button class="btn primary block" onClick={onGoProject}>プロジェクトタブで名簿を作る</button>
        </div>
      ) : (
        <>
          <div class="card list">
            {members.map((p) => (
              <div class="item" key={p.name}>
                <label class="check grow" style="min-height:0">
                  <input type="checkbox" checked={p.active && selected.has(p.name)} disabled={!p.active} onChange={() => toggle(p.name)} />
                  <span class="grow">
                    <span style="font-weight:600">{p.name}</span>
                    {p.team && <span class="pill" style="margin-left:6px">{p.team}</span>}
                    {!p.active && <span class="pill" style="margin-left:6px">休会中</span>}
                    <div class="muted">レート {Math.round(p.rating)}・出場 {plays.get(p.name) ?? 0} 回</div>
                  </span>
                </label>
                <button class="btn small ghost" onClick={() => setEditing(p)}>編集</button>
              </div>
            ))}
          </div>
          <div class="row between">
            <span class="muted">名簿の追加・削除はプロジェクトタブから</span>
            <button class="btn small" onClick={onGoProject}>名簿を編集</button>
          </div>
        </>
      )}

      {editing && <PlayerEditSheet {...props} player={editing} onRemove={removeMember} onClose={() => setEditing(null)} />}
    </>
  );
}

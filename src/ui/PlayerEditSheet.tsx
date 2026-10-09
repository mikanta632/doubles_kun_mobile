import { useMemo, useState } from "preact/hooks";
import type { ViewProps } from "../app";
import type { Player } from "../core/models";
import { deletePlayer, playedAnywhere, playedIn, renamePlayer } from "../store";
import { Sheet } from "./Sheet";
import { Wheel, type WheelOption } from "./Wheel";

/** 所属のドラムロールで「新しく入力」を選んだことを表す値 */
const NEW_TEAM = " new";

/**
 * データベース上のプレイヤーを編集する。名前の変更はすべてのプロジェクトの試合・名簿に反映する。
 * onRemove を渡すと、いま開いているプロジェクトの名簿から外すボタンを出す。
 */
export function PlayerEditSheet({ player, state, project, update, notify, onRemove, onClose }: ViewProps & { player: Player; onRemove?: (name: string) => void; onClose: () => void }) {
  const [name, setName] = useState(player.name);
  const [rating, setRating] = useState(String(player.initial_rating));
  const [active, setActive] = useState(player.active);
  const isMember = project.members.includes(player.name);
  const playedHere = playedIn(project, player.name);

  // 所属は、すでに誰かに入っている候補から選ぶ。なければ新しく入力する
  const teams = useMemo(
    () => [...new Set(state.db.map((p) => (p.team ?? "").trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b, "ja")),
    [state.db],
  );
  const teamOptions: WheelOption<string>[] = [
    { value: "", label: "なし" },
    ...teams.map((t) => ({ value: t, label: t })),
    { value: NEW_TEAM, label: "新しく入力" },
  ];
  const [teamChoice, setTeamChoice] = useState(player.team && teams.includes(player.team) ? player.team : "");
  const [teamText, setTeamText] = useState("");
  const team = teamChoice === NEW_TEAM ? teamText.trim() : teamChoice;

  const save = () => {
    const newName = name.trim();
    if (!newName) return;
    if (newName !== player.name && state.db.some((p) => p.name === newName)) {
      notify("同じ名前の人が登録されています。");
      return;
    }
    const r = Number(rating);
    update((s0) => {
      const s = renamePlayer(s0, player.name, newName);
      const db = s.db.map((p) =>
        p.name === newName
          ? { ...p, initial_rating: Number.isFinite(r) ? r : p.initial_rating, rating: Number.isFinite(r) ? r : p.rating, team: team || null, active }
          : p,
      );
      // 休会中にした人は、どのプロジェクトでも試合の候補から外す
      const projects = active ? s.projects : s.projects.map((p) => ({ ...p, selected: p.selected.filter((n) => n !== newName) }));
      return { ...s, db, projects };
    });
    onClose();
  };

  const remove = () => {
    if (playedAnywhere(state, player.name)) {
      notify("試合に出ている人は削除できません。代わりに休会中にしてください。");
      return;
    }
    if (!confirm(`${player.name} をデータベースから削除しますか？`)) return;
    update((s) => deletePlayer(s, player.name));
    onClose();
  };

  return (
    <Sheet title="メンバーを編集" eyebrow={player.name} onClose={onClose}>
      <div class="row">
        <label class="field grow">
          <span>名前</span>
          <input type="text" value={name} onInput={(e) => setName((e.target as HTMLInputElement).value)} />
        </label>
        <label class="field" style="width:104px">
          <span>レート</span>
          <input type="number" inputMode="numeric" value={rating} onInput={(e) => setRating((e.target as HTMLInputElement).value)} />
        </label>
      </div>
      <div class="field">
        <span>所属</span>
        <Wheel class="boxed" options={teamOptions} value={teamChoice} onChange={setTeamChoice} />
        {teamChoice === NEW_TEAM && (
          <input type="text" placeholder="所属を入力" aria-label="所属を入力" value={teamText} onInput={(e) => setTeamText((e.target as HTMLInputElement).value)} style="margin-top:6px" />
        )}
      </div>
      <label class="check">
        <input type="checkbox" checked={!active} onChange={(e) => setActive(!(e.target as HTMLInputElement).checked)} />
        休会中（どのプロジェクトでも試合に入れない）
      </label>
      {onRemove && isMember && (
        <button class="btn block" onClick={() => { onRemove(player.name); if (!playedHere) onClose(); }} disabled={playedHere}>
          {playedHere ? "試合に出ているので名簿から外せません" : "このプロジェクトの名簿から外す"}
        </button>
      )}
      <div class="actions">
        <button class="btn danger tall" onClick={remove}>削除</button>
        <span class="grow" />
        <button class="btn tall" onClick={onClose}>キャンセル</button>
        <button class="btn primary tall" onClick={save}>保存</button>
      </div>
    </Sheet>
  );
}

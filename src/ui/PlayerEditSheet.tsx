import type { JSX } from "preact";
import { useMemo, useState } from "preact/hooks";
import type { ViewProps } from "../app";
import type { Player } from "../core/models";
import { deletePlayer, playedAnywhere, playedIn, playerHistory, renamePlayer } from "../store";
import { whenWhere } from "./ProjectSheets";
import { Sheet } from "./Sheet";
import { Wheel, type WheelOption } from "./Wheel";

/** 所属のドラムロールで「新しく入力」を選んだことを表す値 */
const NEW_TEAM = " new";

/** データベースに出てくる所属（五十音順） */
export function teamsOf(db: readonly Player[]): string[] {
  return [...new Set(db.map((p) => (p.team ?? "").trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b, "ja"));
}

/**
 * 所属の入力欄。すでに誰かに入っている候補から選び、なければ新しく入力する。
 * 返す team は空文字なら「なし」。
 */
export function useTeamField(teams: readonly string[], initial: string | null): [string, JSX.Element] {
  const [choice, setChoice] = useState(initial && teams.includes(initial) ? initial : "");
  const [text, setText] = useState("");
  const options: WheelOption<string>[] = [
    { value: "", label: "なし" },
    ...teams.map((t) => ({ value: t, label: t })),
    { value: NEW_TEAM, label: "新しく入力" },
  ];
  const field = (
    <div class="field">
      <span>所属</span>
      <Wheel class="boxed" options={options} value={choice} onChange={setChoice} />
      {choice === NEW_TEAM && (
        <input type="text" placeholder="所属を入力" aria-label="所属を入力" value={text} onInput={(e) => setText((e.target as HTMLInputElement).value)} style="margin-top:6px" />
      )}
    </div>
  );
  return [choice === NEW_TEAM ? text.trim() : choice, field];
}

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

  const teams = useMemo(() => teamsOf(state.db), [state.db]);
  const [team, teamField] = useTeamField(teams, player.team);
  const history = useMemo(() => playerHistory(state, player.name), [state, player.name]);
  const total = history.reduce((a, r) => ({ played: a.played + r.played, wins: a.wins + r.wins, losses: a.losses + r.losses }), { played: 0, wins: 0, losses: 0 });

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
      const db = s.db.map((p) => {
        if (p.name !== newName) return p;
        // 初期レートを変えたときだけ rating も合わせる（自動更新 ON なら直後に再計算される）。
        // 所属や休会の変更だけで、凍結している rating や読み込んだ rating を初期値に戻さない
        const changed = Number.isFinite(r) && r !== p.initial_rating;
        return { ...p, initial_rating: changed ? r : p.initial_rating, rating: changed ? r : p.rating, team: team || null, active };
      });
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
      {teamField}
      <label class="check">
        <input type="checkbox" checked={!active} onChange={(e) => setActive(!(e.target as HTMLInputElement).checked)} />
        休会中（どのプロジェクトでも試合に入れない）
      </label>
      {onRemove && isMember && (
        <button class="btn block" onClick={() => { onRemove(player.name); if (!playedHere) onClose(); }} disabled={playedHere}>
          {playedHere ? "試合に出ているので名簿から外せません" : "このプロジェクトの名簿から外す"}
        </button>
      )}
      {history.length > 0 && (
        <section class="section">
          <div class="section-h">
            <h2>これまでの記録</h2>
            <span class="mono">{total.played} 試合 {total.wins} 勝 {total.losses} 敗</span>
          </div>
          <div class={"panel" + (history.length > 5 ? " scroll" : "")}>
            {history.map((r) => (
              <div class="lrow static" key={r.project.id}>
                <span class="body">
                  <span style={r.project.id === project.id ? "font-weight:600" : ""}>{r.project.name}</span>
                  <span class="sub mono">{whenWhere(r.project)}{r.member ? "" : "｜名簿外"}</span>
                </span>
                <span class="count">{r.played ? `${r.played} 試合 ${r.wins}-${r.losses}${r.draws ? `-${r.draws}` : ""}` : "試合なし"}</span>
              </div>
            ))}
          </div>
        </section>
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

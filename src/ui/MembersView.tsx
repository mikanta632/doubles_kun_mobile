import { useMemo, useState } from "preact/hooks";
import type { ViewProps } from "../app";
import { countPlays } from "../core/dayEngine";
import type { Player } from "../core/models";
import { memberPlayers } from "../store";
import { PlusIcon, SearchIcon } from "./icons";
import { PlayerEditSheet } from "./PlayerEditSheet";
import { RosterPickSheet, toggleMember } from "./ProjectSheets";

type Filter = "all" | "in" | "out";

/**
 * メンバータブ。プロジェクトの名簿と、今日の参加（試合に入れる人）を一つの一覧で扱う。
 * 右のチェックが参加、名前をタップすると編集。名簿への追加は右上の「追加」から。
 */
export function MembersView(props: ViewProps) {
  const { state, project, updateProject } = props;
  const [editing, setEditing] = useState<Player | null>(null);
  const [adding, setAdding] = useState(false);
  const [filter, setFilter] = useState<Filter>("all");
  const [query, setQuery] = useState("");

  const members = useMemo(() => memberPlayers(state, project), [state, project]);
  const plays = useMemo(() => countPlays(members, project.matches), [members, project.matches]);
  const selected = new Set(project.selected);
  const isIn = (p: Player) => p.active && selected.has(p.name);
  const nIn = members.filter(isIn).length;
  const activeMembers = members.filter((p) => p.active);
  const allIn = activeMembers.length > 0 && nIn === activeMembers.length;

  const q = query.trim();
  const shown = members.filter((p) => (filter === "all" || (filter === "in" ? isIn(p) : !isIn(p))) && (!q || p.name.includes(q) || (p.team ?? "").includes(q)));

  const toggle = (name: string) =>
    updateProject((p) => ({ ...p, selected: p.selected.includes(name) ? p.selected.filter((n) => n !== name) : [...p.selected, name] }));

  const toggleAll = () =>
    updateProject((p) => ({ ...p, selected: allIn ? [] : memberPlayers(state, p).filter((x) => x.active).map((x) => x.name) }));

  return (
    <>
      <header class="head">
        <div>
          <div class="eyebrow">今日の参加 {nIn} / {members.length}</div>
          <h1>メンバー</h1>
        </div>
        <button class="btn primary" onClick={() => setAdding(true)}><PlusIcon />追加</button>
      </header>

      {members.length === 0 ? (
        <div class="panel empty">
          名簿がありません。データベースから選ぶか、名前を登録して追加してください。
          <div><button class="btn primary" onClick={() => setAdding(true)}><PlusIcon />メンバーを追加</button></div>
        </div>
      ) : (
        <>
          {members.length > 8 && (
            <label class="search">
              <SearchIcon />
              <input type="search" placeholder="名前や所属で探す" aria-label="名前や所属で探す" value={query} onInput={(e) => setQuery((e.target as HTMLInputElement).value)} />
            </label>
          )}

          <div class="row between" style="border-bottom:1px solid var(--line)">
            <div class="utabs" role="tablist" aria-label="表示" style="border-bottom:0">
              {([["all", `全員 ${members.length}`], ["in", `参加 ${nIn}`], ["out", `休み ${members.length - nIn}`]] as [Filter, string][]).map(([k, l]) => (
                <button key={k} role="tab" aria-selected={filter === k} class={filter === k ? "on" : ""} onClick={() => setFilter(k)}>{l}</button>
              ))}
            </div>
            <button class="btn text" onClick={toggleAll} disabled={activeMembers.length === 0}>{allIn ? "全員外す" : "全員参加"}</button>
          </div>

          <div class="panel">
            {shown.map((p) => (
              <div class={"member" + (isIn(p) ? "" : " off")} key={p.name}>
                <button class="who" onClick={() => setEditing(p)}>
                  <span class="nm">{p.name}</span>
                  <span class="tm">{p.team ?? "所属なし"}{p.active ? "" : "・休会中"}</span>
                </button>
                <span class="num">
                  <b>{Math.round(p.rating)}</b>
                  <span>出場 {plays.get(p.name) ?? 0}</span>
                </span>
                <label class="tick">
                  <input type="checkbox" checked={isIn(p)} disabled={!p.active} onChange={() => toggle(p.name)} aria-label={`${p.name}を今日の試合に入れる`} />
                </label>
              </div>
            ))}
            {shown.length === 0 && <div class="empty">該当する人はいません</div>}
          </div>
          <div class="foot">名前をタップすると、レート・所属の変更や名簿から外す操作ができます。</div>
        </>
      )}

      {editing && <PlayerEditSheet {...props} player={editing} onRemove={(name) => toggleMember(props, name)} onClose={() => setEditing(null)} />}
      {adding && <RosterPickSheet {...props} onClose={() => setAdding(false)} />}
    </>
  );
}

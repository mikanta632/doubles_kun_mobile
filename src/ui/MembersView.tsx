import { useMemo, useState } from "preact/hooks";
import type { ViewProps } from "../app";
import { countPlays } from "../core/dayEngine";
import type { Player } from "../core/models";
import { memberPlayers } from "../store";
import { SearchIcon } from "./icons";
import { MemberSheet } from "./MemberSheet";
import { RosterEditSheet } from "./ProjectSheets";

type Filter = "all" | "in" | "out";

/**
 * メンバータブ。プロジェクトのメンバー（参加者）を並べ、組み合わせに入れるかどうかだけを決める。
 * メンバーは全員、組み合わせに入れるのがふつう。チェックを外すのは、その場にいるが組み合わせから外す人（休憩・けがなど）だけ。
 * メンバーの追加・削除はプロジェクトの作成・編集で行う。データベースの人（名前・所属・レート・休会）もここでは変えない。
 * 名前をタップすると、これまでの記録と「遅れて来た」の設定。
 */
export function MembersView(props: ViewProps) {
  const { state, project, updateProject } = props;
  const [editing, setEditing] = useState<Player | null>(null);
  const [picking, setPicking] = useState(false);
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
          <div class="eyebrow">組み合わせに入れる {nIn} / {members.length}</div>
          <h1>メンバー</h1>
        </div>
      </header>

      {members.length === 0 ? (
        <div class="panel empty">
          「{project.name}」のメンバーがいません。プロジェクトのメンバーをデータベースから選んでください。
          <div><button class="btn primary" onClick={() => setPicking(true)}>プロジェクトのメンバーを選ぶ</button></div>
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
              {([["all", `全員 ${members.length}`], ["in", `組む ${nIn}`], ["out", `外す ${members.length - nIn}`]] as [Filter, string][]).map(([k, l]) => (
                <button key={k} role="tab" aria-selected={filter === k} class={filter === k ? "on" : ""} onClick={() => setFilter(k)}>{l}</button>
              ))}
            </div>
            <button class="btn text" onClick={toggleAll} disabled={activeMembers.length === 0}>{allIn ? "全員外す" : "全員入れる"}</button>
          </div>

          <div class="panel">
            {shown.map((p) => (
              <div class={"member" + (isIn(p) ? "" : " off")} key={p.name}>
                <button class="who" onClick={() => setEditing(p)}>
                  <span class="nm">{p.name}</span>
                  <span class="tm">{p.team ?? "所属なし"}{p.active ? "" : "・休会中"}</span>
                </button>
                <span class="num">
                  {!state.prefs.hide_ratings && <b>{Math.round(p.rating)}</b>}
                  <span>出場 {plays.get(p.name) ?? 0}{project.late[p.name]?.plays ? ` (+${project.late[p.name].plays})` : ""}</span>
                </span>
                <label class="tick">
                  <input type="checkbox" checked={isIn(p)} disabled={!p.active} onChange={() => toggle(p.name)} aria-label={`${p.name}を組み合わせに入れる`} />
                </label>
              </div>
            ))}
            {shown.length === 0 && <div class="empty">該当する人はいません</div>}
          </div>
          <div class="foot">
            チェックを外すのは、その場にいるが組み合わせから外す人（休憩・けがなど）だけです。外した人も集計には入ります。
            メンバーの追加・削除は、試合タブの見出し（プロジェクト）→ 編集 → メンバーから。
          </div>
        </>
      )}

      {editing && <MemberSheet {...props} player={editing} onClose={() => setEditing(null)} />}
      {picking && <RosterEditSheet {...props} onClose={() => setPicking(false)} />}
    </>
  );
}

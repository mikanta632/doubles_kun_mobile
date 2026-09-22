import { useMemo, useState } from "preact/hooks";
import type { ViewProps } from "../app";
import { newPlayer, type Player } from "../core/models";
import { addProject, memberPlayers, newProject, playedIn, removeProject, todayIso, updateCurrent, type Project } from "../store";
import { PlayerEditSheet } from "./PlayerEditSheet";
import { Sheet } from "./Sheet";

type Seg = "project" | "db";

/**
 * プロジェクトタブ。
 *   プロジェクト … 名前・日付・場所、名簿（データベースから選ぶ）、切り替え・作成・削除
 *   データベース … 登録した全プレイヤーの登録・編集
 */
export function ProjectView(props: ViewProps) {
  const { state, project, updateProject, notify } = props;
  const [seg, setSeg] = useState<Seg>(() => (state.db.length ? "project" : "db"));
  const [editing, setEditing] = useState<Player | null>(null);
  const memberSet = new Set(project.members);

  /** 名簿に入れる／外す。このプロジェクトの試合に出ている人は外せない */
  const toggleMember = (name: string) => {
    if (memberSet.has(name)) {
      if (playedIn(project, name)) {
        notify("このプロジェクトの試合に出ている人は名簿から外せません。メンバータブで「試合に入れる」のチェックを外してください。");
        return;
      }
      updateProject((p) => ({ ...p, members: p.members.filter((n) => n !== name), selected: p.selected.filter((n) => n !== name) }));
    } else {
      updateProject((p) => ({ ...p, members: [...p.members, name], selected: [...p.selected, name] }));
    }
  };

  return (
    <>
      <div class="topbar">
        <div>
          <h1>プロジェクト</h1>
        </div>
      </div>

      <div class="seg" style="margin-bottom:10px">
        <button class={seg === "project" ? "on" : ""} onClick={() => setSeg("project")}>プロジェクト</button>
        <button class={seg === "db" ? "on" : ""} onClick={() => setSeg("db")}>データベース（{state.db.length}）</button>
      </div>

      {seg === "project" && <ProjectPane {...props} onEdit={setEditing} onToggleMember={toggleMember} onGoDb={() => setSeg("db")} />}
      {seg === "db" && <DatabasePane {...props} memberSet={memberSet} onToggleMember={toggleMember} onEdit={setEditing} />}

      {editing && <PlayerEditSheet {...props} player={editing} onRemove={toggleMember} onClose={() => setEditing(null)} />}
    </>
  );
}

function ProjectPane({ state, project, update, updateProject, notify, onEdit, onToggleMember, onGoDb }: ViewProps & {
  onEdit: (p: Player) => void;
  onToggleMember: (name: string) => void;
  onGoDb: () => void;
}) {
  const [creating, setCreating] = useState(false);
  const [picking, setPicking] = useState(false);
  const [query, setQuery] = useState("");
  const [all, setAll] = useState(false);
  const members = useMemo(() => memberPlayers(state, project), [state, project]);

  // 日付の新しい順（未定は最後）。同じ日なら最近触った順
  const sorted = useMemo(
    () => [...state.projects].sort((a, b) => (b.date || "").localeCompare(a.date || "") || b.updated_at.localeCompare(a.updated_at)),
    [state.projects],
  );
  const q = query.trim();
  const found = q ? sorted.filter((p) => p.name.includes(q) || p.place.includes(q) || p.date.includes(q)) : sorted;
  // 増えてきたら、既定では最近のぶんだけ出す。開いているものは必ず入れる
  const folded = !q && !all && found.length > RECENT + 2;
  const shown = folded ? dedupeById([...found.slice(0, RECENT), ...found.filter((p) => p.id === project.id)]) : found;

  const remove = () => {
    const msg = project.matches.length
      ? `「${project.name}」を削除しますか？ ${project.matches.length} 試合が消えます（データベースのメンバーは残ります）。`
      : `「${project.name}」を削除しますか？（データベースのメンバーは残ります）`;
    if (!confirm(msg)) return;
    update((s) => removeProject(s, project.id));
    notify(`「${project.name}」を削除しました。`);
  };

  return (
    <>
      <div class="card">
        {sorted.length > RECENT + 2 && (
          <input type="text" placeholder="名前・場所・日付で絞り込み" value={query} onInput={(e) => setQuery((e.target as HTMLInputElement).value)} style="margin-bottom:8px" />
        )}
        <div class="list">
          {shown.map((p) => (
            <div class={"item" + (p.id === project.id ? " current" : "")} key={p.id} onClick={() => p.id !== project.id && update((s) => ({ ...s, current: p.id }))}>
              <span class="grow">
                <span style="font-weight:600">{p.name}</span>
                <div class="muted">{describe(p)}</div>
              </span>
            </div>
          ))}
          {shown.length === 0 && <div class="empty">該当なし</div>}
        </div>
        {folded && <button class="btn block" style="margin-top:8px" onClick={() => setAll(true)}>すべて表示（{found.length} 件）</button>}
        <button class="btn block" style="margin-top:8px" onClick={() => setCreating(true)}>新しいプロジェクト</button>
      </div>

      <div class="card stack">
        <label>
          <div class="muted">名前</div>
          <input type="text" value={project.name} onInput={(e) => updateProject((p) => ({ ...p, name: (e.target as HTMLInputElement).value }))} />
        </label>
        <div class="row">
          <label class="grow">
            <div class="muted">日付</div>
            <input type="date" value={project.date} onChange={(e) => updateProject((p) => ({ ...p, date: (e.target as HTMLInputElement).value }))} />
          </label>
          <label class="grow">
            <div class="muted">場所</div>
            <input type="text" placeholder="例: 第2体育館" value={project.place} onInput={(e) => updateProject((p) => ({ ...p, place: (e.target as HTMLInputElement).value }))} />
          </label>
        </div>
        <div class="row" style="justify-content:flex-end">
          <button class="btn small danger" onClick={remove}>削除</button>
        </div>
      </div>

      <div class="card">
        <div class="row between" style="margin-bottom:6px">
          <h2 style="margin:0">名簿（{members.length} 人）</h2>
          <button class="btn small primary" onClick={() => (state.db.length ? setPicking(true) : onGoDb())}>データベースから選ぶ</button>
        </div>
        {members.length === 0 ? (
          <div class="empty">名簿がありません</div>
        ) : (
          <div class="list">
            {members.map((p) => (
              <div class="item" key={p.name}>
                <span class="grow" onClick={() => onEdit(p)}>
                  <span style="font-weight:600">{p.name}</span>
                  {p.team && <span class="pill" style="margin-left:6px">{p.team}</span>}
                  {!p.active && <span class="pill" style="margin-left:6px">休会中</span>}
                  <div class="muted">レート {Math.round(p.rating)}</div>
                </span>
                <button class="btn small ghost" onClick={() => onToggleMember(p.name)} disabled={playedIn(project, p.name)}>外す</button>
              </div>
            ))}
          </div>
        )}
      </div>

      {creating && <NewProjectSheet project={project} update={update} notify={notify} onClose={() => setCreating(false)} />}
      {picking && <RosterPickSheet state={state} project={project} update={update} notify={notify} onClose={() => setPicking(false)} />}
    </>
  );
}

/** 既定で出すプロジェクトの数 */
const RECENT = 10;

function dedupeById(ps: Project[]): Project[] {
  const seen = new Set<string>();
  return ps.filter((p) => (seen.has(p.id) ? false : (seen.add(p.id), true)));
}

function describe(p: Project): string {
  const parts = [p.date ? fmtDate(p.date) : "日付未定", p.place].filter(Boolean);
  return `${parts.join("・")}｜名簿 ${p.members.length} 人・${p.matches.length} 試合`;
}

function fmtDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  if (!y || !m || !d) return iso;
  const w = "日月火水木金土"[new Date(y, m - 1, d).getDay()];
  return `${y}/${m}/${d}（${w}）`;
}

function NewProjectSheet({ project, update, notify, onClose }: { project: Project; update: ViewProps["update"]; notify: ViewProps["notify"]; onClose: () => void }) {
  const [name, setName] = useState("");
  const [date, setDate] = useState(todayIso());
  const [place, setPlace] = useState(project.place);

  const create = () => {
    const n = name.trim();
    if (!n) return;
    const p = newProject(n, {
      date,
      place: place.trim(),
      config: { ...project.config },
      settings: { ...project.settings },
    });
    update((s) => addProject(s, p));
    notify(`「${n}」を作って開きました。`);
    onClose();
  };

  return (
    <Sheet title="新しいプロジェクト" onClose={onClose}>
      <div class="stack">
        <label>
          <div class="muted">名前</div>
          <input type="text" placeholder="例: 2026年度春秋杯" value={name} onInput={(e) => setName((e.target as HTMLInputElement).value)} onKeyDown={(e) => e.key === "Enter" && create()} />
        </label>
        <div class="row">
          <label class="grow">
            <div class="muted">日付</div>
            <input type="date" value={date} onChange={(e) => setDate((e.target as HTMLInputElement).value)} />
          </label>
          <label class="grow">
            <div class="muted">場所</div>
            <input type="text" value={place} onInput={(e) => setPlace((e.target as HTMLInputElement).value)} />
          </label>
        </div>
        <div class="row" style="justify-content:flex-end">
          <button class="btn" onClick={onClose}>キャンセル</button>
          <button class="btn primary" onClick={create} disabled={!name.trim()}>作る</button>
        </div>
      </div>
    </Sheet>
  );
}

/** データベースから名簿に入れる人を選ぶ。まだ登録していない人はここで登録もできる。 */
function RosterPickSheet({ state, project, update, notify, onClose }: { state: ViewProps["state"]; project: Project; update: ViewProps["update"]; notify: ViewProps["notify"]; onClose: () => void }) {
  const [query, setQuery] = useState("");
  const [picked, setPicked] = useState<Set<string>>(() => new Set());
  const [newName, setNewName] = useState("");
  const memberSet = new Set(project.members);
  const q = query.trim();
  const candidates = state.db.filter((p) => p.active && !memberSet.has(p.name) && (!q || p.name.includes(q) || (p.team ?? "").includes(q)));

  const toggle = (name: string) =>
    setPicked((s) => {
      const n = new Set(s);
      if (n.has(name)) n.delete(name);
      else n.add(name);
      return n;
    });

  const register = () => {
    const name = newName.trim();
    if (!name) return;
    if (state.db.some((p) => p.name === name)) {
      notify("同じ名前の人が登録されています。");
      return;
    }
    update((s) => ({ ...s, db: [...s.db, newPlayer(name)] }));
    setPicked((s) => new Set(s).add(name));
    setNewName("");
    setQuery("");
  };

  const apply = () => {
    const names = [...picked];
    if (names.length === 0) return;
    update((s) => updateCurrent(s, (p) => ({ ...p, members: [...new Set([...p.members, ...names])], selected: [...new Set([...p.selected, ...names])] })));
    notify(`${names.length} 人を名簿に入れました。`);
    onClose();
  };

  return (
    <Sheet title={`「${project.name}」の名簿に入れる`} onClose={onClose}>
      <div class="stack">
        <input type="text" placeholder="名前や所属で絞り込み" value={query} onInput={(e) => setQuery((e.target as HTMLInputElement).value)} />
        <div class="list" style="max-height:45dvh; overflow:auto">
          {candidates.length === 0 && <div class="empty">該当なし</div>}
          {candidates.map((p) => (
            <label class="item check" key={p.name} style="min-height:44px">
              <input type="checkbox" checked={picked.has(p.name)} onChange={() => toggle(p.name)} />
              <span class="grow">
                <span style="font-weight:600">{p.name}</span>
                {p.team && <span class="pill" style="margin-left:6px">{p.team}</span>}
                <span class="muted" style="margin-left:6px">レート {Math.round(p.rating)}</span>
              </span>
            </label>
          ))}
        </div>
        <div class="row">
          <input class="grow" type="text" placeholder="新しく登録" value={newName} onInput={(e) => setNewName((e.target as HTMLInputElement).value)} onKeyDown={(e) => e.key === "Enter" && register()} />
          <button class="btn" onClick={register} disabled={!newName.trim()}>登録</button>
        </div>
        <div class="row" style="justify-content:flex-end">
          <button class="btn" onClick={onClose}>キャンセル</button>
          <button class="btn primary" onClick={apply} disabled={picked.size === 0}>{picked.size} 人を名簿に入れる</button>
        </div>
      </div>
    </Sheet>
  );
}

function DatabasePane({ state, project, update, notify, memberSet, onToggleMember, onEdit }: ViewProps & {
  memberSet: Set<string>;
  onToggleMember: (name: string) => void;
  onEdit: (p: Player) => void;
}) {
  const [newName, setNewName] = useState("");
  const [newRating, setNewRating] = useState("1500");
  const [query, setQuery] = useState("");
  const q = query.trim();
  const shown = state.db.filter((p) => !q || p.name.includes(q) || (p.team ?? "").includes(q));
  const active = shown.filter((p) => p.active);
  const inactive = shown.filter((p) => !p.active);

  const addPlayer = () => {
    const name = newName.trim();
    if (!name) return;
    if (state.db.some((p) => p.name === name)) {
      notify("同じ名前の人が登録されています。");
      return;
    }
    const rating = Number(newRating);
    // 登録した人は、そのまま開いているプロジェクトの名簿に入れる
    update((s) => updateCurrent({ ...s, db: [...s.db, newPlayer(name, Number.isFinite(rating) ? rating : 1500)] }, (p) => ({ ...p, members: [...p.members, name], selected: [...p.selected, name] })));
    setNewName("");
    setNewRating("1500");
  };

  const row = (p: Player) => {
    const on = memberSet.has(p.name);
    return (
      <div class="item" key={p.name}>
        <span class="grow" onClick={() => onEdit(p)}>
          <span style={p.active ? "font-weight:600" : "color:var(--muted)"}>{p.name}</span>
          {p.team && <span class="pill" style="margin-left:6px">{p.team}</span>}
          <div class="muted">レート {Math.round(p.rating)}</div>
        </span>
        <button class={"btn small" + (on ? " primary" : "")} style="min-width:64px" onClick={() => onToggleMember(p.name)} disabled={!p.active && !on}>
          {on ? "名簿入り" : "名簿へ"}
        </button>
      </div>
    );
  };

  return (
    <>
      <div class="card">
        <div class="row">
          <input class="grow" type="text" placeholder="名前" value={newName} onInput={(e) => setNewName((e.target as HTMLInputElement).value)} onKeyDown={(e) => e.key === "Enter" && addPlayer()} />
          <input type="number" style="width:88px" inputMode="numeric" value={newRating} onInput={(e) => setNewRating((e.target as HTMLInputElement).value)} />
          <button class="btn primary" onClick={addPlayer} disabled={!newName.trim()}>登録</button>
        </div>
      </div>

      {state.db.length === 0 ? (
        <div class="empty">登録がありません</div>
      ) : (
        <div class="card list">
          {state.db.length > 8 && <input type="text" placeholder="名前や所属で絞り込み" value={query} onInput={(e) => setQuery((e.target as HTMLInputElement).value)} style="margin-bottom:4px" />}
          {active.map(row)}
          {active.length === 0 && <div class="empty">該当なし</div>}
        </div>
      )}

      {inactive.length > 0 && (
        <details class="card">
          <summary>休会中（{inactive.length}）</summary>
          <div class="list">{inactive.map(row)}</div>
        </details>
      )}
    </>
  );
}

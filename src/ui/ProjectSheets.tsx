import { useMemo, useState } from "preact/hooks";
import type { ViewProps } from "../app";
import { newPlayer, type Player } from "../core/models";
import { addProject, newProject, playedIn, removeProject, todayIso, updateCurrent, type Project } from "../store";
import { CheckIcon, ChevronRight, PlusIcon, SearchIcon } from "./icons";
import { PlayerEditSheet } from "./PlayerEditSheet";
import { Sheet } from "./Sheet";

/** 既定で出すプロジェクトの数 */
const RECENT = 5;

/** 「2026.10.10（土）」の形。日付がなければ「日付未定」 */
export function fmtDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  if (!y || !m || !d) return iso || "日付未定";
  const w = "日月火水木金土"[new Date(y, m - 1, d).getDay()];
  return `${y}.${String(m).padStart(2, "0")}.${String(d).padStart(2, "0")}（${w}）`;
}

/** 見出しの上に出す「日付・場所」 */
export function whenWhere(p: Project): string {
  return [fmtDate(p.date), p.place].filter(Boolean).join("・");
}

/**
 * 名簿に入れる／外す。このプロジェクトの試合に出ている人は外せない。
 * 入れた人は、そのまま今日の参加にも入れる。
 */
export function toggleMember({ project, updateProject, notify }: Pick<ViewProps, "project" | "updateProject" | "notify">, name: string) {
  if (project.members.includes(name)) {
    if (playedIn(project, name)) {
      notify("このプロジェクトの試合に出ている人は名簿から外せません。参加のチェックを外してください。");
      return;
    }
    updateProject((p) => ({ ...p, members: p.members.filter((n) => n !== name), selected: p.selected.filter((n) => n !== name) }));
  } else {
    updateProject((p) => ({ ...p, members: [...p.members, name], selected: [...p.selected, name] }));
  }
}

type Mode = "list" | "edit" | "new";

/** 試合タブの見出しから開く。プロジェクトの切り替え・編集・作成 */
export function ProjectsSheet(props: ViewProps & { onClose: () => void }) {
  const { state, project, update, onClose } = props;
  const [mode, setMode] = useState<Mode>("list");
  const [query, setQuery] = useState("");
  const [all, setAll] = useState(false);

  // 日付の新しい順（未定は最後）。同じ日なら最近触った順
  const sorted = useMemo(
    () => [...state.projects].sort((a, b) => (b.date || "").localeCompare(a.date || "") || b.updated_at.localeCompare(a.updated_at)),
    [state.projects],
  );
  const q = query.trim();
  const found = q ? sorted.filter((p) => p.name.includes(q) || p.place.includes(q) || p.date.includes(q) || fmtDate(p.date).includes(q)) : sorted;
  const folded = !q && !all && found.length > RECENT + 1;
  const shown = folded ? dedupeById([...found.slice(0, RECENT), ...found.filter((p) => p.id === project.id)]) : found;

  if (mode === "edit") return <ProjectEditSheet {...props} onClose={() => setMode("list")} onDone={onClose} />;
  if (mode === "new") return <NewProjectSheet {...props} onClose={() => setMode("list")} onDone={onClose} />;

  const open = (p: Project) => {
    if (p.id !== project.id) update((s) => ({ ...s, current: p.id }));
    onClose();
  };

  return (
    <Sheet title="プロジェクト" eyebrow={`${state.projects.length} 件`} onClose={onClose}>
      {sorted.length > RECENT + 1 && (
        <label class="search">
          <SearchIcon />
          <input type="search" placeholder="名前・場所・日付で探す" aria-label="名前・場所・日付で探す" value={query} onInput={(e) => setQuery((e.target as HTMLInputElement).value)} />
        </label>
      )}
      <div style="border-top:1px solid var(--ink)">
        {shown.map((p) => (
          <button class="lrow" style="padding-left:0;padding-right:0;min-height:64px" key={p.id} aria-pressed={p.id === project.id} onClick={() => open(p)}>
            <span class="body">
              <span style={p.id === project.id ? "font-weight:600" : "font-weight:500"}>{p.name}</span>
              <span class="sub mono">{whenWhere(p)}｜{p.members.length}人・{p.matches.length}試合</span>
            </span>
            {p.id === project.id && <CheckIcon />}
          </button>
        ))}
        {shown.length === 0 && <div class="empty">見つかりません</div>}
        {folded && <button class="btn text block" style="min-height:48px" onClick={() => setAll(true)}>すべて表示（{found.length} 件）</button>}
      </div>
      <div class="actions">
        <button class="btn tall grow" onClick={() => setMode("edit")}>名前・日付を編集</button>
        <button class="btn primary tall grow" onClick={() => setMode("new")}><PlusIcon />新しく作る</button>
      </div>
    </Sheet>
  );
}

function dedupeById(ps: Project[]): Project[] {
  const seen = new Set<string>();
  return ps.filter((p) => (seen.has(p.id) ? false : (seen.add(p.id), true)));
}

function ProjectEditSheet({ project, update, updateProject, notify, onClose, onDone }: ViewProps & { onClose: () => void; onDone: () => void }) {
  const [name, setName] = useState(project.name);
  const [date, setDate] = useState(project.date);
  const [place, setPlace] = useState(project.place);

  const save = () => {
    const n = name.trim();
    if (!n) return;
    updateProject((p) => ({ ...p, name: n, date, place: place.trim() }));
    onDone();
  };

  const remove = () => {
    const msg = project.matches.length
      ? `「${project.name}」を削除しますか？ ${project.matches.length} 試合が消えます（データベースのメンバーは残ります）。`
      : `「${project.name}」を削除しますか？（データベースのメンバーは残ります）`;
    if (!confirm(msg)) return;
    update((s) => removeProject(s, project.id));
    notify(`「${project.name}」を削除しました。`);
    onDone();
  };

  return (
    <Sheet title="プロジェクトを編集" onClose={onClose}>
      <label class="field">
        <span>名前</span>
        <input type="text" value={name} onInput={(e) => setName((e.target as HTMLInputElement).value)} />
      </label>
      <div class="row">
        <label class="field grow">
          <span>日付</span>
          <input type="date" value={date} onChange={(e) => setDate((e.target as HTMLInputElement).value)} />
        </label>
        <label class="field grow">
          <span>場所</span>
          <input type="text" placeholder="例: 第2体育館" value={place} onInput={(e) => setPlace((e.target as HTMLInputElement).value)} />
        </label>
      </div>
      <div class="actions">
        <button class="btn danger tall" onClick={remove}>削除</button>
        <span class="grow" />
        <button class="btn tall" onClick={onClose}>戻る</button>
        <button class="btn primary tall" onClick={save} disabled={!name.trim()}>保存</button>
      </div>
    </Sheet>
  );
}

function NewProjectSheet({ project, update, notify, onClose, onDone }: ViewProps & { onClose: () => void; onDone: () => void }) {
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
    onDone();
  };

  return (
    <Sheet title="新しいプロジェクト" onClose={onClose}>
      <label class="field">
        <span>名前</span>
        <input type="text" placeholder="例: 2026年度春秋杯" value={name} onInput={(e) => setName((e.target as HTMLInputElement).value)} onKeyDown={(e) => e.key === "Enter" && create()} />
      </label>
      <div class="row">
        <label class="field grow">
          <span>日付</span>
          <input type="date" value={date} onChange={(e) => setDate((e.target as HTMLInputElement).value)} />
        </label>
        <label class="field grow">
          <span>場所</span>
          <input type="text" value={place} onInput={(e) => setPlace((e.target as HTMLInputElement).value)} />
        </label>
      </div>
      <div class="actions">
        <span class="grow" />
        <button class="btn tall" onClick={onClose}>戻る</button>
        <button class="btn primary tall" onClick={create} disabled={!name.trim()}>作る</button>
      </div>
    </Sheet>
  );
}

/** データベースから名簿に入れる人を選ぶ。まだ登録していない人はここで登録もできる。 */
export function RosterPickSheet({ state, project, update, notify, onClose }: ViewProps & { onClose: () => void }) {
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
    <Sheet title="メンバーを追加" eyebrow={project.name} onClose={onClose}>
      <div class="row">
        <input class="grow" type="text" placeholder="新しく登録する名前" aria-label="新しく登録する名前" value={newName} onInput={(e) => setNewName((e.target as HTMLInputElement).value)} onKeyDown={(e) => e.key === "Enter" && register()} />
        <button class="btn" onClick={register} disabled={!newName.trim()}>登録</button>
      </div>
      {state.db.length > 0 && (
        <>
          <label class="search">
            <SearchIcon />
            <input type="search" placeholder="データベースから探す" aria-label="データベースから探す" value={query} onInput={(e) => setQuery((e.target as HTMLInputElement).value)} />
          </label>
          <div class="panel scroll">
            {candidates.length === 0 && <div class="empty">{q ? "見つかりません" : "名簿に入っていない人はいません"}</div>}
            {candidates.map((p) => (
              <label class="lrow" key={p.name}>
                <span class="body">
                  <span style="font-weight:600">{p.name}</span>
                  <span class="sub">{p.team ?? "所属なし"}</span>
                </span>
                <span class="mono" style="font-size:13px;color:var(--muted)">{Math.round(p.rating)}</span>
                <input type="checkbox" checked={picked.has(p.name)} onChange={() => toggle(p.name)} />
              </label>
            ))}
          </div>
        </>
      )}
      <div class="actions">
        <span class="grow" />
        <button class="btn tall" onClick={onClose}>キャンセル</button>
        <button class="btn primary tall" onClick={apply} disabled={picked.size === 0}>{picked.size} 人を名簿に入れる</button>
      </div>
    </Sheet>
  );
}

/** 設定から開く。全プロジェクト共通のメンバーの登録・編集。休会中の人もここで扱う */
export function DatabaseSheet(props: ViewProps & { onClose: () => void }) {
  const { state, project, update, notify, onClose } = props;
  const [newName, setNewName] = useState("");
  const [newRating, setNewRating] = useState("1500");
  const [query, setQuery] = useState("");
  const [editing, setEditing] = useState<Player | null>(null);
  const [showInactive, setShowInactive] = useState(false);
  const memberSet = new Set(project.members);
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
      <div class={"member" + (p.active ? "" : " off")} key={p.name}>
        <button class="who" onClick={() => setEditing(p)}>
          <span class="nm">{p.name}</span>
          <span class="tm">{p.team ?? "所属なし"}{p.active ? "" : "・休会中"}</span>
        </button>
        <span class="num"><b>{Math.round(p.rating)}</b></span>
        <button class="btn act" style={"min-width:92px;padding:0 10px" + (on ? "" : ";color:var(--text-2);font-weight:500")} aria-pressed={on} onClick={() => toggleMember(props, p.name)} disabled={!p.active && !on}>
          {on ? <><CheckIcon />名簿入り</> : "名簿へ"}
        </button>
      </div>
    );
  };

  if (editing) return <PlayerEditSheet {...props} player={editing} onClose={() => setEditing(null)} />;

  return (
    <Sheet title="メンバーのデータベース" eyebrow={`${state.db.length} 人・全プロジェクト共通`} onClose={onClose}>
      <div class="row">
        <input class="grow" type="text" placeholder="名前" aria-label="名前" value={newName} onInput={(e) => setNewName((e.target as HTMLInputElement).value)} onKeyDown={(e) => e.key === "Enter" && addPlayer()} />
        <input type="number" style="width:88px" inputMode="numeric" aria-label="レート" value={newRating} onInput={(e) => setNewRating((e.target as HTMLInputElement).value)} />
        <button class="btn primary" onClick={addPlayer} disabled={!newName.trim()}>登録</button>
      </div>
      {state.db.length === 0 ? (
        <div class="empty">登録がありません</div>
      ) : (
        <>
          {state.db.length > 8 && (
            <label class="search">
              <SearchIcon />
              <input type="search" placeholder="名前や所属で探す" aria-label="名前や所属で探す" value={query} onInput={(e) => setQuery((e.target as HTMLInputElement).value)} />
            </label>
          )}
          <div class="panel">
            {active.map(row)}
            {active.length === 0 && <div class="empty">見つかりません</div>}
          </div>
          {inactive.length > 0 && (
            <div class="panel">
              <button class="lrow" aria-expanded={showInactive} onClick={() => setShowInactive(!showInactive)}>
                <span class="body">休会中</span>
                <span class="count">{inactive.length}</span>
                <span class="chev" style={showInactive ? "transform:rotate(90deg)" : ""}><ChevronRight /></span>
              </button>
              {showInactive && inactive.map(row)}
            </div>
          )}
        </>
      )}
    </Sheet>
  );
}

import { useMemo, useState } from "preact/hooks";
import type { ViewProps } from "../app";
import { newPlayer } from "../core/models";
import { addProject, newProject, playedIn, removeProject, setRoster, todayIso, type AppState, type Project } from "../store";
import { CheckIcon, ChevronRight, PlusIcon, SearchIcon } from "./icons";
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

type Mode = "list" | "edit" | "new" | "members";

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

  if (mode === "edit") return <ProjectEditSheet {...props} onMembers={() => setMode("members")} onClose={() => setMode("list")} onDone={onClose} />;
  if (mode === "members") return <RosterEditSheet {...props} onClose={() => setMode("edit")} />;
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
        <button class="btn tall grow" onClick={() => setMode("edit")}>編集</button>
        <button class="btn primary tall grow" onClick={() => setMode("new")}><PlusIcon />新しく作る</button>
      </div>
    </Sheet>
  );
}

function dedupeById(ps: Project[]): Project[] {
  const seen = new Set<string>();
  return ps.filter((p) => (seen.has(p.id) ? false : (seen.add(p.id), true)));
}

function ProjectEditSheet({ project, update, updateProject, notify, onMembers, onClose, onDone }: ViewProps & { onMembers: () => void; onClose: () => void; onDone: () => void }) {
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
      <div class="pair">
        <label class="field grow">
          <span>日付</span>
          <input type="date" value={date} onChange={(e) => setDate((e.target as HTMLInputElement).value)} />
        </label>
        <label class="field grow">
          <span>場所</span>
          <input type="text" placeholder="例: 第2体育館" value={place} onInput={(e) => setPlace((e.target as HTMLInputElement).value)} />
        </label>
      </div>
      <div class="panel">
        <button class="lrow" onClick={onMembers}>
          <span class="body">
            <span>メンバー</span>
            <span class="sub">このプロジェクトに参加する人をデータベースから選ぶ</span>
          </span>
          <span class="count">{project.members.length} 人</span>
          <span class="chev"><ChevronRight /></span>
        </button>
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

function NewProjectSheet(props: ViewProps & { onClose: () => void; onDone: () => void }) {
  const { state, project, update, notify, onClose, onDone } = props;
  const [name, setName] = useState("");
  const [date, setDate] = useState(todayIso());
  const [place, setPlace] = useState(project.place);
  const [picked, setPicked] = useState<Set<string>>(() => new Set());
  const activeNames = useMemo(() => activeSet(state), [state.db]);
  // いまのプロジェクトと同じメンバー（休会中の人は除く）
  const sameAsCurrent = project.members.filter((n) => activeNames.has(n));

  const create = () => {
    const n = name.trim();
    if (!n) return;
    const p = setRoster(
      newProject(n, { date, place: place.trim(), config: { ...project.config }, settings: { ...project.settings } }),
      [...picked],
      activeNames,
    );
    update((s) => addProject(s, p));
    notify(`「${n}」を作って開きました（メンバー ${p.members.length} 人）。`);
    onDone();
  };

  return (
    <Sheet title="新しいプロジェクト" onClose={onClose}>
      <label class="field">
        <span>名前</span>
        <input type="text" placeholder="例: 2026年度春秋杯" value={name} onInput={(e) => setName((e.target as HTMLInputElement).value)} onKeyDown={(e) => e.key === "Enter" && create()} />
      </label>
      <div class="pair">
        <label class="field grow">
          <span>日付</span>
          <input type="date" value={date} onChange={(e) => setDate((e.target as HTMLInputElement).value)} />
        </label>
        <label class="field grow">
          <span>場所</span>
          <input type="text" value={place} onInput={(e) => setPlace((e.target as HTMLInputElement).value)} />
        </label>
      </div>
      <section class="section">
        <div class="section-h">
          <h2>メンバー <span class="mono">{picked.size}</span></h2>
          {sameAsCurrent.length > 0 && (
            <button class="btn text" onClick={() => setPicked(new Set(sameAsCurrent))}>「{project.name}」と同じにする</button>
          )}
        </div>
        <MemberPicker {...props} picked={picked} setPicked={setPicked} locked={new Set()} />
      </section>
      <div class="actions">
        <span class="grow" />
        <button class="btn tall" onClick={onClose}>戻る</button>
        <button class="btn primary tall" onClick={create} disabled={!name.trim()}>作る</button>
      </div>
    </Sheet>
  );
}

function activeSet(s: AppState): Set<string> {
  return new Set(s.db.filter((p) => p.active).map((p) => p.name));
}

/**
 * データベースから、プロジェクトのメンバーにする人を選ぶ（チェックが付いている人がメンバー）。
 * まだ登録していない人はここで登録もできる（プロジェクト側からデータベースに書き込むのはここだけ）。
 * locked の人（このプロジェクトの試合に出ている人）はチェックを外せない。休会中の人は、すでに選ばれていなければ出さない。
 */
type SetUpdater = (fn: (prev: Set<string>) => Set<string>) => void;

function MemberPicker({ state, update, notify, picked, setPicked, locked }: ViewProps & { picked: Set<string>; setPicked: SetUpdater; locked: Set<string> }) {
  const [query, setQuery] = useState("");
  const [newName, setNewName] = useState("");
  const q = query.trim();
  const candidates = state.db.filter((p) => (p.active || picked.has(p.name)) && (!q || p.name.includes(q) || (p.team ?? "").includes(q)));
  const shownActive = candidates.filter((p) => p.active);
  const allShown = shownActive.length > 0 && shownActive.every((p) => picked.has(p.name));

  const toggle = (name: string) => {
    if (locked.has(name)) {
      notify("このプロジェクトの試合に出ている人は外せません。");
      return;
    }
    // 続けてタップしても取りこぼさないよう、直前の状態から作る
    setPicked((prev) => {
      const n = new Set(prev);
      if (n.has(name)) n.delete(name);
      else n.add(name);
      return n;
    });
  };

  // 表示中の人をまとめて選ぶ／外す（試合に出ている人は外さない）
  const toggleShown = () =>
    setPicked((prev) => {
      const n = new Set(prev);
      for (const p of shownActive) {
        if (!allShown) n.add(p.name);
        else if (!locked.has(p.name)) n.delete(p.name);
      }
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
    setPicked((prev) => new Set(prev).add(name));
    setNewName("");
    setQuery("");
  };

  return (
    <>
      {state.db.length > 0 && (
        <div class="row">
          <label class="search grow">
            <SearchIcon />
            <input type="search" placeholder="データベースから探す" aria-label="データベースから探す" value={query} onInput={(e) => setQuery((e.target as HTMLInputElement).value)} />
          </label>
          <button class="btn text" onClick={toggleShown} disabled={shownActive.length === 0}>{allShown ? "全員外す" : "全員選ぶ"}</button>
        </div>
      )}
      <div class="panel scroll">
        {candidates.length === 0 && <div class="empty">{q ? "見つかりません" : "データベースに登録がありません"}</div>}
        {candidates.map((p) => (
          <label class="lrow" key={p.name}>
            <span class="body">
              <span style="font-weight:600">{p.name}</span>
              <span class="sub">{p.team ?? "所属なし"}{p.active ? "" : "・休会中"}{locked.has(p.name) ? "・試合に出ている" : ""}</span>
            </span>
            {!state.prefs.hide_ratings && <span class="mono" style="font-size:13px;color:var(--muted)">{Math.round(p.rating)}</span>}
            <input type="checkbox" checked={picked.has(p.name)} disabled={locked.has(p.name)} onChange={() => toggle(p.name)} aria-label={`${p.name}をメンバーにする`} />
          </label>
        ))}
      </div>
      <div class="row">
        <input class="grow" type="text" placeholder="データベースにいない人を登録" aria-label="新しく登録する名前" value={newName} onInput={(e) => setNewName((e.target as HTMLInputElement).value)} onKeyDown={(e) => e.key === "Enter" && register()} />
        <button class="btn" onClick={register} disabled={!newName.trim()}>登録</button>
      </div>
    </>
  );
}

/** プロジェクトのメンバーを選び直す（追加・削除）。プロジェクトの編集と、メンバータブが空のときに開く */
export function RosterEditSheet(props: ViewProps & { onClose: () => void }) {
  const { state, project, updateProject, notify, onClose } = props;
  const [picked, setPicked] = useState<Set<string>>(() => new Set(project.members));
  const locked = useMemo(() => new Set(project.members.filter((n) => playedIn(project, n))), [project]);
  const added = [...picked].filter((n) => !project.members.includes(n)).length;
  const removed = project.members.filter((n) => !picked.has(n)).length;

  const save = () => {
    const active = activeSet(state);
    updateProject((p) => setRoster(p, [...picked], active));
    const what = [added && `${added} 人追加`, removed && `${removed} 人削除`].filter(Boolean).join("・");
    notify(what ? `メンバーを${what}しました。` : "メンバーは変わりません。");
    onClose();
  };

  return (
    <Sheet title="メンバー" eyebrow={`${project.name}・${picked.size} 人`} onClose={onClose}>
      <MemberPicker {...props} picked={picked} setPicked={setPicked} locked={locked} />
      <div class="actions">
        <span class="grow" />
        <button class="btn tall" onClick={onClose}>戻る</button>
        <button class="btn primary tall" onClick={save}>{added || removed ? `保存（+${added} −${removed}）` : "保存"}</button>
      </div>
    </Sheet>
  );
}

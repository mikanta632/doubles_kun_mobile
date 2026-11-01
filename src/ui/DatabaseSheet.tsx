import { useMemo, useRef, useState } from "preact/hooks";
import type { ViewProps } from "../app";
import { newPlayer, type Player } from "../core/models";
import { databaseCsv, databaseJson, downloadText, parseDatabaseFile, shareText, todayStamp } from "../io";
import { addMembers, deletePlayers, mergePlayerPatches, playedAnywhere, updateCurrent, updatePlayers } from "../store";
import { CheckIcon, ChevronRight, SearchIcon } from "./icons";
import { PlayerEditSheet, teamsOf, useTeamField } from "./PlayerEditSheet";
import { toggleMember } from "./ProjectSheets";
import { Sheet } from "./Sheet";

type Sort = "added" | "name" | "team" | "rating";

const SORTS: [Sort, string][] = [["added", "登録順"], ["name", "名前"], ["team", "所属"], ["rating", "レート"]];

/** 所属の絞り込みで「所属なし」を表す値（空文字は「すべて」） */
const NO_TEAM = " none";

function sortPlayers(ps: Player[], sort: Sort): Player[] {
  const byName = (a: Player, b: Player) => a.name.localeCompare(b.name, "ja");
  if (sort === "name") return [...ps].sort(byName);
  // 所属なしは最後
  if (sort === "team") return [...ps].sort((a, b) => Number(!a.team) - Number(!b.team) || (a.team ?? "").localeCompare(b.team ?? "", "ja") || byName(a, b));
  if (sort === "rating") return [...ps].sort((a, b) => b.rating - a.rating || byName(a, b));
  return ps;
}

/**
 * 設定から開く。全プロジェクト共通のメンバーの登録・編集。休会中の人もここで扱う。
 * 「選ぶ」で何人かを選んで、名簿入り・所属・休会・削除をまとめて行える。ファイルでの書き出し・読み込みもここ。
 */
export function DatabaseSheet(props: ViewProps & { onClose: () => void }) {
  const { state, project, update, notify, onClose } = props;
  const [newName, setNewName] = useState("");
  const [newRating, setNewRating] = useState("1500");
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<Sort>("added");
  const [teamFilter, setTeamFilter] = useState("");
  const [editing, setEditing] = useState<Player | null>(null);
  const [showInactive, setShowInactive] = useState(false);
  const [selecting, setSelecting] = useState(false);
  const [picked, setPicked] = useState<Set<string>>(() => new Set());
  const [teamSheet, setTeamSheet] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const memberSet = new Set(project.members);
  const teams = useMemo(() => teamsOf(state.db), [state.db]);
  const q = query.trim();
  const shown = sortPlayers(
    state.db.filter(
      (p) =>
        (!q || p.name.includes(q) || (p.team ?? "").includes(q)) &&
        (teamFilter === "" || (teamFilter === NO_TEAM ? !p.team : p.team === teamFilter)),
    ),
    sort,
  );
  const active = shown.filter((p) => p.active);
  const inactive = shown.filter((p) => !p.active);
  const visible = showInactive ? shown : active;
  // 消えた人（削除・改名）の選択は数えない
  const pickedNames = state.db.filter((p) => picked.has(p.name)).map((p) => p.name);
  const allVisiblePicked = visible.length > 0 && visible.every((p) => picked.has(p.name));
  const pickedAllInactive = pickedNames.length > 0 && pickedNames.every((n) => !state.db.find((p) => p.name === n)?.active);

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

  const togglePick = (name: string) =>
    setPicked((s) => {
      const n = new Set(s);
      if (n.has(name)) n.delete(name);
      else n.add(name);
      return n;
    });

  const endSelect = () => {
    setSelecting(false);
    setPicked(new Set());
  };

  const bulkMembers = () => {
    update((s) => addMembers(s, pickedNames));
    notify(`${pickedNames.length} 人を「${project.name}」の名簿に入れました。`);
    endSelect();
  };

  const bulkActive = () => {
    const toActive = pickedAllInactive;
    update((s) => updatePlayers(s, pickedNames, { active: toActive }));
    notify(toActive ? `${pickedNames.length} 人の休会を解除しました。` : `${pickedNames.length} 人を休会中にしました。`);
    endSelect();
  };

  const bulkTeam = (team: string) => {
    update((s) => updatePlayers(s, pickedNames, { team: team || null }));
    notify(`${pickedNames.length} 人の所属を「${team || "なし"}」にしました。`);
    setTeamSheet(false);
    endSelect();
  };

  const bulkDelete = () => {
    const played = pickedNames.filter((n) => playedAnywhere(state, n));
    const targets = pickedNames.filter((n) => !played.includes(n));
    if (targets.length === 0) {
      notify("選んだ人はみな試合に出ているので削除できません。代わりに休会中にしてください。");
      return;
    }
    const note = played.length ? `\n試合に出ている ${played.length} 人（${played.slice(0, 3).join("・")}${played.length > 3 ? " ほか" : ""}）は削除せずに残します。` : "";
    if (!confirm(`${targets.length} 人をデータベースから削除しますか？${note}`)) return;
    update((s) => deletePlayers(s, targets));
    notify(`${targets.length} 人を削除しました。`);
    endSelect();
  };

  const exportFile = async (kind: "json" | "csv") => {
    const name = `メンバー_${todayStamp()}.${kind}`;
    const [text, type] = kind === "json" ? [databaseJson(state), "application/json"] : [databaseCsv(state), "text/csv"];
    if (await shareText(name, text, type)) return;
    downloadText(name, text, type);
  };

  const importFile = async (file: File) => {
    try {
      const patches = parseDatabaseFile(await file.arrayBuffer());
      const known = new Set(state.db.map((p) => p.name));
      const nNew = patches.filter((x) => !known.has(x.name)).length;
      const nOld = patches.length - nNew;
      const msg = [nNew && `新しく ${nNew} 人を登録`, nOld && `登録済みの ${nOld} 人をファイルの内容で上書き`].filter(Boolean).join("し、");
      if (!confirm(`${file.name} から、${msg}します。よろしいですか？（名簿は変わりません）`)) return;
      update((s) => mergePlayerPatches(s, patches));
      notify(`${patches.length} 人を読み込みました。`);
    } catch (e) {
      notify(`読み込めませんでした: ${(e as Error).message}`);
    }
  };

  const row = (p: Player) => {
    if (selecting) {
      return (
        <label class={"member" + (p.active ? "" : " off")} key={p.name} style="cursor:pointer">
          <span class="who">
            <span class="nm">{p.name}</span>
            <span class="tm">{p.team ?? "所属なし"}{p.active ? "" : "・休会中"}{memberSet.has(p.name) ? "・名簿入り" : ""}</span>
          </span>
          <span class="num"><b>{Math.round(p.rating)}</b></span>
          <span class="tick">
            <input type="checkbox" checked={picked.has(p.name)} onChange={() => togglePick(p.name)} aria-label={`${p.name}を選ぶ`} />
          </span>
        </label>
      );
    }
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
  if (teamSheet) return <BulkTeamSheet teams={teams} count={pickedNames.length} onApply={bulkTeam} onClose={() => setTeamSheet(false)} />;

  return (
    <Sheet title="メンバーのデータベース" eyebrow={`${state.db.length} 人・全プロジェクト共通`} onClose={onClose}>
      {!selecting && (
        <div class="row">
          <input class="grow" type="text" placeholder="名前" aria-label="名前" value={newName} onInput={(e) => setNewName((e.target as HTMLInputElement).value)} onKeyDown={(e) => e.key === "Enter" && addPlayer()} />
          <input type="number" style="width:88px" inputMode="numeric" aria-label="レート" value={newRating} onInput={(e) => setNewRating((e.target as HTMLInputElement).value)} />
          <button class="btn primary" onClick={addPlayer} disabled={!newName.trim()}>登録</button>
        </div>
      )}
      {state.db.length === 0 ? (
        <div class="empty">登録がありません</div>
      ) : (
        <>
          {(state.db.length > 8 || teams.length > 0) && (
            <div class="row">
              {state.db.length > 8 && (
                <label class="search grow">
                  <SearchIcon />
                  <input type="search" placeholder="名前や所属で探す" aria-label="名前や所属で探す" value={query} onInput={(e) => setQuery((e.target as HTMLInputElement).value)} />
                </label>
              )}
              {teams.length > 0 && (
                <select class={state.db.length > 8 ? "" : "grow"} style={state.db.length > 8 ? "width:144px;flex:none" : ""} aria-label="所属で絞り込む" value={teamFilter} onChange={(e) => setTeamFilter((e.target as HTMLSelectElement).value)}>
                  <option value="">すべての所属</option>
                  {teams.map((t) => <option key={t} value={t}>{t}</option>)}
                  <option value={NO_TEAM}>所属なし</option>
                </select>
              )}
            </div>
          )}
          <div class="seg" role="radiogroup" aria-label="並べ方" style="display:grid">
            {SORTS.map(([k, l]) => (
              <button key={k} role="radio" aria-checked={sort === k} class={sort === k ? "on" : ""} onClick={() => setSort(k)}>{l}</button>
            ))}
          </div>
          <div class="row between">
            {selecting ? (
              <>
                <button class="btn text" onClick={() => setPicked(allVisiblePicked ? new Set() : new Set(visible.map((p) => p.name)))} disabled={visible.length === 0}>
                  {allVisiblePicked ? "選択を外す" : `表示中の ${visible.length} 人を選ぶ`}
                </button>
                <button class="btn text" style="font-weight:600;color:var(--ink)" onClick={endSelect}>完了</button>
              </>
            ) : (
              <>
                <span class="muted">{shown.length === state.db.length ? `${state.db.length} 人` : `${shown.length} / ${state.db.length} 人`}</span>
                <button class="btn text" onClick={() => setSelecting(true)}>選んでまとめて操作</button>
              </>
            )}
          </div>
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

      {selecting ? (
        <div class="bulk">
          <div class="muted">{pickedNames.length} 人を選択中</div>
          <div class="row">
            <button class="btn grow" onClick={bulkMembers} disabled={pickedNames.length === 0}>名簿へ</button>
            <button class="btn grow" onClick={() => setTeamSheet(true)} disabled={pickedNames.length === 0}>所属</button>
            <button class="btn grow" onClick={bulkActive} disabled={pickedNames.length === 0}>{pickedAllInactive ? "休会を解除" : "休会"}</button>
            <button class="btn grow" style="color:var(--danger)" onClick={bulkDelete} disabled={pickedNames.length === 0}>削除</button>
          </div>
        </div>
      ) : (
        <section class="section">
          <div class="section-h"><h2>ファイル</h2></div>
          <div class="panel">
            <button class="lrow" onClick={() => exportFile("csv")} disabled={state.db.length === 0}>
              <span class="body">
                <span>CSV で書き出す</span>
                <span class="sub">Excel で開いて直せます。直したものは下から読み込めます</span>
              </span>
              <span class="chev"><ChevronRight /></span>
            </button>
            <button class="lrow" onClick={() => exportFile("json")} disabled={state.db.length === 0}>
              <span class="body">
                <span>JSON で書き出す</span>
                <span class="sub">別の端末への引っ越し用。players.json と同じ形</span>
              </span>
              <span class="chev"><ChevronRight /></span>
            </button>
            <button class="lrow" onClick={() => fileRef.current?.click()}>
              <span class="body">
                <span>読み込んで足す</span>
                <span class="sub">CSV（名前・所属・レート・初期レート・休会の列）か JSON。同じ名前の人は上書き</span>
              </span>
              <span class="chev"><ChevronRight /></span>
            </button>
            <input ref={fileRef} type="file" accept=".csv,.json,text/csv,application/json" hidden onChange={(e) => { const f = (e.target as HTMLInputElement).files?.[0]; if (f) importFile(f); (e.target as HTMLInputElement).value = ""; }} />
          </div>
        </section>
      )}
    </Sheet>
  );
}

function BulkTeamSheet({ teams, count, onApply, onClose }: { teams: string[]; count: number; onApply: (team: string) => void; onClose: () => void }) {
  const [team, teamField] = useTeamField(teams, null);
  return (
    <Sheet title="所属をまとめて変える" eyebrow={`${count} 人`} onClose={onClose}>
      {teamField}
      <div class="actions">
        <span class="grow" />
        <button class="btn tall" onClick={onClose}>戻る</button>
        <button class="btn primary tall" onClick={() => onApply(team)}>{team ? `「${team}」にする` : "所属なしにする"}</button>
      </div>
    </Sheet>
  );
}

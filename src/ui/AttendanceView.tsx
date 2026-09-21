import { useMemo, useState } from "preact/hooks";
import type { ViewProps } from "../app";
import { countPlays } from "../core/dayEngine";
import { recalculateAll } from "../core/elo";
import { newPlayer, type Player } from "../core/models";
import { Sheet } from "./Sheet";

export function AttendanceView({ state, update, notify }: ViewProps) {
  const [newName, setNewName] = useState("");
  const [newRating, setNewRating] = useState("1500");
  const [editing, setEditing] = useState<Player | null>(null);

  const plays = useMemo(() => countPlays(state.players, state.matches), [state.players, state.matches]);
  const selected = new Set(state.selected);
  const active = state.players.filter((p) => p.active);
  const inactive = state.players.filter((p) => !p.active);
  const nSelected = active.filter((p) => selected.has(p.name)).length;

  const toggle = (name: string) =>
    update((s) => ({ ...s, selected: s.selected.includes(name) ? s.selected.filter((n) => n !== name) : [...s.selected, name] }));

  const addPlayer = () => {
    const name = newName.trim();
    if (!name) return;
    if (state.players.some((p) => p.name === name)) {
      notify("同じ名前の人がいます。");
      return;
    }
    const rating = Number(newRating);
    update((s) => ({
      ...s,
      players: [...s.players, newPlayer(name, Number.isFinite(rating) ? rating : 1500)],
      selected: [...s.selected, name],
    }));
    setNewName("");
    setNewRating("1500");
  };

  return (
    <>
      <div class="topbar">
        <div>
          <h1>出席</h1>
          <div class="sub">今日出る人にチェック。{nSelected} / {active.length} 人</div>
        </div>
        <div class="row">
          <button class="btn small" onClick={() => update((s) => ({ ...s, selected: s.players.filter((p) => p.active).map((p) => p.name) }))}>全員</button>
          <button class="btn small" onClick={() => update((s) => ({ ...s, selected: [] }))}>解除</button>
        </div>
      </div>

      <div class="card">
        <div class="row">
          <input class="grow" type="text" placeholder="名前を追加" value={newName} onInput={(e) => setNewName((e.target as HTMLInputElement).value)} onKeyDown={(e) => e.key === "Enter" && addPlayer()} />
          <input type="number" style="width:88px" inputMode="numeric" value={newRating} onInput={(e) => setNewRating((e.target as HTMLInputElement).value)} />
          <button class="btn primary" onClick={addPlayer} disabled={!newName.trim()}>追加</button>
        </div>
        <div class="muted" style="margin-top:6px">右の数字はレート。分からなければ 1500 のままで、あとから直せます。</div>
      </div>

      {active.length === 0 ? (
        <div class="empty">まだ誰もいません。上で名前を追加するか、設定から players.json を読み込んでください。</div>
      ) : (
        <div class="card list">
          {active.map((p) => (
            <div class="item" key={p.name}>
              <label class="check grow" style="min-height:0">
                <input type="checkbox" checked={selected.has(p.name)} onChange={() => toggle(p.name)} />
                <span class="grow">
                  <span style="font-weight:600">{p.name}</span>
                  {p.team && <span class="pill" style="margin-left:6px">{p.team}</span>}
                  <div class="muted">レート {Math.round(p.rating)}・出場 {plays.get(p.name) ?? 0}</div>
                </span>
              </label>
              <button class="btn small ghost" onClick={() => setEditing(p)}>編集</button>
            </div>
          ))}
        </div>
      )}

      {inactive.length > 0 && (
        <details class="card">
          <summary>欠席の人（{inactive.length}）</summary>
          <div class="list">
            {inactive.map((p) => (
              <div class="item" key={p.name}>
                <span class="grow muted">{p.name}</span>
                <button class="btn small ghost" onClick={() => setEditing(p)}>編集</button>
              </div>
            ))}
          </div>
        </details>
      )}

      {editing && <EditSheet player={editing} state={state} update={update} notify={notify} onClose={() => setEditing(null)} />}
    </>
  );
}

function EditSheet({ player, state, update, notify, onClose }: ViewProps & { player: Player; onClose: () => void }) {
  const [name, setName] = useState(player.name);
  const [rating, setRating] = useState(String(player.initial_rating));
  const [team, setTeam] = useState(player.team ?? "");
  const [active, setActive] = useState(player.active);
  const played = state.matches.some((m) => m.team_a.includes(player.name) || m.team_b.includes(player.name));

  const save = () => {
    const newName = name.trim();
    if (!newName) return;
    if (newName !== player.name && state.players.some((p) => p.name === newName)) {
      notify("同じ名前の人がいます。");
      return;
    }
    const r = Number(rating);
    update((s) => {
      const rename = (n: string) => (n === player.name ? newName : n);
      const players = s.players.map((p) =>
        p.name === player.name
          ? { ...p, name: newName, initial_rating: Number.isFinite(r) ? r : p.initial_rating, rating: Number.isFinite(r) ? r : p.rating, team: team.trim() || null, active }
          : p,
      );
      const matches = s.matches.map((m) => ({ ...m, team_a: m.team_a.map(rename), team_b: m.team_b.map(rename) }));
      const selected = s.selected.map(rename).filter((n) => active || n !== newName);
      if (s.config.elo_auto_update) {
        recalculateAll(players, matches, { kFactor: s.config.elo_k_factor, weakWeight: s.config.pair_weak_weight, gameScale: s.config.game_scale });
      }
      return { ...s, players, matches, selected };
    });
    onClose();
  };

  const remove = () => {
    if (played) {
      notify("試合に出ている人は消せません。欠席にしてください。");
      return;
    }
    if (!confirm(`${player.name} を削除しますか？`)) return;
    update((s) => ({ ...s, players: s.players.filter((p) => p.name !== player.name), selected: s.selected.filter((n) => n !== player.name) }));
    onClose();
  };

  return (
    <Sheet title="プレイヤーを編集" onClose={onClose}>
      <div class="stack">
        <label>
          <div class="muted">名前</div>
          <input type="text" value={name} onInput={(e) => setName((e.target as HTMLInputElement).value)} />
        </label>
        <label>
          <div class="muted">レート（初期値。現在 {Math.round(player.rating)}）</div>
          <input type="number" inputMode="numeric" value={rating} onInput={(e) => setRating((e.target as HTMLInputElement).value)} />
        </label>
        <label>
          <div class="muted">所属（同チーム回避に使う。空でもよい）</div>
          <input type="text" value={team} onInput={(e) => setTeam((e.target as HTMLInputElement).value)} />
        </label>
        <label class="check">
          <input type="checkbox" checked={active} onChange={(e) => setActive((e.target as HTMLInputElement).checked)} />
          出席している
        </label>
        <div class="row between">
          <button class="btn danger" onClick={remove}>削除</button>
          <div class="row">
            <button class="btn" onClick={onClose}>キャンセル</button>
            <button class="btn primary" onClick={save}>保存</button>
          </div>
        </div>
      </div>
    </Sheet>
  );
}

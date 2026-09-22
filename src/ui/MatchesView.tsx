import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import type { ViewProps } from "../app";
import { GoodDayEngine } from "../core/dayEngine";
import { pairingToMatch, type Match, type MatchPairing, type MatchResult } from "../core/models";
import { gameWinProb, pairStrength } from "../core/winModel";
import { availablePlayers, recalcRatings, updateCurrent, type Project } from "../store";
import { Sheet } from "./Sheet";
import { Wheel, type WheelOption } from "./Wheel";

interface Proposal {
  pairings: MatchPairing[];
  explains: string[];
  index: number;
}

export function MatchesView({ state, project, update, updateProject, notify }: ViewProps) {
  const [proposal, setProposal] = useState<Proposal | null>(null);
  const [editing, setEditing] = useState<Match | null>(null);

  const available = useMemo(() => availablePlayers(state, project), [state, project]);
  const inPlay = project.matches.filter((m) => m.in_play).length;
  const courts = Math.max(1, project.config.courts);

  const propose = () => {
    if (available.length < 4) {
      notify("試合に入れる人が 4 人未満です。メンバータブでチェックしてください。");
      return;
    }
    const engine = new GoodDayEngine(available, project.matches, {
      config: project.config,
      courts,
      freeCourts: Math.max(1, courts - inPlay),
      allPlayers: state.db,
    });
    const pairings = engine.generateMatches(project.settings.rating_match, project.settings.avoid_same_team);
    if (pairings.length === 0) {
      notify("この条件では試合を組めませんでした。");
      setProposal(null);
      return;
    }
    setProposal({ pairings, explains: pairings.map((p) => engine.explain(p)), index: 0 });
  };

  const adopt = () => {
    if (!proposal) return;
    const m = pairingToMatch(proposal.pairings[proposal.index]);
    updateProject((p) => ({ ...p, matches: [...p.matches, m] }));
    setProposal(null);
  };

  /** 並べ替えの確定。順番は Elo の再計算にも効く */
  const reorder = (ids: string[]) =>
    update((s) => {
      const byId = new Map(s.projects.find((p) => p.id === project.id)?.matches.map((m) => [m.id, m]) ?? []);
      const matches = ids.map((id) => byId.get(id)).filter((m): m is Match => m !== undefined);
      if (matches.length !== byId.size) return s;
      return recalcRatings(updateCurrent(s, (p) => ({ ...p, matches })));
    });

  const current = proposal ? proposal.pairings[proposal.index] : null;
  const prob = current ? winProb(current, project) : null;

  return (
    <>
      <div class="topbar">
        <div>
          <h1>{project.name}</h1>
          <div class="sub">
            {available.length} 人・{courts} 面{inPlay > 0 && `・進行中 ${inPlay}`}
          </div>
        </div>
        <button class="btn primary" onClick={propose} disabled={available.length < 4}>次の試合を組む</button>
      </div>

      {current && proposal && (
        <div class="card proposal">
          <div class="muted">案 {proposal.index + 1} / {proposal.pairings.length}</div>
          <div class="team">{current[0][0].name}・{current[0][1].name}</div>
          <div class="vs">vs</div>
          <div class="team">{current[1][0].name}・{current[1][1].name}</div>
          {prob !== null && project.settings.rating_match && <div class="prob">上のペアが 1 ゲームを取る確率 {Math.round(prob * 100)}%</div>}
          <div class="muted" style="margin-top:4px">{proposal.explains[proposal.index]}</div>
          <div class="row" style="margin-top:12px; justify-content:center">
            <button class="btn" onClick={() => setProposal(null)}>閉じる</button>
            <button class="btn" onClick={() => setProposal({ ...proposal, index: (proposal.index + 1) % proposal.pairings.length })} disabled={proposal.pairings.length < 2}>別の案</button>
            <button class="btn primary" onClick={adopt}>この組み合わせにする</button>
          </div>
        </div>
      )}

      {project.matches.length === 0 ? (
        <div class="empty">試合がありません</div>
      ) : (
        <MatchList matches={project.matches} courts={courts} onOpen={setEditing} onReorder={reorder} />
      )}

      {editing && <ResultSheet match={editing} state={state} project={project} update={update} updateProject={updateProject} notify={notify} onClose={() => setEditing(null)} />}
    </>
  );
}

const LONG_PRESS_MS = 450;
const MOVE_SLOP = 10;

type Item = { kind: "round"; round: number; key: string } | { kind: "match"; m: Match; no: number; key: string };

interface Drag {
  id: string;
  /** 表示順（新しい順）。指の動きに合わせて入れ替える */
  order: string[];
  y: number;
  raf: number;
}

/**
 * 試合一覧。新しい順に並べ、コート数ごとにラウンドで区切る（古い方からラウンド 1）。
 * 長押しでその試合をつかみ、そのまま上下に動かして順番を入れ替える。
 */
function MatchList({ matches, courts, onOpen, onReorder }: { matches: Match[]; courts: number; onOpen: (m: Match) => void; onReorder: (ids: string[]) => void }) {
  const [dragOrder, setDragOrder] = useState<string[] | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const press = useRef<{ id: string; pointerId: number; x: number; y: number; timer: number; target: HTMLElement } | null>(null);
  const drag = useRef<Drag | null>(null);
  const suppressClick = useRef(false);
  const latest = useRef({ matches, onReorder });
  latest.current = { matches, onReorder };

  const byId = useMemo(() => new Map(matches.map((m) => [m.id, m])), [matches]);
  const indexOf = useMemo(() => new Map(matches.map((m, i) => [m.id, i])), [matches]);
  const displayIds = dragOrder ?? [...matches].reverse().map((m) => m.id);

  /** 指の位置に合わせて、つかんでいる試合を他の行の間に入れる */
  const moveTo = (y: number) => {
    const d = drag.current;
    const el = listRef.current;
    if (!d || !el) return;
    const rows = [...el.querySelectorAll<HTMLElement>(".match[data-id]")].filter((r) => r.dataset.id !== d.id);
    let idx = 0;
    for (const r of rows) {
      const rect = r.getBoundingClientRect();
      if (y > rect.top + rect.height / 2) idx++;
    }
    const rest = d.order.filter((x) => x !== d.id);
    const next = [...rest.slice(0, idx), d.id, ...rest.slice(idx)];
    if (next.some((x, i) => x !== d.order[i])) {
      d.order = next;
      setDragOrder(next);
    }
  };

  const endDrag = (commit: boolean) => {
    const d = drag.current;
    if (!d) return;
    cancelAnimationFrame(d.raf);
    drag.current = null;
    setDragId(null);
    setDragOrder(null);
    if (commit) {
      const { matches: cur, onReorder: apply } = latest.current;
      const ids = [...d.order].reverse();
      if (ids.some((x, i) => cur[i]?.id !== x)) apply(ids);
    }
    // 直後の click で結果入力が開かないように
    setTimeout(() => (suppressClick.current = false), 0);
  };

  const cancelPress = () => {
    if (press.current) {
      clearTimeout(press.current.timer);
      press.current = null;
    }
  };

  const startDrag = (id: string, y: number, target: HTMLElement, pointerId: number) => {
    try {
      target.setPointerCapture(pointerId);
    } catch {
      // 捕まえられなくても、リスト内で動かす分には困らない
    }
    if (typeof navigator !== "undefined" && "vibrate" in navigator) navigator.vibrate?.(30);
    suppressClick.current = true;
    const order = [...latest.current.matches].reverse().map((m) => m.id);
    drag.current = { id, order, y, raf: 0 };
    setDragId(id);
    setDragOrder(order);
    // 画面の端に近いときは、指を止めていてもスクロールする
    const tick = () => {
      const d = drag.current;
      if (!d) return;
      const edge = 72;
      const h = window.innerHeight;
      if (d.y < edge) window.scrollBy(0, -Math.ceil((edge - d.y) / 6));
      else if (d.y > h - edge) window.scrollBy(0, Math.ceil((d.y - (h - edge)) / 6));
      moveTo(d.y);
      d.raf = requestAnimationFrame(tick);
    };
    drag.current.raf = requestAnimationFrame(tick);
  };

  // 並べ替え中はスクロールさせない（touch-action は触り始めた時点で決まるので、ここで止める）。
  // 指がリストの外で離れたときの取りこぼしも window で拾う
  useEffect(() => {
    const el = listRef.current;
    if (!el) return;
    const onTouchMove = (e: TouchEvent) => {
      if (drag.current) e.preventDefault();
    };
    const onUp = () => {
      cancelPress();
      endDrag(true);
    };
    const onCancel = () => {
      cancelPress();
      endDrag(false);
    };
    el.addEventListener("touchmove", onTouchMove, { passive: false });
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onCancel);
    return () => {
      el.removeEventListener("touchmove", onTouchMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onCancel);
    };
  }, []);

  const onPointerDown = (m: Match) => (e: PointerEvent) => {
    if (e.button !== 0 || drag.current) return;
    cancelPress();
    const target = e.currentTarget as HTMLElement;
    const timer = window.setTimeout(() => {
      const p = press.current;
      press.current = null;
      if (p) startDrag(p.id, p.y, p.target, p.pointerId);
    }, LONG_PRESS_MS);
    press.current = { id: m.id, pointerId: e.pointerId, x: e.clientX, y: e.clientY, timer, target };
  };

  const onPointerMove = (e: PointerEvent) => {
    const p = press.current;
    if (p && (Math.abs(e.clientX - p.x) > MOVE_SLOP || Math.abs(e.clientY - p.y) > MOVE_SLOP)) cancelPress();
    const d = drag.current;
    if (d) {
      d.y = e.clientY;
      moveTo(e.clientY);
    }
  };

  const onClick = (m: Match) => {
    if (suppressClick.current) return;
    onOpen(m);
  };

  // ラウンドで区切る。表示は新しい順なので、ラウンドも大きい方から
  const items: Item[] = [];
  let lastRound = -1;
  displayIds.forEach((id, pos) => {
    const m = byId.get(id);
    if (!m) return;
    // 並べ替え中は表示位置から、そうでなければ元の順番から番号を決める（どちらも同じになる）
    const no = dragOrder ? displayIds.length - pos : indexOf.get(id)! + 1;
    const round = Math.floor((no - 1) / courts) + 1;
    if (courts > 1 && round !== lastRound) {
      items.push({ kind: "round", round, key: `r${round}` });
      lastRound = round;
    }
    items.push({ kind: "match", m, no, key: m.id });
  });

  return (
    <div class={"card matchlist" + (dragId ? " reordering" : "")} ref={listRef} onContextMenu={(e) => e.preventDefault()} onPointerMove={onPointerMove}>
      {items.map((it) =>
        it.kind === "round" ? (
          <div class="round-h" key={it.key}>ラウンド {it.round}</div>
        ) : (
          <div
            class={"match" + (it.m.in_play ? " inplay" : "") + (dragId === it.m.id ? " dragging" : "")}
            key={it.key}
            data-id={it.m.id}
            onClick={() => onClick(it.m)}
            onPointerDown={onPointerDown(it.m)}
          >
            <div class="no">{it.no}{courts === 1 && <><br /><span style="font-size:10px">R{it.no}</span></>}</div>
            <div class="teams">
              <div class={it.m.result === "A" ? "win" : it.m.result === "B" ? "lose" : ""}>{it.m.team_a.join("・")}</div>
              <div class={it.m.result === "B" ? "win" : it.m.result === "A" ? "lose" : ""}>{it.m.team_b.join("・")}</div>
            </div>
            <div class="score">
              {it.m.games_a !== null && it.m.games_b !== null ? (
                <>{it.m.games_a}<br />{it.m.games_b}</>
              ) : it.m.in_play ? (
                <span class="pill play">進行中</span>
              ) : (
                <span class="pill">未入力</span>
              )}
            </div>
          </div>
        ),
      )}
    </div>
  );
}

function winProb(p: MatchPairing, project: Project): number {
  const sa = pairStrength(p[0][0].rating, p[0][1].rating, project.config.pair_weak_weight);
  const sb = pairStrength(p[1][0].rating, p[1][1].rating, project.config.pair_weak_weight);
  return gameWinProb(sa, sb, project.config.game_scale);
}

/** ゲーム数の選択肢。先頭は「未入力」 */
const GAME_OPTIONS: WheelOption<number | null>[] = [{ value: null, label: "－" }, ...Array.from({ length: 10 }, (_, i) => ({ value: i, label: String(i) }))];

function ResultSheet({ match, project, update, onClose }: ViewProps & { match: Match; onClose: () => void }) {
  const [ga, setGa] = useState<number | null>(match.games_a);
  const [gb, setGb] = useState<number | null>(match.games_b);
  const [inPlay, setInPlay] = useState(match.in_play);
  const no = project.matches.findIndex((m) => m.id === match.id) + 1;

  const save = () => {
    const a = ga;
    const b = gb;
    const both = a !== null && b !== null;
    const result: MatchResult = both ? (a > b ? "A" : a < b ? "B" : "D") : null;
    update((s) =>
      recalcRatings(
        updateCurrent(s, (p) => ({
          ...p,
          matches: p.matches.map((m) =>
            m.id === match.id
              ? { ...m, games_a: both ? a : null, games_b: both ? b : null, result, in_play: both ? false : inPlay, updated_at: Date.now() / 1000 }
              : m,
          ),
        })),
      ),
    );
    onClose();
  };

  const remove = () => {
    if (!confirm(`試合 ${no} を削除しますか？`)) return;
    update((s) => recalcRatings(updateCurrent(s, (p) => ({ ...p, matches: p.matches.filter((m) => m.id !== match.id) }))));
    onClose();
  };

  return (
    <Sheet title={`試合 ${no} の結果`} onClose={onClose}>
      <div class="stack">
        <div class="scorebox">
          <div class="who">{match.team_a.join("・")}</div>
          <div class="muted">vs</div>
          <div class="who">{match.team_b.join("・")}</div>
          <Wheel class="score" options={GAME_OPTIONS} value={ga} onChange={setGa} />
          <div class="muted">-</div>
          <Wheel class="score" options={GAME_OPTIONS} value={gb} onChange={setGb} />
        </div>
        <label class="check">
          <input type="checkbox" checked={inPlay} onChange={(e) => setInPlay((e.target as HTMLInputElement).checked)} />
          進行中
        </label>
        <div class="row between">
          <button class="btn danger" onClick={remove}>削除</button>
          <div class="row">
            <button class="btn" onClick={() => { setGa(null); setGb(null); }}>結果を消す</button>
            <button class="btn primary" onClick={save}>保存</button>
          </div>
        </div>
      </div>
    </Sheet>
  );
}

import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import type { ViewProps } from "../app";
import { GoodDayEngine, notesOf } from "../core/dayEngine";
import { pairingToMatch, type Match, type MatchPairing, type MatchResult } from "../core/models";
import { gameWinProb, pairStrength } from "../core/winModel";
import { buildDashboard } from "../dashboard";
import { attendingPlayers, availablePlayers, memberPlayers, type Project } from "../store";
import { CheckIcon, ChevronDown, ChevronLeft, ChevronRight, LayersIcon, NoteIcon, PlusIcon } from "./icons";
import { PlanSheet } from "./PlanSheet";
import { ProjectsSheet, whenWhere } from "./ProjectSheets";
import { Sheet } from "./Sheet";
import { Wheel, type WheelOption } from "./Wheel";

interface Proposal {
  pairings: MatchPairing[];
  /** 組み合わせごとに諦めた点（あれば画面に出す） */
  notes: string[][];
  index: number;
}

/** コートに出す試合。null は空きコート */
type Slot = { m: Match; no: number } | null;

/**
 * コートの欄に出す試合を決める。
 * 進行中の印が付いた試合を先に入れ、残りの枠は「最新のコート数ぶんの試合のうち結果が未入力のもの」で埋める。
 * 並びは試合番号の順。枠が余ればそのコートは空き。
 */
function courtSlots(matches: Match[], courts: number): Slot[] {
  const indexed = matches.map((m, i) => ({ m, no: i + 1 }));
  const on = indexed.filter((x) => x.m.in_play);
  for (const x of indexed.slice(-courts)) {
    if (on.length >= courts) break;
    if (x.m.result === null && !x.m.in_play) on.push(x);
  }
  on.sort((a, b) => a.no - b.no);
  const slots: Slot[] = [...on];
  while (slots.length < courts) slots.push(null);
  return slots;
}

export function MatchesView(props: ViewProps) {
  const { state, project, updateProject, notify, go } = props;
  const [proposal, setProposal] = useState<Proposal | null>(null);
  const [editing, setEditing] = useState<Match | null>(null);
  const [switching, setSwitching] = useState(false);
  const [planning, setPlanning] = useState(false);

  const members = useMemo(() => memberPlayers(state, project), [state, project]);
  const attending = useMemo(() => attendingPlayers(state, project), [state, project]);
  const available = useMemo(() => availablePlayers(state, project), [state, project]);
  const inPlay = project.matches.filter((m) => m.in_play).length;
  const courts = Math.max(1, project.config.courts);
  const rounds = Math.ceil(project.matches.length / courts);
  const slots = courtSlots(project.matches, courts);
  const canPropose = available.length >= 4;

  // 待っている人と、連続で何ラウンド待っているか（集計と同じ計算）
  const dash = useMemo(() => buildDashboard(members, project.matches, project.config), [members, project.matches, project.config]);
  const waitOf = useMemo(() => new Map(dash.people.rows.map((r) => [r.name, r.current_wait])), [dash]);
  const waitCap = dash.people.meta.wait_cap;
  const onCourt = new Set(slots.flatMap((s) => (s ? [...s.m.team_a, ...s.m.team_b] : [])));
  const waiting = available
    .filter((p) => !onCourt.has(p.name))
    .map((p) => ({ name: p.name, wait: waitOf.get(p.name) ?? 0 }))
    .sort((a, b) => b.wait - a.wait);
  const longWait = (w: number) => w > 0 && w >= Math.max(1, waitCap - 1);

  const propose = () => {
    if (!canPropose) {
      notify("試合に入れる人が 4 人未満です。メンバータブでチェックしてください。");
      return;
    }
    const engine = new GoodDayEngine(available, project.matches, {
      config: project.config,
      courts,
      freeCourts: Math.max(1, courts - inPlay),
      allPlayers: state.db,
    });
    const cands = engine.generateCandidates(project.settings.rating_match, project.settings.avoid_same_team);
    if (cands.length === 0) {
      notify("この条件では試合を組めませんでした。");
      setProposal(null);
      return;
    }
    setProposal({ pairings: cands.map((c) => c.match), notes: cands.map(notesOf), index: 0 });
  };

  const adopt = () => {
    if (!proposal) return;
    const m = pairingToMatch(proposal.pairings[proposal.index]);
    updateProject((p) => ({ ...p, matches: [...p.matches, m] }));
    setProposal(null);
  };

  /** 並べ替えの確定。順番は Elo の再計算にも効く */
  const reorder = (ids: string[]) =>
    updateProject((p) => {
      const byId = new Map(p.matches.map((m) => [m.id, m]));
      const matches = ids.map((id) => byId.get(id)).filter((m): m is Match => m !== undefined);
      return matches.length === byId.size ? { ...p, matches } : p;
    });

  // 採用済みの試合の勝率予想（いまのレートで計算）
  const ratings = useMemo(() => new Map(state.db.map((p) => [p.name, p.rating])), [state.db]);
  const probOf = (m: Match): number | null => {
    if (!project.settings.rating_match || m.team_a.length !== 2 || m.team_b.length !== 2) return null;
    const r = [...m.team_a, ...m.team_b].map((n) => ratings.get(n));
    if (r.some((x) => x === undefined)) return null;
    const [a1, a2, b1, b2] = r as number[];
    return gameWinProb(pairStrength(a1, a2, project.config.pair_weak_weight), pairStrength(b1, b2, project.config.pair_weak_weight), project.config.game_scale);
  };

  const firstIdle = slots.findIndex((s) => s === null);
  const proposeLabel = <><PlusIcon />次の試合を組む</>;

  return (
    <>
      <header class="head" style="align-items:center">
        <button class="switcher" aria-label="プロジェクトを切り替え" onClick={() => setSwitching(true)}>
          <span class="eyebrow">{whenWhere(project)}</span>
          <span class="title"><span>{project.name}</span><ChevronDown /></span>
        </button>
        <button class="btn icon" aria-label="まとめて組む" title="まとめて組む" onClick={() => setPlanning(true)} disabled={attending.length < 4}>
          <LayersIcon />
        </button>
      </header>

      <div class="strip">
        <div><div class="k">ラウンド</div><div class="v">{rounds}</div></div>
        <div><div class="k">参加</div><div class="v">{attending.length}<small>/{members.length}</small></div></div>
        <div><div class="k">試合</div><div class="v">{project.matches.length}</div></div>
      </div>

      {members.length === 0 ? (
        <div class="panel empty">
          まず名簿を作りましょう。メンバータブで、試合に入れる人を追加します。
          <div><button class="btn primary" onClick={() => go("members")}>メンバーを追加</button></div>
        </div>
      ) : (
        <section class="section">
          <div class="section-h"><h2>コート</h2>{!canPropose && <span class="note">参加が 4 人以上になると組めます</span>}</div>
          <div class="panel">
            {slots.map((s, i) =>
              s ? (
                <CourtCard key={s.m.id} court={i + 1} no={s.no} m={s.m} p={probOf(s.m)} onOpen={() => setEditing(s.m)} />
              ) : (
                <div class="court idle" key={`idle${i}`}>
                  <span class="no idle">{i + 1}</span>
                  <div class="body">
                    <span>空き</span>
                    <button class="btn primary" onClick={propose} disabled={!canPropose}>{proposeLabel}</button>
                  </div>
                </div>
              ),
            )}
            {firstIdle < 0 && (
              <div class="more-go">
                <button class="btn" onClick={propose} disabled={!canPropose}>{proposeLabel}</button>
              </div>
            )}
          </div>
        </section>
      )}

      {members.length > 0 && waiting.length > 0 && (
        <section class="section">
          <div class="section-h"><h2>待機 <span class="mono">{waiting.length}</span></h2><span class="note">数字は連続待ちのラウンド数</span></div>
          <div class="chips">
            {waiting.map((w) => (
              <span class={"chip" + (longWait(w.wait) ? " long" : "")} key={w.name}>{w.name}<span class="n">{w.wait}</span></span>
            ))}
          </div>
        </section>
      )}

      {project.matches.length > 0 && (
        <section class="section">
          <div class="section-h"><h2>記録</h2><span class="note">長押しで並べ替え</span></div>
          <MatchList matches={project.matches} courts={courts} onOpen={setEditing} onReorder={reorder} />
        </section>
      )}

      {proposal && (
        <ProposalSheet
          proposal={proposal}
          project={project}
          eyebrow={[firstIdle >= 0 ? `コート ${firstIdle + 1}` : "", `#${project.matches.length + 1}`].filter(Boolean).join("・")}
          waitOf={new Map(waiting.map((w) => [w.name, w.wait]))}
          onMove={(d) => setProposal({ ...proposal, index: (proposal.index + d + proposal.pairings.length) % proposal.pairings.length })}
          onAdopt={adopt}
          onClose={() => setProposal(null)}
        />
      )}
      {editing && <ResultSheet {...props} match={editing} courts={courts} onClose={() => setEditing(null)} />}
      {switching && <ProjectsSheet {...props} onClose={() => setSwitching(false)} />}
      {planning && <PlanSheet {...props} onClose={() => setPlanning(false)} />}
    </>
  );
}

function CourtCard({ court, no, m, p, onOpen }: { court: number; no: number; m: Match; p: number | null; onOpen: () => void }) {
  return (
    <>
      <div class="court">
        <span class="no">{court}</span>
        <div class="body">
          <div class="meta">
            <span class="mono">#{no}</span>
            {m.in_play ? <span class="status live">進行中</span> : <span class="status">結果待ち</span>}
          </div>
          <div class="side">
            <span class="bar a" />
            <span class="name">{m.team_a.join("・")}</span>
            {p !== null && <span class="pct">{Math.round(p * 100)}%</span>}
          </div>
          <div class="side">
            <span class="bar b" />
            <span class="name">{m.team_b.join("・")}</span>
            {p !== null && <span class="pct">{Math.round((1 - p) * 100)}%</span>}
          </div>
        </div>
      </div>
      <button class="court-go" onClick={onOpen}>結果を入力<ChevronRight /></button>
    </>
  );
}

function ProposalSheet({ proposal, project, eyebrow, waitOf, onMove, onAdopt, onClose }: {
  proposal: Proposal;
  project: Project;
  eyebrow: string;
  /** 待機中の人（コートにいない人）の連続待ち */
  waitOf: Map<string, number>;
  onMove: (d: number) => void;
  onAdopt: () => void;
  onClose: () => void;
}) {
  const current = proposal.pairings[proposal.index];
  const notes = proposal.notes[proposal.index];
  const showProb = project.settings.rating_match;
  const prob = winProb(current, project);
  const pa = Math.round(prob * 100);
  // 待機中でいちばん長く待っている人のうち、この案に入る人
  const four = [...current[0], ...current[1]].map((p) => p.name);
  const maxWait = Math.max(0, ...waitOf.values());
  const longest = maxWait > 0 ? four.filter((n) => waitOf.get(n) === maxWait) : [];

  return (
    <Sheet title="次の試合" eyebrow={eyebrow} onClose={onClose}>
      <div class="matchup">
        <div class="team">
          <span class="bar a" />
          <span class="names">{current[0][0].name}・{current[0][1].name}</span>
          {showProb && <span class="pct">{pa}<small>%</small></span>}
        </div>
        {showProb && <div class="split"><div class="a" style={`width:${pa}%`} /><div class="b" /></div>}
        <div class="team">
          <span class="bar b" />
          <span class="names">{current[1][0].name}・{current[1][1].name}</span>
          {showProb && <span class="pct">{100 - pa}<small>%</small></span>}
        </div>
      </div>
      {showProb && <div class="foot" style="margin-top:-10px">右の数字はレートから見た 1 ゲームの勝率予想</div>}

      <ul class="checks">
        {longest.length > 0 && <li><CheckIcon />待ちの長い {longest.join("・")} が入る（{maxWait} ラウンド）</li>}
        {notes.length === 0 ? (
          <li><CheckIcon />気になる点なし</li>
        ) : (
          notes.map((n) => <li class="warn" key={n}><NoteIcon />{n}</li>)
        )}
      </ul>

      <div class="pager">
        <button class="btn icon" aria-label="前の案" onClick={() => onMove(-1)} disabled={proposal.pairings.length < 2}><ChevronLeft /></button>
        <span class="mono">案 {proposal.index + 1} / {proposal.pairings.length}</span>
        <button class="btn icon" aria-label="次の案" onClick={() => onMove(1)} disabled={proposal.pairings.length < 2}><ChevronRight /></button>
      </div>
      <button class="btn primary tall block" onClick={onAdopt}>この組み合わせにする</button>
    </Sheet>
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
 * 試合の記録。新しい順に並べ、コート数ごとにラウンドで区切る（古い方からラウンド 1）。
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
    const rows = [...el.querySelectorAll<HTMLElement>(".rec[data-id]")].filter((r) => r.dataset.id !== d.id);
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
    <div class={"panel matchlist" + (dragId ? " reordering" : "")} ref={listRef} onContextMenu={(e) => e.preventDefault()} onPointerMove={onPointerMove}>
      {items.map((it) =>
        it.kind === "round" ? (
          <div class="round-h" key={it.key}>ラウンド {it.round}</div>
        ) : (
          <button
            class={"rec" + (dragId === it.m.id ? " dragging" : "")}
            key={it.key}
            data-id={it.m.id}
            onClick={() => onClick(it.m)}
            onPointerDown={onPointerDown(it.m)}
          >
            <span class="no">#{it.no}</span>
            <span class={it.m.result === "A" ? "win" : it.m.result === "B" ? "lose" : ""}>{it.m.team_a.join("・")}</span>
            <span class="mid">
              {it.m.games_a !== null && it.m.games_b !== null ? (
                <span class="score">
                  <span class={it.m.games_a < it.m.games_b ? "lo" : ""}>{it.m.games_a}</span>
                  <span class="dash">-</span>
                  <span class={it.m.games_b < it.m.games_a ? "lo" : ""}>{it.m.games_b}</span>
                </span>
              ) : it.m.in_play ? (
                <span class="tag live">進行中</span>
              ) : (
                <span class="tag">未入力</span>
              )}
            </span>
            <span class={"t-b " + (it.m.result === "B" ? "win" : it.m.result === "A" ? "lose" : "")}>{it.m.team_b.join("・")}</span>
          </button>
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

function ResultSheet({ match, courts, project, updateProject, onClose }: ViewProps & { match: Match; courts: number; onClose: () => void }) {
  const [ga, setGa] = useState<number | null>(match.games_a);
  const [gb, setGb] = useState<number | null>(match.games_b);
  const [inPlay, setInPlay] = useState(match.in_play);
  const no = project.matches.findIndex((m) => m.id === match.id) + 1;
  const round = Math.floor((no - 1) / courts) + 1;
  const a = match.team_a.join("・");
  const b = match.team_b.join("・");
  const verdict = ga === null || gb === null ? "－" : ga > gb ? `${a} の勝ち` : ga < gb ? `${b} の勝ち` : "引き分け";

  const save = () => {
    const both = ga !== null && gb !== null;
    const result: MatchResult = both ? (ga > gb ? "A" : ga < gb ? "B" : "D") : null;
    updateProject((p) => ({
      ...p,
      matches: p.matches.map((m) =>
        m.id === match.id
          ? { ...m, games_a: both ? ga : null, games_b: both ? gb : null, result, in_play: both ? false : inPlay, updated_at: Date.now() / 1000 }
          : m,
      ),
    }));
    onClose();
  };

  const remove = () => {
    if (!confirm(`試合 #${no} を削除しますか？`)) return;
    updateProject((p) => ({ ...p, matches: p.matches.filter((m) => m.id !== match.id) }));
    onClose();
  };

  return (
    <Sheet title="結果を入力" eyebrow={`R${round}・#${no}`} onClose={onClose}>
      <div class="score-names">
        <div><span class="bar a" style="width:3px;height:18px;flex:none" />{a}</div>
        <span />
        <div><span class="bar b" style="width:3px;height:18px;flex:none" />{b}</div>
      </div>
      <div class="score-wheels" style="margin-top:-8px">
        <Wheel class="score" options={GAME_OPTIONS} value={ga} onChange={setGa} />
        <span class="dash">-</span>
        <Wheel class="score" options={GAME_OPTIONS} value={gb} onChange={setGb} />
      </div>
      <div class="verdict"><span class="k">判定</span><span class="v">{verdict}</span></div>
      <label class="check">
        <input type="checkbox" checked={inPlay} onChange={(e) => setInPlay((e.target as HTMLInputElement).checked)} />
        進行中にしておく
      </label>
      <div class="actions">
        <button class="btn danger tall" onClick={remove}>試合を削除</button>
        <span class="grow" />
        <button class="btn tall" onClick={() => { setGa(null); setGb(null); }}>クリア</button>
        <button class="btn primary tall" onClick={save}>保存</button>
      </div>
    </Sheet>
  );
}

import { useMemo, useState } from "preact/hooks";
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
import { Sortable } from "./Sortable";
import { Wheel, type WheelOption } from "./Wheel";

interface Proposal {
  pairings: MatchPairing[];
  /** 組み合わせごとに諦めた点（あれば画面に出す） */
  notes: string[][];
  index: number;
}

const isDone = (m: Match) => m.result !== null;

/**
 * 試合タブ。試合を 3 つに分けて出す。
 *   進行中 … 「開始」した試合（in_play）。結果を保存すると終了に移る
 *   待機   … 組んだがまだコートに入っていない試合。組んだ順に上から入る
 *   終了   … 結果を入れた試合
 * 試合の並び（＝ラウンドの数え方）はプロジェクトの matches の順のまま。待機と終了は長押しで並べ替えられる。
 */
export function MatchesView(props: ViewProps) {
  const { state, project, updateProject, notify, go } = props;
  const [proposal, setProposal] = useState<Proposal | null>(null);
  const [editing, setEditing] = useState<Match | null>(null);
  const [switching, setSwitching] = useState(false);
  const [planning, setPlanning] = useState(false);

  const members = useMemo(() => memberPlayers(state, project), [state, project]);
  const attending = useMemo(() => attendingPlayers(state, project), [state, project]);
  const available = useMemo(() => availablePlayers(state, project), [state, project]);
  const courts = Math.max(1, project.config.courts);

  const noOf = useMemo(() => new Map(project.matches.map((m, i) => [m.id, i + 1])), [project.matches]);
  const roundOf = (no: number) => Math.floor((no - 1) / courts) + 1;
  const inPlay = project.matches.filter((m) => m.in_play && !isDone(m));
  const queued = project.matches.filter((m) => !m.in_play && !isDone(m));
  const done = project.matches.filter(isDone);

  // 案に入れる人。
  //   空いたコートにすぐ入る試合（待機が空でコートに空きがある）… 進行中の人は外す（これまでどおり）
  //   待機の後ろに並ぶ試合 … 進行中の人も入れる。ただし同じラウンドの試合にすでに入っている人は外す
  const forNow = queued.length === 0 && inPlay.length < courts;
  const candidates = useMemo(() => {
    if (forNow) return available;
    const n = project.matches.length;
    const sameRound = new Set(project.matches.slice(n - (n % courts)).flatMap((m) => [...m.team_a, ...m.team_b]));
    return attending.filter((p) => !sameRound.has(p.name));
  }, [forNow, available, attending, project.matches, courts]);
  const canPropose = candidates.length >= 4;

  // 出番待ちの人：コートに入っていない参加者。連続で休んだラウンド数は、始まった試合（進行中と終了）だけで数える
  const started = useMemo(() => project.matches.filter((m) => m.in_play || isDone(m)), [project.matches]);
  const dash = useMemo(() => buildDashboard(members, started, project.config), [members, started, project.config]);
  const waitOf = useMemo(() => new Map(dash.people.rows.map((r) => [r.name, r.current_wait])), [dash]);
  const waitCap = dash.people.meta.wait_cap;
  const playing = new Set(inPlay.flatMap((m) => [...m.team_a, ...m.team_b]));
  const nextOf = (name: string) => queued.find((m) => m.team_a.includes(name) || m.team_b.includes(name));
  const resting = attending
    .filter((p) => !playing.has(p.name))
    .map((p) => ({ name: p.name, wait: waitOf.get(p.name) ?? 0, next: nextOf(p.name) }))
    .sort((a, b) => b.wait - a.wait || (a.next ? noOf.get(a.next.id)! : Infinity) - (b.next ? noOf.get(b.next.id)! : Infinity));
  const longWait = (w: number) => w > 0 && w >= Math.max(1, waitCap - 1);

  const propose = () => {
    if (!canPropose) {
      notify("組める人が 4 人未満です。メンバータブで参加を確認してください。");
      return;
    }
    const engine = new GoodDayEngine(candidates, project.matches, {
      config: project.config,
      courts,
      freeCourts: forNow ? Math.max(1, courts - inPlay.length) : 1,
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

  const start = (m: Match) => {
    const busy = [...m.team_a, ...m.team_b].filter((n) => playing.has(n));
    if (busy.length && !confirm(`${busy.join("・")} は進行中の試合に出ています。それでも開始しますか？`)) return;
    updateProject((p) => ({ ...p, matches: p.matches.map((x) => (x.id === m.id ? { ...x, in_play: true, updated_at: Date.now() / 1000 } : x)) }));
    if (inPlay.length >= courts) notify(`進行中が ${inPlay.length + 1} 試合になりました（${courts} 面）。`);
  };

  /**
   * 一部の試合（待機だけ・終了だけ）の順番を入れ替える。ほかの試合の位置はそのままで、
   * その試合たちがいた位置に新しい順で入れ直す。順番は Elo の再計算とラウンドの数え方にも効く
   */
  const reorderSubset = (chrono: string[]) =>
    updateProject((p) => {
      const set = new Set(chrono);
      const byId = new Map(p.matches.map((m) => [m.id, m]));
      if (chrono.some((id) => !byId.has(id)) || p.matches.filter((m) => set.has(m.id)).length !== chrono.length) return p;
      const rest = [...chrono];
      return { ...p, matches: p.matches.map((m) => (set.has(m.id) ? byId.get(rest.shift()!)! : m)) };
    });

  // 試合の勝率予想（いまのレートで計算）
  const ratings = useMemo(() => new Map(state.db.map((p) => [p.name, p.rating])), [state.db]);
  const probOf = (m: Match): number | null => {
    if (!project.settings.rating_match || m.team_a.length !== 2 || m.team_b.length !== 2) return null;
    const r = [...m.team_a, ...m.team_b].map((n) => ratings.get(n));
    if (r.some((x) => x === undefined)) return null;
    const [a1, a2, b1, b2] = r as number[];
    return gameWinProb(pairStrength(a1, a2, project.config.pair_weak_weight), pairStrength(b1, b2, project.config.pair_weak_weight), project.config.game_scale);
  };

  const byId = new Map(project.matches.map((m) => [m.id, m]));
  const nextNo = project.matches.length + 1;

  const row = (m: Match, kind: "play" | "queue") => {
    const no = noOf.get(m.id)!;
    const p = kind === "play" ? probOf(m) : null;
    return (
      <div class={"qrow" + (kind === "queue" ? " queued" : "")}>
        <button class="num" aria-label={`試合 ${no} を開く`} onClick={() => setEditing(m)}>
          <b>#{no}</b>
          <span>R{roundOf(no)}</span>
        </button>
        <button class="teams" onClick={() => setEditing(m)}>
          <span class="team-line"><span class="bar a" />{m.team_a.join("・")}{p !== null && <span class="pct">{Math.round(p * 100)}%</span>}</span>
          <span class="team-line"><span class="bar b" />{m.team_b.join("・")}{p !== null && <span class="pct">{Math.round((1 - p) * 100)}%</span>}</span>
        </button>
        {kind === "play" ? (
          <button class="btn primary" onClick={() => setEditing(m)}>結果</button>
        ) : (
          <button class="btn" onClick={() => start(m)}>開始</button>
        )}
      </div>
    );
  };

  return (
    <>
      <header class="head" style="align-items:center">
        <button class="switcher" aria-label="プロジェクトを切り替え" onClick={() => setSwitching(true)}>
          <span class="eyebrow">{whenWhere(project)}・参加 {attending.length}/{members.length}</span>
          <span class="title"><span>{project.name}</span><ChevronDown /></span>
        </button>
        <button class="btn icon" aria-label="まとめて組む" title="まとめて組む" onClick={() => setPlanning(true)} disabled={attending.length < 4}>
          <LayersIcon />
        </button>
      </header>

      {members.length === 0 ? (
        <div class="panel empty">
          まず名簿を作りましょう。メンバータブで、試合に入れる人を追加します。
          <div><button class="btn primary" onClick={() => go("members")}>メンバーを追加</button></div>
        </div>
      ) : (
        <>
          {inPlay.length > 0 && (
            <section class="section">
              <div class="section-h"><h2 class="live">進行中 <span class="mono">{inPlay.length}</span></h2><span class="mono">{inPlay.length} / {courts} 面</span></div>
              <div class="panel list">
                {inPlay.map((m) => <div key={m.id}>{row(m, "play")}</div>)}
              </div>
            </section>
          )}

          <section class="section">
            <div class="section-h">
              <h2>待機 <span class="mono">{queued.length}</span></h2>
              <span class="note">{queued.length ? "上から順に・コートに入ったら「開始」" : ""}</span>
            </div>
            <div class="panel">
              {queued.length > 0 && <Sortable ids={queued.map((m) => m.id)} onReorder={reorderSubset} render={(id) => row(byId.get(id)!, "queue")} />}
              <div class="panel-foot" style={queued.length ? "" : "border-top:0"}>
                <button class="btn tall block" onClick={propose} disabled={!canPropose}><PlusIcon />次の試合を組む</button>
                <div class="foot">
                  {canPropose
                    ? <>待機の最後（<span class="mono">#{nextNo}・R{roundOf(nextNo)}</span>）に入ります</>
                    : "組める人が 4 人未満です（メンバータブで参加を確認）"}
                </div>
              </div>
            </div>
          </section>

          {resting.length > 0 && (
            <section class="section">
              <div class="section-h"><h2>出番待ちの人 <span class="mono">{resting.length}</span></h2><span class="note">連続で休んだラウンド → 次の試合</span></div>
              <div class="chips">
                {resting.map((w) => (
                  <span class={"chip" + (longWait(w.wait) ? " long" : "")} key={w.name}>
                    {w.name}<span class="n">{w.wait}{w.next ? ` → #${noOf.get(w.next.id)}` : ""}</span>
                  </span>
                ))}
              </div>
            </section>
          )}

          {done.length > 0 && (
            <section class="section">
              <div class="section-h"><h2>終了 <span class="mono">{done.length}</span></h2><span class="note">長押しで並べ替え</span></div>
              <div class="panel">
                <Sortable
                  ids={[...done].reverse().map((m) => m.id)}
                  onReorder={(ids) => reorderSubset([...ids].reverse())}
                  render={(id) => <DoneRow m={byId.get(id)!} no={noOf.get(id)!} round={roundOf(noOf.get(id)!)} onOpen={setEditing} />}
                />
              </div>
            </section>
          )}
        </>
      )}

      {proposal && (
        <ProposalSheet
          proposal={proposal}
          project={project}
          eyebrow={`#${nextNo}・R${roundOf(nextNo)}・待機の最後に入る`}
          waitOf={new Map(resting.map((w) => [w.name, w.wait]))}
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

function DoneRow({ m, no, round, onOpen }: { m: Match; no: number; round: number; onOpen: (m: Match) => void }) {
  const ga = m.games_a;
  const gb = m.games_b;
  return (
    <button class="rec" onClick={() => onOpen(m)}>
      <span class="no">R{round} #{no}</span>
      <span class={m.result === "A" ? "win" : m.result === "B" ? "lose" : ""}>{m.team_a.join("・")}</span>
      <span class="mid">
        {ga !== null && gb !== null ? (
          <span class="score">
            <span class={ga < gb ? "lo" : ""}>{ga}</span>
            <span class="dash">-</span>
            <span class={gb < ga ? "lo" : ""}>{gb}</span>
          </span>
        ) : (
          <span class="muted">{m.result === "D" ? "引き分け" : "勝敗のみ"}</span>
        )}
      </span>
      <span class={"t-b " + (m.result === "B" ? "win" : m.result === "A" ? "lose" : "")}>{m.team_b.join("・")}</span>
    </button>
  );
}

function ProposalSheet({ proposal, project, eyebrow, waitOf, onMove, onAdopt, onClose }: {
  proposal: Proposal;
  project: Project;
  eyebrow: string;
  /** 出番待ちの人（コートにいない人）の連続待ち */
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
  // 出番待ちでいちばん長く休んでいる人のうち、この案に入る人
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
        {longest.length > 0 && <li><CheckIcon />長く休んでいる {longest.join("・")} が入る（{maxWait} ラウンド）</li>}
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
      <button class="btn primary tall block" onClick={onAdopt}>この組み合わせを待機に加える</button>
    </Sheet>
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
        進行中（外すと待機に戻る）
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

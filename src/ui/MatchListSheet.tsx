import { useMemo, useState } from "preact/hooks";
import type { ViewProps } from "../app";
import type { Match } from "../core/models";
import { estimatePairModel, estimateSummary, isConclusive } from "../core/pairModelEstimator";
import { MERGE_LABEL, projectsInPlayOrder, undoRatings, updateCurrent, withRatingUndo } from "../store";
import { ChevronRight } from "./icons";
import { whenWhere } from "./ProjectSheets";
import { Sheet } from "./Sheet";

/**
 * 設定 → データから開く。全プロジェクトの試合の一覧と、それを使う計算（p の推定）。
 * レートは固定値で、試合結果では動かさない（直すときはデータベースで手で直す）。
 * p を推定する前の値（とレートをまとめる前の初期レート）は控えておき、「元に戻す」で戻せる。
 */
export function MatchListSheet({ state, project, update, notify, onClose }: ViewProps & { onClose: () => void }) {
  // 一覧は開催日の新しい順
  const ordered = useMemo(() => projectsInPlayOrder(state).reverse(), [state]);
  const total = state.projects.reduce((a, p) => a + p.matches.length, 0);
  const [open, setOpen] = useState<Set<string>>(() => new Set([project.id]));
  const [estimate, setEstimate] = useState<string | null>(null);
  const undo = state.rating_undo;
  // レートを 1 つにまとめたときの控えは「初期レートの方にそろえ直す」と言う方が分かりやすい
  const merged = undo?.label === MERGE_LABEL;
  const undoText = merged ? `${Object.keys(undo!.ratings).length} 人のレートを、詳細に出ていた初期レートの方にそろえ直す` : `${undo?.label}の前に戻す`;

  const runEstimate = () => {
    // 全プロジェクトの試合から推定する（G はこのプロジェクトの値に固定して p だけ）
    const all = projectsInPlayOrder(state).flatMap((p) => p.matches);
    const ratings = new Map(state.db.map((p) => [p.name, p.rating]));
    const e = estimatePairModel(all, ratings, project.config.game_scale);
    if (!e) {
      notify("推定に使える試合がありません。ゲーム数の入った結果が必要です。");
      return;
    }
    setEstimate(estimateSummary(e));
    if (!isConclusive(e)) return;
    update((s) => withRatingUndo(s, "p の推定", (s2) => updateCurrent(s2, (p) => ({ ...p, config: { ...p.config, pair_weak_weight: e.weak_weight } })), project));
    notify(`「${project.name}」の p を ${e.weak_weight.toFixed(2)} にしました。`);
  };

  const restore = () => {
    if (!undo) return;
    if (merged && !confirm(`${undoText}。よろしいですか？`)) return;
    update(undoRatings);
    notify(merged ? "初期レートの方にそろえ直しました。" : `${undo.label}の前に戻しました。`);
  };

  const toggle = (id: string) =>
    setOpen((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  return (
    <Sheet title="試合の一覧" eyebrow={`全プロジェクト ${total} 試合`} onClose={onClose}>
      <section class="section">
        <div class="section-h"><h2>計算</h2></div>
        <div class="panel">
          <button class="lrow" onClick={runEstimate} disabled={total === 0}>
            <span class="body">
              <span>試合結果から p を推定</span>
              <span class="sub">全プロジェクトの試合から推定し、はっきりしたら「{project.name}」の p に入れます</span>
            </span>
            <span class="chev"><ChevronRight /></span>
          </button>
          {undo && (
            <button class="lrow" onClick={restore}>
              <span class="body">
                <span>元に戻す</span>
                <span class="sub">{undoText}（{fmtTime(undo.at)}）</span>
              </span>
              <span class="chev"><ChevronRight /></span>
            </button>
          )}
        </div>
        {estimate && <div class="plan-summary">{estimate}</div>}
        <div class="foot">レートは試合結果では変わりません。直すときは「メンバーのデータベース」で手で直します。</div>
      </section>

      <section class="section">
        <div class="section-h"><h2>試合</h2><span class="note">開催日の新しい順</span></div>
        {ordered.map((p) => (
          <div class="panel" key={p.id}>
            <button class="lrow" aria-expanded={open.has(p.id)} onClick={() => toggle(p.id)}>
              <span class="body">
                <span style={p.id === project.id ? "font-weight:600" : ""}>{p.name}</span>
                <span class="sub mono">{whenWhere(p)}</span>
              </span>
              <span class="count">{p.matches.length} 試合</span>
              <span class="chev" style={open.has(p.id) ? "transform:rotate(90deg)" : ""}><ChevronRight /></span>
            </button>
            {open.has(p.id) && (
              <div class="list">
                {p.matches.length === 0 && <div class="empty-note">試合はありません</div>}
                {p.matches.map((m, i) => <MatchLine key={m.id} m={m} no={i + 1} />)}
              </div>
            )}
          </div>
        ))}
      </section>
    </Sheet>
  );
}

function MatchLine({ m, no }: { m: Match; no: number }) {
  const ga = m.games_a;
  const gb = m.games_b;
  return (
    <div class="rec" style="cursor:default">
      <span class="no">#{no}</span>
      <span class={m.result === "A" ? "win" : m.result === "B" ? "lose" : ""}>{m.team_a.join("・")}</span>
      <span class="mid">
        {ga !== null && gb !== null ? (
          <span class="score">
            <span class={ga < gb ? "lo" : ""}>{ga}</span>
            <span class="dash">-</span>
            <span class={gb < ga ? "lo" : ""}>{gb}</span>
          </span>
        ) : (
          <span class="muted">{m.result === "D" ? "引き分け" : m.result ? "勝敗のみ" : m.in_play ? "進行中" : "未入力"}</span>
        )}
      </span>
      <span class={"t-b " + (m.result === "B" ? "win" : m.result === "A" ? "lose" : "")}>{m.team_b.join("・")}</span>
    </div>
  );
}

function fmtTime(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleString("ja-JP", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

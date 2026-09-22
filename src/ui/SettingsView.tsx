import { useEffect, useRef, useState } from "preact/hooks";
import type { ViewProps } from "../app";
import type { EngineConfig } from "../core/config";
import { DEFAULT_CONFIG } from "../core/config";
import { newMatch } from "../core/models";
import { estimatePairModel, estimateSummary, isConclusive } from "../core/pairModelEstimator";
import { planSummary, type PlanResult } from "../core/planOptimizer";
import { bundleJson, downloadText, matchesJson, parseImport, playersJson, shareText, todayStamp } from "../io";
import { addProject, availablePlayers, emptyState, mergePlayers, recalcRatings, updateCurrent, type Project } from "../store";
import type { PlanMessage, PlanRequest } from "../planWorker";
import { UpdateCard } from "./UpdateCard";

export function SettingsView({ state, project, update, updateProject, notify }: ViewProps) {
  const cfg = project.config;
  const setCfg = (patch: Partial<EngineConfig>) => updateProject((p) => ({ ...p, config: { ...p.config, ...patch } }));
  const fileRef = useRef<HTMLInputElement>(null);

  const recalc = () => {
    update((s) => recalcRatings(s, true));
    notify("初期レートとこのプロジェクトの試合結果から、現在のレートを計算し直しました。");
  };

  const estimate = () => {
    const ratings = new Map(state.db.map((p) => [p.name, p.initial_rating]));
    const e = estimatePairModel(project.matches, ratings);
    if (!e) {
      notify("推定に使える試合がありません。ゲーム数の入った結果が必要です。");
      return;
    }
    alert(estimateSummary(e));
    if (isConclusive(e)) setCfg({ pair_weak_weight: e.weak_weight });
  };

  const onImport = async (file: File) => {
    try {
      const imp = parseImport(await file.text());
      if (imp.kind === "bundle") {
        const same = state.projects.find((p) => p.name === imp.project.name);
        if (same) {
          if (!confirm(`プロジェクト「${same.name}」はすでにあります。読み込んだ内容で置き換えますか？`)) return;
          update((s) => {
            const merged = mergePlayers(s, imp.players);
            const replaced: Project = { ...imp.project, id: same.id };
            return { ...merged, projects: merged.projects.map((p) => (p.id === same.id ? replaced : p)), current: same.id };
          });
        } else {
          update((s) => addProject(mergePlayers(s, imp.players), imp.project));
        }
        notify(`プロジェクト「${imp.project.name}」を読み込みました（名簿 ${imp.project.members.length} 人・${imp.project.matches.length} 試合）。`);
      } else if (imp.kind === "players") {
        // players.json はデスクトップ版のプロジェクトのメンバー。データベースに足し、このプロジェクトの名簿に入れる
        update((s) => {
          const merged = mergePlayers(s, imp.players);
          return updateCurrent(merged, (p) => {
            const names = imp.players.filter((x) => x.active).map((x) => x.name);
            const members = [...new Set([...p.members, ...names])];
            const selected = [...new Set([...p.selected, ...names])];
            return { ...p, members, selected };
          });
        });
        notify(`${imp.players.length} 人を読み込み、「${project.name}」の名簿に入れました。`);
      } else {
        if (project.matches.length > 0 && !confirm(`「${project.name}」の試合をすべて置き換えます。よろしいですか？`)) return;
        // 試合に出ている人がデータベースにいなければ、名前だけ登録して名簿に入れる
        update((s) => {
          const known = new Set(s.db.map((p) => p.name));
          const names = [...new Set(imp.matches.flatMap((m) => [...m.team_a, ...m.team_b]))];
          const missing = names.filter((n) => !known.has(n));
          const merged = missing.length ? mergePlayers(s, missing.map((n) => ({ name: n, rating: 1500, initial_rating: 1500, team: null, active: true }))) : s;
          return updateCurrent(merged, (p) => ({ ...p, matches: imp.matches, members: [...new Set([...p.members, ...names])], selected: [...new Set([...p.selected, ...missing])] }));
        });
        notify(`${imp.matches.length} 試合を読み込みました。`);
      }
    } catch (e) {
      notify(`読み込めませんでした: ${(e as Error).message}`);
    }
  };

  const exportAll = async () => {
    const name = `${project.name}_${todayStamp()}.json`;
    const text = bundleJson(state, project);
    if (await shareText(name, text)) return;
    downloadText(name, text);
  };

  const band = Math.round(cfg.day_win_prob_min * 100);

  return (
    <>
      <div class="topbar">
        <h1>設定</h1>
      </div>

      <div class="card stack">
        <h2>試合の組み方</h2>
        <div>
          <div class="muted">コート数</div>
          <div class="seg">
            {[1, 2, 3].map((n) => <button key={n} class={cfg.courts === n ? "on" : ""} onClick={() => setCfg({ courts: n })}>{n} 面</button>)}
          </div>
        </div>
        <label class="check">
          <input type="checkbox" checked={project.settings.rating_match} onChange={(e) => updateProject((p) => ({ ...p, settings: { ...p.settings, rating_match: (e.target as HTMLInputElement).checked } }))} />
          レートを見て接戦になるように組む
        </label>
        <label class="check">
          <input type="checkbox" checked={project.settings.avoid_same_team} onChange={(e) => updateProject((p) => ({ ...p, settings: { ...p.settings, avoid_same_team: (e.target as HTMLInputElement).checked } }))} />
          同じ所属の人をなるべくペアにしない
        </label>
        <label class="check">
          <input type="checkbox" checked={cfg.elo_auto_update} onChange={(e) => setCfg({ elo_auto_update: (e.target as HTMLInputElement).checked })} />
          試合結果でレートを自動更新
        </label>
      </div>

      <PlanCard state={state} project={project} update={update} updateProject={updateProject} notify={notify} />

      <details class="card">
        <summary>詳細設定</summary>
        <div class="stack" style="margin-top:8px">
          <NumberField label="接戦とみなす 1 ゲーム勝率の下限（%）" value={band} min={20} max={50} onChange={(v) => setCfg({ day_win_prob_min: v / 100 })} />
          <NumberField label="連続待ちの上限（ラウンド。0 は自動）" value={cfg.day_wait_cap} min={0} max={12} onChange={(v) => setCfg({ day_wait_cap: v })} />
          <NumberField label="上限が自動のときの余裕（ラウンド）" value={cfg.day_wait_slack} min={0} max={4} onChange={(v) => setCfg({ day_wait_slack: v })} />
          <NumberField label="出場回数の差の許容（回）" value={cfg.day_play_slack} min={0} max={2} onChange={(v) => setCfg({ day_play_slack: v })} />
          <NumberField label="再同席を避けるラウンド数" value={cfg.day_recent_rounds} min={0} max={5} onChange={(v) => setCfg({ day_recent_rounds: v })} />
          <NumberField label="同席回数の上限（均等な回数に足す分）" value={cfg.day_dyad_slack} min={1} max={5} onChange={(v) => setCfg({ day_dyad_slack: v })} />
          <NumberField label="同じ所属のペア 1 組あたりの減点（0 = 気にしない）" value={cfg.day_same_team_weight} min={0} max={20} step={0.5} onChange={(v) => setCfg({ day_same_team_weight: v })} />
          <NumberField label="1 ゲームのレートスケール" value={cfg.game_scale} min={100} max={3000} step={50} onChange={(v) => setCfg({ game_scale: v })} />
          <NumberField label="ペア強度の弱い側の重み p（0.5 は単純平均）" value={cfg.pair_weak_weight} min={0.2} max={0.8} step={0.01} onChange={(v) => setCfg({ pair_weak_weight: v })} />
          <NumberField label="Elo の K 係数" value={cfg.elo_k_factor} min={1} max={100} onChange={(v) => setCfg({ elo_k_factor: v })} />
          <div class="row wrap">
            <button class="btn small" onClick={estimate}>試合結果から p を推定</button>
            <button class="btn small" onClick={recalc}>レートを再計算</button>
            <button class="btn small" onClick={() => { if (confirm("詳細設定を既定値に戻しますか？")) setCfg({ ...DEFAULT_CONFIG, courts: cfg.courts, elo_auto_update: cfg.elo_auto_update }); }}>既定値に戻す</button>
          </div>
        </div>
      </details>

      <div class="card stack">
        <h2>エクスポート</h2>
        <button class="btn primary block" onClick={exportAll}>このプロジェクト（名簿・試合・設定）</button>
        <div class="row wrap">
          <button class="btn grow" onClick={() => downloadText("players.json", playersJson(state, project))}>名簿だけ players.json</button>
          <button class="btn grow" onClick={() => downloadText("matches.json", matchesJson(project))}>試合だけ matches.json</button>
        </div>
      </div>

      <div class="card stack">
        <h2>インポート</h2>
        <button class="btn block" onClick={() => fileRef.current?.click()}>ファイルを選ぶ</button>
        <input ref={fileRef} type="file" accept="application/json,.json" hidden onChange={(e) => { const f = (e.target as HTMLInputElement).files?.[0]; if (f) onImport(f); (e.target as HTMLInputElement).value = ""; }} />
      </div>

      <div class="card stack">
        <h2>削除</h2>
        <button class="btn danger block" disabled={project.matches.length === 0}
          onClick={() => { if (confirm(`「${project.name}」の試合 ${project.matches.length} 件を消しますか？（名簿は残ります）`)) { updateProject((p) => ({ ...p, matches: [] })); notify("試合を消しました。"); } }}>
          このプロジェクトの試合（{project.matches.length} 件）
        </button>
        <button class="btn danger block"
          onClick={() => { if (confirm(`データベースの ${state.db.length} 人と ${state.projects.length} 件のプロジェクトを、すべて消します。よろしいですか？`)) { update(() => emptyState()); notify("すべて消しました。"); } }}>
          すべてのデータ
        </button>
      </div>

      <UpdateCard />
    </>
  );
}

function NumberField(props: { label: string; value: number; min: number; max: number; step?: number; onChange: (v: number) => void }) {
  return (
    <label class="row between">
      <span class="grow" style="font-size:14px">{props.label}</span>
      <input type="number" style="width:96px" inputMode="decimal" min={props.min} max={props.max} step={props.step ?? 1} value={props.value}
        onChange={(e) => { const v = Number((e.target as HTMLInputElement).value); if (Number.isFinite(v)) props.onChange(Math.min(props.max, Math.max(props.min, v))); }} />
    </label>
  );
}

function PlanCard({ state, project, updateProject, notify }: ViewProps) {
  const available = availablePlayers(state, project);
  const [count, setCount] = useState(Math.max(1, Math.round(available.length * 1.5)));
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState(0);
  const [result, setResult] = useState<(Omit<PlanResult, "matches"> & { matches: string[][][] }) | null>(null);
  const workerRef = useRef<Worker | null>(null);

  useEffect(() => () => workerRef.current?.terminate(), []);

  const start = () => {
    if (available.length < 4) {
      notify("試合に入れる人が 4 人未満です。");
      return;
    }
    const w = new Worker(new URL("../planWorker.ts", import.meta.url), { type: "module" });
    workerRef.current = w;
    setRunning(true);
    setProgress(0);
    setResult(null);
    w.onmessage = (ev: MessageEvent<PlanMessage>) => {
      if (ev.data.type === "progress") setProgress(ev.data.total ? ev.data.done / ev.data.total : 0);
      else {
        setRunning(false);
        setResult(ev.data.result);
        if (ev.data.result === null) notify("計画を作れませんでした。");
        w.terminate();
        workerRef.current = null;
      }
    };
    w.onerror = () => {
      setRunning(false);
      notify("計画の作成に失敗しました。");
      w.terminate();
      workerRef.current = null;
    };
    const req: PlanRequest = { players: available, past: project.matches, nMatches: count, config: project.config };
    w.postMessage(req);
  };

  const cancel = () => {
    workerRef.current?.terminate();
    workerRef.current = null;
    setRunning(false);
  };

  const adopt = () => {
    if (!result) return;
    const matches = result.matches.map(([a, b]) => newMatch(a, b));
    updateProject((p) => ({ ...p, matches: [...p.matches, ...matches] }));
    notify(`${matches.length} 試合を追加しました。`);
    setResult(null);
  };

  return (
    <div class="card stack">
      <h2>まとめて組む</h2>
      <div class="row">
        <span class="grow">試合数</span>
        <input type="number" style="width:88px" inputMode="numeric" min={1} max={200} value={count} onChange={(e) => setCount(Math.max(1, Math.min(200, Math.trunc(Number((e.target as HTMLInputElement).value)) || 1)))} />
      </div>
      {!running && !result && <button class="btn block" onClick={start} disabled={available.length < 4}>組み合わせを探す</button>}
      {running && (
        <>
          <div class="progress"><div style={`width:${Math.round(progress * 100)}%`}></div></div>
          <button class="btn block" onClick={cancel}>中止</button>
        </>
      )}
      {result && (
        <>
          <div style="white-space:pre-line">{planSummary({ ...result, matches: new Array(result.matches.length) as never })}</div>
          <div class="row">
            <button class="btn grow" onClick={() => setResult(null)}>やめる</button>
            <button class="btn primary grow" onClick={adopt}>この内容で追加</button>
          </div>
        </>
      )}
    </div>
  );
}

import { useEffect, useRef, useState } from "preact/hooks";
import type { ViewProps } from "../app";
import type { EngineConfig } from "../core/config";
import { DEFAULT_CONFIG } from "../core/config";
import { recalculateAll } from "../core/elo";
import { newMatch } from "../core/models";
import { estimatePairModel, estimateSummary, isConclusive } from "../core/pairModelEstimator";
import { planSummary, type PlanResult } from "../core/planOptimizer";
import { gameWinProb, ratingDiffForProb } from "../core/winModel";
import { bundleJson, downloadText, matchesJson, parseImport, playersJson, shareText, todayStamp } from "../io";
import { availablePlayers, emptyState } from "../store";
import type { PlanMessage, PlanRequest } from "../planWorker";
import { UpdateCard } from "./UpdateCard";

export function SettingsView({ state, update, notify }: ViewProps) {
  const cfg = state.config;
  const setCfg = (patch: Partial<EngineConfig>) => update((s) => ({ ...s, config: { ...s.config, ...patch } }));
  const fileRef = useRef<HTMLInputElement>(null);

  const recalc = () => {
    update((s) => {
      const players = s.players.map((p) => ({ ...p }));
      recalculateAll(players, s.matches, { kFactor: s.config.elo_k_factor, weakWeight: s.config.pair_weak_weight, gameScale: s.config.game_scale });
      return { ...s, players };
    });
    notify("初期レートと試合結果から、現在のレートを計算し直しました。");
  };

  const estimate = () => {
    const ratings = new Map(state.players.map((p) => [p.name, p.initial_rating]));
    const e = estimatePairModel(state.matches, ratings);
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
        if (!confirm("いまのデータをすべて置き換えます。よろしいですか？")) return;
        update(() => imp.state);
        notify(`読み込みました（${imp.state.players.length} 人・${imp.state.matches.length} 試合）。`);
      } else if (imp.kind === "players") {
        update((s) => {
          const byName = new Map(s.players.map((p) => [p.name, p]));
          for (const p of imp.players) byName.set(p.name, { ...(byName.get(p.name) ?? p), ...p });
          const players = [...byName.values()];
          return { ...s, players, selected: players.filter((p) => p.active).map((p) => p.name) };
        });
        notify(`${imp.players.length} 人を読み込みました。`);
      } else {
        if (state.matches.length > 0 && !confirm("いまの試合をすべて置き換えます。よろしいですか？")) return;
        update((s) => ({ ...s, matches: imp.matches }));
        notify(`${imp.matches.length} 試合を読み込みました。`);
      }
    } catch (e) {
      notify(`読み込めませんでした: ${(e as Error).message}`);
    }
  };

  const exportAll = async () => {
    const name = `${state.name}_${todayStamp()}.json`;
    const text = bundleJson(state);
    if (await shareText(name, text)) return;
    downloadText(name, text);
  };

  const band = Math.round(cfg.day_win_prob_min * 100);
  const allow = ratingDiffForProb(1 - cfg.day_win_prob_min, cfg.game_scale);

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
          <input type="checkbox" checked={state.settings.rating_match} onChange={(e) => update((s) => ({ ...s, settings: { ...s.settings, rating_match: (e.target as HTMLInputElement).checked } }))} />
          レートを見て接戦になるように組む
        </label>
        <label class="check">
          <input type="checkbox" checked={state.settings.avoid_same_team} onChange={(e) => update((s) => ({ ...s, settings: { ...s.settings, avoid_same_team: (e.target as HTMLInputElement).checked } }))} />
          同じ所属の人をペアにしない
        </label>
        <label class="check">
          <input type="checkbox" checked={cfg.elo_auto_update} onChange={(e) => setCfg({ elo_auto_update: (e.target as HTMLInputElement).checked })} />
          試合結果でレートを自動更新する（おすすめしません）
        </label>
      </div>

      <PlanCard state={state} update={update} notify={notify} />

      <details class="card">
        <summary>詳細設定</summary>
        <div class="stack" style="margin-top:8px">
          <NumberField label="接戦とみなす 1 ゲーム勝率の下限（%）" value={band} min={20} max={50} onChange={(v) => setCfg({ day_win_prob_min: v / 100 })} />
          <div class="muted">レート差 200 なら {Math.round(gameWinProb(200, 0, cfg.game_scale) * 100)}%。接戦の幅に収まるペア強度の差は ±{Math.round(allow)}。</div>
          <NumberField label="連続待ちの上限（ラウンド。0 は自動）" value={cfg.day_wait_cap} min={0} max={12} onChange={(v) => setCfg({ day_wait_cap: v })} />
          <NumberField label="上限が自動のときの余裕（ラウンド）" value={cfg.day_wait_slack} min={0} max={4} onChange={(v) => setCfg({ day_wait_slack: v })} />
          <NumberField label="出場回数の差の許容（回）" value={cfg.day_play_slack} min={0} max={2} onChange={(v) => setCfg({ day_play_slack: v })} />
          <NumberField label="再同席を避けるラウンド数" value={cfg.day_recent_rounds} min={0} max={5} onChange={(v) => setCfg({ day_recent_rounds: v })} />
          <NumberField label="同席回数の上限（均等な回数に足す分）" value={cfg.day_dyad_slack} min={1} max={5} onChange={(v) => setCfg({ day_dyad_slack: v })} />
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
        <h2>データ</h2>
        <label>
          <div class="muted">会の名前（書き出すファイル名に使う）</div>
          <input type="text" value={state.name} onInput={(e) => update((s) => ({ ...s, name: (e.target as HTMLInputElement).value }))} />
        </label>
        <div class="row wrap">
          <button class="btn primary" onClick={exportAll}>すべて書き出す</button>
          <button class="btn" onClick={() => downloadText("players.json", playersJson(state))}>players.json</button>
          <button class="btn" onClick={() => downloadText("matches.json", matchesJson(state))}>matches.json</button>
        </div>
        <div class="muted">players.json と matches.json はデスクトップ版のプロジェクトフォルダにそのまま置けます。</div>
        <div class="row wrap">
          <button class="btn" onClick={() => fileRef.current?.click()}>ファイルを読み込む</button>
          <input ref={fileRef} type="file" accept="application/json,.json" hidden onChange={(e) => { const f = (e.target as HTMLInputElement).files?.[0]; if (f) onImport(f); (e.target as HTMLInputElement).value = ""; }} />
        </div>
        <div class="row wrap">
          <button class="btn danger" onClick={() => { if (state.matches.length && confirm("試合をすべて消して新しい日を始めますか？（メンバーは残ります）")) { update((s) => ({ ...s, matches: [] })); notify("試合を消しました。"); } }}>新しい日を始める</button>
          <button class="btn danger" onClick={() => { if (confirm("メンバーも試合も設定もすべて消します。よろしいですか？")) { update(() => emptyState()); notify("すべて消しました。"); } }}>すべて削除</button>
        </div>
        <div class="muted">データはこの端末のブラウザにだけ保存されます。会が終わったら書き出しておくと安心です。</div>
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

function PlanCard({ state, update, notify }: ViewProps) {
  const available = availablePlayers(state);
  const [count, setCount] = useState(Math.max(1, Math.round(available.length * 1.5)));
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState(0);
  const [result, setResult] = useState<(Omit<PlanResult, "matches"> & { matches: string[][][] }) | null>(null);
  const workerRef = useRef<Worker | null>(null);

  useEffect(() => () => workerRef.current?.terminate(), []);

  const start = () => {
    if (available.length < 4) {
      notify("出場できる人が 4 人未満です。");
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
    const req: PlanRequest = { players: available, past: state.matches, nMatches: count, config: state.config };
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
    update((s) => ({ ...s, matches: [...s.matches, ...matches] }));
    notify(`${matches.length} 試合を追加しました。`);
    setResult(null);
  };

  return (
    <div class="card stack">
      <h2>まとめて組む</h2>
      <div class="muted">参加者が決まっている会向け。一日分の組み合わせをまとめて最適化します（数十秒かかります）。1 試合ずつ組む方法と併用できます。</div>
      <div class="row">
        <span class="grow">作る試合数（出場できる人 {available.length} 人）</span>
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
          {result.courts !== state.config.courts && <div class="muted">※ 出場できる人が {available.length} 人のため、同時に使えるのは {result.courts} 面までです。</div>}
          <div class="row">
            <button class="btn grow" onClick={() => setResult(null)}>やめる</button>
            <button class="btn primary grow" onClick={adopt}>この内容で追加</button>
          </div>
        </>
      )}
    </div>
  );
}

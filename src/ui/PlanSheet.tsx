import { useEffect, useRef, useState } from "preact/hooks";
import type { ViewProps } from "../app";
import { newMatch } from "../core/models";
import { planSummary, type PlanResult } from "../core/planOptimizer";
import type { PlanMessage, PlanRequest } from "../planWorker";
import { attendingPlayers } from "../store";
import { Sheet } from "./Sheet";

/** 試合タブ右上の「まとめて組む」。何試合ぶんかを一度に計画して、まとめて追加する */
export function PlanSheet({ state, project, updateProject, notify, onClose }: ViewProps & { onClose: () => void }) {
  // いまコートに入っている人も含める（計画の最初のラウンドからは外れる）
  const available = attendingPlayers(state, project);
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
    onClose();
  };

  return (
    <Sheet title="まとめて組む" eyebrow={`参加 ${available.length} 人・${project.config.courts} 面`} onClose={onClose}>
      <label class="row between" style="min-height:44px">
        <span>何試合ぶん組むか</span>
        <input type="number" style="width:96px" inputMode="numeric" min={1} max={200} value={count} disabled={running}
          onChange={(e) => setCount(Math.max(1, Math.min(200, Math.trunc(Number((e.target as HTMLInputElement).value)) || 1)))} />
      </label>
      {running && <div class="progress" role="progressbar" aria-valuenow={Math.round(progress * 100)}><div style={`width:${Math.round(progress * 100)}%`}></div></div>}
      {result && <div class="plan-summary">{planSummary({ ...result, matches: new Array(result.matches.length) as never })}</div>}
      <div class="actions">
        <span class="grow" />
        {running && <button class="btn tall" onClick={cancel}>中止</button>}
        {!running && !result && <button class="btn primary tall" onClick={start} disabled={available.length < 4}>組み合わせを探す</button>}
        {result && (
          <>
            <button class="btn tall" onClick={() => setResult(null)}>やめる</button>
            <button class="btn primary tall" onClick={adopt}>この内容で追加</button>
          </>
        )}
      </div>
    </Sheet>
  );
}

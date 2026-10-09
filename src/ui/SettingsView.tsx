import { useRef, useState } from "preact/hooks";
import type { ViewProps } from "../app";
import type { EngineConfig } from "../core/config";
import { DEFAULT_CONFIG } from "../core/config";
import { estimatePairModel, estimateSummary, isConclusive } from "../core/pairModelEstimator";
import { bundleJson, downloadText, matchesJson, parseImport, playersJson, shareText, todayStamp } from "../io";
import { addProject, emptyState, mergePlayers, recalcRatings, updateCurrent, type Project } from "../store";
import { ChevronRight } from "./icons";
import { DatabaseSheet } from "./ProjectSheets";
import { Sheet } from "./Sheet";
import { UpdateCard } from "./UpdateCard";

type Open = null | "db" | "advanced" | "export";

export function SettingsView(props: ViewProps) {
  const { state, project, update, updateProject, notify } = props;
  const cfg = project.config;
  const setCfg = (patch: Partial<EngineConfig>) => updateProject((p) => ({ ...p, config: { ...p.config, ...patch } }));
  const fileRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState<Open>(null);

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

  return (
    <>
      <header class="head">
        <div>
          <div class="eyebrow">{project.name}</div>
          <h1>設定</h1>
        </div>
      </header>

      <section class="section">
        <div class="section-h"><h2>試合の組み方</h2></div>
        <div class="panel">
          <div class="lrow static">
            <span class="body">コート数</span>
            <div class="seg" role="radiogroup" aria-label="コート数">
              {[1, 2, 3].map((n) => (
                <button key={n} role="radio" aria-checked={cfg.courts === n} class={cfg.courts === n ? "on" : ""} onClick={() => setCfg({ courts: n })}>{n} 面</button>
              ))}
            </div>
          </div>
          <label class="lrow">
            <span class="body">レートを見て接戦になるように組む</span>
            <input type="checkbox" checked={project.settings.rating_match} onChange={(e) => updateProject((p) => ({ ...p, settings: { ...p.settings, rating_match: (e.target as HTMLInputElement).checked } }))} />
          </label>
          <label class="lrow">
            <span class="body">同じ所属の人をなるべくペアにしない</span>
            <input type="checkbox" checked={project.settings.avoid_same_team} onChange={(e) => updateProject((p) => ({ ...p, settings: { ...p.settings, avoid_same_team: (e.target as HTMLInputElement).checked } }))} />
          </label>
          <label class="lrow">
            <span class="body">試合結果でレートを自動更新</span>
            <input type="checkbox" checked={cfg.elo_auto_update} onChange={(e) => setCfg({ elo_auto_update: (e.target as HTMLInputElement).checked })} />
          </label>
          <button class="lrow" onClick={() => setOpen("advanced")}>
            <span class="body">
              <span>詳細設定</span>
              <span class="sub">接戦の基準・待ちの上限・Elo の係数など 10 項目</span>
            </span>
            <span class="chev"><ChevronRight /></span>
          </button>
        </div>
      </section>

      <section class="section">
        <div class="section-h"><h2>データ</h2></div>
        <div class="panel">
          <button class="lrow" onClick={() => setOpen("db")}>
            <span class="body">
              <span>メンバーのデータベース</span>
              <span class="sub">全プロジェクト共通の登録・休会中の人</span>
            </span>
            <span class="count">{state.db.length}</span>
            <span class="chev"><ChevronRight /></span>
          </button>
          <button class="lrow" onClick={() => setOpen("export")}>
            <span class="body">
              <span>書き出す</span>
              <span class="sub">このプロジェクト・players.json・matches.json</span>
            </span>
            <span class="chev"><ChevronRight /></span>
          </button>
          <button class="lrow" onClick={() => fileRef.current?.click()}>
            <span class="body">
              <span>読み込む</span>
              <span class="sub">デスクトップ版の JSON にも対応</span>
            </span>
            <span class="chev"><ChevronRight /></span>
          </button>
          <input ref={fileRef} type="file" accept="application/json,.json" hidden onChange={(e) => { const f = (e.target as HTMLInputElement).files?.[0]; if (f) onImport(f); (e.target as HTMLInputElement).value = ""; }} />
        </div>
      </section>

      <UpdateCard />

      <section class="section">
        <div class="section-h"><h2 class="danger">削除</h2></div>
        <div class="panel">
          <button class="lrow danger" disabled={project.matches.length === 0}
            onClick={() => { if (confirm(`「${project.name}」の試合 ${project.matches.length} 件を消しますか？（名簿は残ります）`)) { updateProject((p) => ({ ...p, matches: [] })); notify("試合を消しました。"); } }}>
            <span class="body">このプロジェクトの試合を削除</span>
            <span class="count" style="color:inherit">{project.matches.length}</span>
          </button>
          <button class="lrow danger"
            onClick={() => { if (confirm(`データベースの ${state.db.length} 人と ${state.projects.length} 件のプロジェクトを、すべて消します。よろしいですか？`)) { update(() => emptyState()); notify("すべて消しました。"); } }}>
            <span class="body">すべてのデータを削除</span>
          </button>
        </div>
      </section>

      {open === "db" && <DatabaseSheet {...props} onClose={() => setOpen(null)} />}
      {open === "advanced" && <AdvancedSheet {...props} setCfg={setCfg} onClose={() => setOpen(null)} />}
      {open === "export" && <ExportSheet {...props} onClose={() => setOpen(null)} />}
    </>
  );
}

function ExportSheet({ state, project, onClose }: ViewProps & { onClose: () => void }) {
  const exportAll = async () => {
    const name = `${project.name}_${todayStamp()}.json`;
    const text = bundleJson(state, project);
    if (await shareText(name, text)) return;
    downloadText(name, text);
  };
  return (
    <Sheet title="書き出す" eyebrow={project.name} onClose={onClose}>
      <div class="panel">
        <button class="lrow" onClick={exportAll}>
          <span class="body">
            <span>このプロジェクト</span>
            <span class="sub">名簿・試合・設定をまとめて。このアプリで読み込めます</span>
          </span>
          <span class="chev"><ChevronRight /></span>
        </button>
        <button class="lrow" onClick={() => downloadText("players.json", playersJson(state, project))}>
          <span class="body">
            <span class="mono">players.json</span>
            <span class="sub">名簿だけ（デスクトップ版と同じ形）</span>
          </span>
          <span class="chev"><ChevronRight /></span>
        </button>
        <button class="lrow" onClick={() => downloadText("matches.json", matchesJson(project))}>
          <span class="body">
            <span class="mono">matches.json</span>
            <span class="sub">試合だけ（デスクトップ版と同じ形）</span>
          </span>
          <span class="chev"><ChevronRight /></span>
        </button>
      </div>
    </Sheet>
  );
}

function AdvancedSheet({ state, project, update, notify, setCfg, onClose }: ViewProps & { setCfg: (patch: Partial<EngineConfig>) => void; onClose: () => void }) {
  const cfg = project.config;
  const band = Math.round(cfg.day_win_prob_min * 100);
  const [estimate, setEstimate] = useState<string | null>(null);

  const recalc = () => {
    update((s) => recalcRatings(s, true));
    notify("初期レートとこのプロジェクトの試合結果から、現在のレートを計算し直しました。");
  };

  const runEstimate = () => {
    const ratings = new Map(state.db.map((p) => [p.name, p.initial_rating]));
    // G は設定の値に固定して p だけを推定する（反映するのは p だけなので）
    const e = estimatePairModel(project.matches, ratings, project.config.game_scale);
    if (!e) {
      notify("推定に使える試合がありません。ゲーム数の入った結果が必要です。");
      return;
    }
    setEstimate(estimateSummary(e));
    if (isConclusive(e)) setCfg({ pair_weak_weight: e.weak_weight });
  };

  return (
    <Sheet title="詳細設定" eyebrow={project.name} onClose={onClose}>
      <div class="panel">
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
      </div>
      {estimate && <div class="plan-summary">{estimate}</div>}
      <div class="row wrap">
        <button class="btn" onClick={runEstimate}>試合結果から p を推定</button>
        <button class="btn" onClick={recalc}>レートを再計算</button>
        <button class="btn" onClick={() => { if (confirm("詳細設定を既定値に戻しますか？")) setCfg({ ...DEFAULT_CONFIG, courts: cfg.courts, elo_auto_update: cfg.elo_auto_update }); }}>既定値に戻す</button>
      </div>
    </Sheet>
  );
}

function NumberField(props: { label: string; value: number; min: number; max: number; step?: number; onChange: (v: number) => void }) {
  return (
    <label class="lrow static">
      <span class="body" style="font-size:14px">{props.label}</span>
      <input type="number" style="width:88px;flex:none" inputMode="decimal" min={props.min} max={props.max} step={props.step ?? 1} value={props.value}
        onChange={(e) => { const v = Number((e.target as HTMLInputElement).value); if (Number.isFinite(v)) props.onChange(Math.min(props.max, Math.max(props.min, v))); }} />
    </label>
  );
}

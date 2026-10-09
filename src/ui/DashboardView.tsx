import { useMemo, useState } from "preact/hooks";
import type { ViewProps } from "../app";
import { CONTACT_ALERT, buildDashboard, type Card } from "../dashboard";
import { memberPlayers } from "../store";
import { NoteIcon } from "./icons";

type Seg = "ranking" | "people" | "contacts" | "timeline";

const SEGS: [Seg, string][] = [
  ["ranking", "成績"],
  ["people", "出場と待ち"],
  ["contacts", "同席"],
  ["timeline", "時系列"],
];

/** 「2 ラウンド」→ 数字と単位に分けて、単位を小さく出す */
function KpiValue({ value }: { value: string }) {
  const m = /^(-?\d+)\s*(.*)$/.exec(value);
  if (!m) return <div class="v">{value}</div>;
  return <div class="v">{m[1]}{m[2] && <small> {m[2]}</small>}</div>;
}

function Kpi({ c }: { c: Card }) {
  return (
    <div class={"kpi " + (c.level === "ok" ? "" : c.level)}>
      <div class="t">{c.level !== "ok" && <NoteIcon />}{c.title}</div>
      <KpiValue value={c.value} />
      {c.sub && <div class="s">{c.sub}</div>}
    </div>
  );
}

export function DashboardView({ state, project, go }: ViewProps) {
  const [seg, setSeg] = useState<Seg>("ranking");
  const d = useMemo(() => buildDashboard(memberPlayers(state, project), project.matches, project.config), [state, project]);

  if (d.people.rows.length === 0) {
    return (
      <>
        <header class="head"><h1>集計</h1></header>
        <div class="panel empty">
          名簿がありません。
          <div><button class="btn primary" onClick={() => go("members")}>メンバーを追加</button></div>
        </div>
      </>
    );
  }

  const [summary, ...kpis] = d.cards;
  const subs: Record<string, string> = { short_repeats: "2 ラウンド以内に同じ顔合わせ", blowouts: "接戦の幅を外れた試合" };

  return (
    <>
      <header class="head">
        <div>
          <div class="eyebrow">{summary ? `${summary.value} 試合・${summary.sub}` : ""}</div>
          <h1>集計</h1>
        </div>
      </header>

      <div class="kpis">
        {kpis.slice(0, 4).map((c) => <Kpi key={c.key} c={{ ...c, sub: c.sub || subs[c.key] || "" }} />)}
      </div>

      <div class="utabs" role="tablist" aria-label="集計の種類">
        {SEGS.map(([k, l]) => (
          <button key={k} role="tab" aria-selected={seg === k} class={seg === k ? "on" : ""} onClick={() => setSeg(k)}>{l}</button>
        ))}
      </div>

      {seg === "ranking" && (
        <>
          <div class="panel tablewrap">
            <table>
              <thead>
                <tr><th class="rank">#</th><th class="name">名前</th><th>試合</th><th>勝-敗{d.ranking.some((r) => r.draws) ? "-分" : ""}</th><th>勝率</th><th>得失</th></tr>
              </thead>
              <tbody>
                {d.ranking.map((r) => (
                  <tr key={r.name}>
                    <td class="rank">{r.rank || "－"}</td>
                    <td class="name">{r.name}</td>
                    <td>{r.played}</td>
                    <td>{r.played ? `${r.wins}-${r.losses}${d.ranking.some((x) => x.draws) ? `-${r.draws}` : ""}` : "－"}</td>
                    <td>{r.played ? `${Math.round(r.win_rate * 100)}%` : "－"}</td>
                    <td class={r.point_diff < 0 ? "neg" : ""}>{r.played ? `${r.point_diff > 0 ? "+" : ""}${r.point_diff}` : "－"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div class="foot">得失はゲーム差。勝率が同じときは得失の大きい順。結果が入った試合だけを数えます。</div>
        </>
      )}

      {seg === "people" && (
        <>
          <div class="panel tablewrap">
            <table>
              <thead>
                <tr>
                  <th class="name">名前</th><th>出場</th><th>連続待ち</th><th>最長待ち</th><th>大差</th><th>同席</th><th>未同席</th><th>再同席</th>
                </tr>
              </thead>
              <tbody>
                {d.people.rows.map((r) => (
                  <tr key={r.name}>
                    <td class="name">{r.name}</td>
                    <td class={r.flags.plays ? "warn" : ""}>{r.plays}</td>
                    <td class={r.flags.current_wait ? "bad" : ""}>{r.current_wait}</td>
                    <td>{r.max_wait}</td>
                    <td class={r.flags.blowouts ? "warn" : ""}>{r.blowouts}</td>
                    <td>{r.contacts}</td>
                    <td title={r.unmet.join("、")}>{r.unmet.length}</td>
                    <td>{r.short_repeats}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div class="foot">
            同席＝味方か相手として一緒になった人数、未同席＝まだ一緒になっていない人数、再同席＝2 ラウンド以内にまた一緒になった回数。色の付いたマスは気にかけたい人です。
          </div>
        </>
      )}

      {seg === "contacts" && (
        <>
          <div class="panel tablewrap">
            <table>
              <thead>
                <tr>
                  <th class="name"></th>
                  {d.contacts.names.map((n) => <th class="c" key={n} title={n}>{n.slice(0, 3)}</th>)}
                </tr>
              </thead>
              <tbody>
                {d.contacts.names.map((a) => (
                  <tr key={a}>
                    <td class="name">{a}</td>
                    {d.contacts.names.map((b) => {
                      if (a === b) return <td class="diag c" key={b}>─</td>;
                      const [p, o] = d.contacts.matrix.get(a)!.get(b)!;
                      const c = p + o;
                      const ratio = d.contacts.max_count ? (c / d.contacts.max_count) * 0.16 : 0;
                      return (
                        <td key={b} class={"c" + (c >= CONTACT_ALERT ? " hot" : "")} style={c && c < CONTACT_ALERT ? `background: rgba(12,13,13,${ratio.toFixed(3)})` : ""} title={`味方 ${p} 回・相手 ${o} 回`}>
                          {c || ""}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div class="foot">味方と相手を合わせた回数。{CONTACT_ALERT} 回以上は赤。</div>
        </>
      )}

      {seg === "timeline" && (
        <div class="panel">
          <div class="legend">
            <span><i style="background:var(--ink)"></i>勝ち</span>
            <span><i style="background:#c9cbcc"></i>負け</span>
            <span><i style="background:var(--warn-line)"></i>引き分け</span>
            <span><i class="pending"></i>結果未入力</span>
            <span>空欄は待ち番</span>
          </div>
          <div class="tablewrap">
            <table>
              <thead>
                <tr>
                  <th class="name">名前</th>
                  {Array.from({ length: d.timeline.rounds }, (_, i) => <th class="c" key={i}>R{i + 1}</th>)}
                </tr>
              </thead>
              <tbody>
                {d.timeline.names.map((n) => (
                  <tr key={n}>
                    <td class="name">{n}</td>
                    {(d.timeline.grid.get(n) ?? []).map((cell, i) => (
                      <td class="tl" key={i} title={cell?.tip ?? ""}>{cell && <span class={cell.outcome}></span>}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </>
  );
}

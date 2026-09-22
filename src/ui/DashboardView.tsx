import { useMemo, useState } from "preact/hooks";
import type { ViewProps } from "../app";
import { CONTACT_ALERT, buildDashboard } from "../dashboard";
import { memberPlayers } from "../store";

type Seg = "people" | "contacts" | "timeline" | "ranking";

export function DashboardView({ state, project }: ViewProps) {
  const [seg, setSeg] = useState<Seg>("people");
  const d = useMemo(() => buildDashboard(memberPlayers(state, project), project.matches, project.config), [state, project]);

  if (d.people.rows.length === 0) return <div class="empty">名簿がありません</div>;

  return (
    <>
      <div class="topbar">
        <h1>集計</h1>
      </div>
      <div class="cards">
        {d.cards.map((c) => (
          <div class="c" key={c.key}>
            <div class="t">{c.title}</div>
            <div class={"v " + c.level}>{c.value}</div>
            {c.sub && <div class="s">{c.sub}</div>}
          </div>
        ))}
      </div>
      <div class="seg" style="margin-bottom:10px">
        {([["people", "個人"], ["contacts", "同席"], ["timeline", "時系列"], ["ranking", "成績"]] as [Seg, string][]).map(([k, l]) => (
          <button key={k} class={seg === k ? "on" : ""} onClick={() => setSeg(k)}>{l}</button>
        ))}
      </div>

      {seg === "people" && (
        <div class="card">
          <div class="tablewrap">
            <table>
              <thead>
                <tr>
                  <th class="name">名前</th><th>出場</th><th>連続待ち</th><th>最長待ち</th><th>大差</th><th title="同席したことのある人数">同席</th><th title="まだ同席していない人数">未同席</th><th title="2 ラウンド以内に再び同席した回数">再同席</th>
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
        </div>
      )}

      {seg === "contacts" && (
        <div class="card">
          <div class="tablewrap">
            <table>
              <thead>
                <tr>
                  <th class="name"></th>
                  {d.contacts.names.map((n) => <th key={n}>{n.slice(0, 3)}</th>)}
                </tr>
              </thead>
              <tbody>
                {d.contacts.names.map((a) => (
                  <tr key={a}>
                    <td class="name">{a}</td>
                    {d.contacts.names.map((b) => {
                      if (a === b) return <td class="diag" key={b}>─</td>;
                      const [p, o] = d.contacts.matrix.get(a)!.get(b)!;
                      const c = p + o;
                      const ratio = d.contacts.max_count ? (c / d.contacts.max_count) * 0.45 : 0;
                      return (
                        <td key={b} class={c >= CONTACT_ALERT ? "hot" : ""} style={c && c < CONTACT_ALERT ? `background: rgba(37,99,235,${ratio.toFixed(2)})` : ""} title={`味方 ${p} 回・相手 ${o} 回`}>
                          {c || ""}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {seg === "timeline" && (
        <div class="card">
          <div class="legend" style="margin-bottom:6px">
            <span><i style="background:var(--success)"></i>勝ち</span>
            <span><i style="background:var(--danger)"></i>負け</span>
            <span><i style="background:var(--warning)"></i>引き分け</span>
            <span><i style="background:var(--accent)"></i>結果未入力</span>
            <span>空欄は待ち番</span>
          </div>
          <div class="tablewrap">
            <table>
              <thead>
                <tr>
                  <th class="name">名前</th>
                  {Array.from({ length: d.timeline.rounds }, (_, i) => <th key={i}>R{i + 1}</th>)}
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

      {seg === "ranking" && (
        <div class="card">
          <div class="tablewrap">
            <table>
              <thead>
                <tr><th>順位</th><th class="name">名前</th><th>試合</th><th>勝</th><th>敗</th><th>分</th><th>勝率</th><th>得失</th></tr>
              </thead>
              <tbody>
                {d.ranking.map((r) => (
                  <tr key={r.name}>
                    <td>{r.rank || "－"}</td>
                    <td class="name">{r.name}</td>
                    <td>{r.played}</td><td>{r.wins}</td><td>{r.losses}</td><td>{r.draws}</td>
                    <td>{Math.round(r.win_rate * 100)}%</td>
                    <td>{r.point_diff > 0 ? "+" : ""}{r.point_diff}</td>
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

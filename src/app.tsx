import { useCallback, useEffect, useState } from "preact/hooks";
import { loadState, saveState, type AppState } from "./store";
import { AttendanceView } from "./ui/AttendanceView";
import { MatchesView } from "./ui/MatchesView";
import { DashboardView } from "./ui/DashboardView";
import { SettingsView } from "./ui/SettingsView";

export type Tab = "attendance" | "matches" | "dashboard" | "settings";
export type Update = (fn: (s: AppState) => AppState) => void;
export type Notify = (msg: string) => void;

export interface ViewProps {
  state: AppState;
  update: Update;
  notify: Notify;
}

const TABS: { key: Tab; label: string; icon: string }[] = [
  { key: "attendance", label: "出席", icon: "👥" },
  { key: "matches", label: "試合", icon: "🎾" },
  { key: "dashboard", label: "集計", icon: "📊" },
  { key: "settings", label: "設定", icon: "⚙️" },
];

export function App() {
  const [state, setState] = useState<AppState>(() => loadState());
  const [tab, setTab] = useState<Tab>(() => (loadState().players.length ? "matches" : "attendance"));
  const [toast, setToast] = useState<string | null>(null);

  const update: Update = useCallback((fn) => {
    setState((prev) => {
      const next = fn(prev);
      saveState(next);
      return next;
    });
  }, []);

  const notify: Notify = useCallback((msg) => setToast(msg), []);
  useEffect(() => {
    if (toast === null) return;
    const t = setTimeout(() => setToast(null), 2500);
    return () => clearTimeout(t);
  }, [toast]);

  const props: ViewProps = { state, update, notify };
  return (
    <>
      <div class="screen">
        {tab === "attendance" && <AttendanceView {...props} />}
        {tab === "matches" && <MatchesView {...props} />}
        {tab === "dashboard" && <DashboardView {...props} />}
        {tab === "settings" && <SettingsView {...props} />}
      </div>
      <nav class="nav">
        {TABS.map((t) => (
          <button key={t.key} class={tab === t.key ? "on" : ""} onClick={() => setTab(t.key)}>
            <span class="ico">{t.icon}</span>
            {t.label}
          </button>
        ))}
      </nav>
      {toast !== null && <div class="toast">{toast}</div>}
    </>
  );
}

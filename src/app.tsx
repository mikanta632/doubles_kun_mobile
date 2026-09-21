import { useCallback, useEffect, useState } from "preact/hooks";
import { currentProject, loadState, saveState, updateCurrent, type AppState, type Project } from "./store";
import { AttendanceView } from "./ui/AttendanceView";
import { MatchesView } from "./ui/MatchesView";
import { DashboardView } from "./ui/DashboardView";
import { SettingsView } from "./ui/SettingsView";
import { UpdateBanner } from "./ui/UpdateCard";
import { DashboardIcon, MatchesIcon, MembersIcon, SettingsIcon } from "./ui/icons";
import type { ComponentType } from "preact";

export type Tab = "attendance" | "matches" | "dashboard" | "settings";
export type Update = (fn: (s: AppState) => AppState) => void;
export type UpdateProject = (fn: (p: Project, s: AppState) => Project) => void;
export type Notify = (msg: string) => void;

export interface ViewProps {
  state: AppState;
  /** いま開いている会 */
  project: Project;
  update: Update;
  /** いま開いている会だけを書き換える */
  updateProject: UpdateProject;
  notify: Notify;
}

const TABS: { key: Tab; label: string; icon: ComponentType }[] = [
  { key: "attendance", label: "メンバー", icon: MembersIcon },
  { key: "matches", label: "試合", icon: MatchesIcon },
  { key: "dashboard", label: "集計", icon: DashboardIcon },
  { key: "settings", label: "設定", icon: SettingsIcon },
];

export function App() {
  const [state, setState] = useState<AppState>(() => loadState());
  const [tab, setTab] = useState<Tab>(() => (currentProject(state).members.length ? "matches" : "attendance"));
  const [toast, setToast] = useState<string | null>(null);

  const update: Update = useCallback((fn) => {
    setState((prev) => {
      const next = fn(prev);
      saveState(next);
      return next;
    });
  }, []);
  const updateProject: UpdateProject = useCallback((fn) => update((s) => updateCurrent(s, fn)), [update]);

  const notify: Notify = useCallback((msg) => setToast(msg), []);
  useEffect(() => {
    if (toast === null) return;
    const t = setTimeout(() => setToast(null), 2500);
    return () => clearTimeout(t);
  }, [toast]);

  const project = currentProject(state);
  const props: ViewProps = { state, project, update, updateProject, notify };
  return (
    <>
      <div class="screen">
        <UpdateBanner />
        {tab === "attendance" && <AttendanceView {...props} />}
        {tab === "matches" && <MatchesView {...props} />}
        {tab === "dashboard" && <DashboardView {...props} />}
        {tab === "settings" && <SettingsView {...props} />}
      </div>
      <nav class="nav">
        {TABS.map((t) => (
          <button key={t.key} class={tab === t.key ? "on" : ""} onClick={() => setTab(t.key)}>
            <span class="ico"><t.icon /></span>
            {t.label}
          </button>
        ))}
      </nav>
      {toast !== null && <div class="toast">{toast}</div>}
    </>
  );
}

import { useCallback, useEffect, useState } from "preact/hooks";
import { currentProject, loadState, saveState, updateCurrent, type AppState, type Project } from "./store";
import { MembersView } from "./ui/MembersView";
import { MatchesView } from "./ui/MatchesView";
import { DashboardView } from "./ui/DashboardView";
import { SettingsView } from "./ui/SettingsView";
import { UpdateBanner } from "./ui/UpdateCard";
import { DashboardIcon, MatchesIcon, MembersIcon, SettingsIcon } from "./ui/icons";
import type { ComponentType } from "preact";

export type Tab = "matches" | "members" | "dashboard" | "settings";
export type Update = (fn: (s: AppState) => AppState) => void;
export type UpdateProject = (fn: (p: Project, s: AppState) => Project) => void;
export type Notify = (msg: string) => void;

export interface ViewProps {
  state: AppState;
  /** いま開いているプロジェクト */
  project: Project;
  update: Update;
  /** いま開いているプロジェクトだけを書き換える */
  updateProject: UpdateProject;
  notify: Notify;
  /** 別のタブへ移る */
  go: (tab: Tab) => void;
}

const TABS: { key: Tab; label: string; icon: ComponentType }[] = [
  { key: "matches", label: "試合", icon: MatchesIcon },
  { key: "members", label: "メンバー", icon: MembersIcon },
  { key: "dashboard", label: "集計", icon: DashboardIcon },
  { key: "settings", label: "設定", icon: SettingsIcon },
];

export function App() {
  const [state, setState] = useState<AppState>(() => loadState());
  const [tab, setTab] = useState<Tab>(() => (currentProject(state).members.length ? "matches" : "members"));
  const [toast, setToast] = useState<string | null>(null);

  // 変更のたびに保存する。レートは固定値なので、試合結果では動かさない
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

  const go = useCallback((t: Tab) => {
    setTab(t);
    window.scrollTo(0, 0);
  }, []);

  const project = currentProject(state);
  const props: ViewProps = { state, project, update, updateProject, notify, go };
  return (
    <>
      <main class="screen">
        <UpdateBanner />
        {tab === "matches" && <MatchesView {...props} />}
        {tab === "members" && <MembersView {...props} />}
        {tab === "dashboard" && <DashboardView {...props} />}
        {tab === "settings" && <SettingsView {...props} />}
      </main>
      <nav class="nav" aria-label="メイン">
        {TABS.map((t) => (
          <button key={t.key} class={tab === t.key ? "on" : ""} aria-current={tab === t.key ? "page" : undefined} onClick={() => go(t.key)}>
            <t.icon />
            {t.label}
          </button>
        ))}
      </nav>
      {toast !== null && <div class="toast" role="status">{toast}</div>}
    </>
  );
}

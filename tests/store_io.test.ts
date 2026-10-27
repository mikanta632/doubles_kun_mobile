/**
 * 保存・読み込み層（store / io / dashboard）の確認。正解データでは守られていない部分。
 */
import { describe, expect, it } from "vitest";
import { DEFAULT_CONFIG } from "../src/core/config";
import { newMatch, newPlayer } from "../src/core/models";
import { buildDashboard } from "../src/dashboard";
import { bundleJson, parseImport } from "../src/io";
import { emptyState, newProject, type AppState } from "../src/store";

function fixture(): AppState {
  const names = ["A", "B", "C", "D", "E"];
  const db = names.map((n) => newPlayer(n));
  db[4].active = false; // E は試合に出たあと休会にした
  const project = newProject("test", {
    members: [...names],
    selected: ["A", "B", "C", "D"],
    matches: [{ ...newMatch(["A", "B"], ["C", "E"]), games_a: 6, games_b: 3, result: "A" }],
  });
  return { ...emptyState(), db, projects: [project], current: project.id };
}

describe("書き出しと読み込みの往復", () => {
  it("休会中の名簿メンバーも名簿に残る", () => {
    const s = fixture();
    const imp = parseImport(bundleJson(s, s.projects[0]));
    expect(imp.kind).toBe("bundle");
    if (imp.kind !== "bundle") return;
    expect(imp.project.members).toEqual(["A", "B", "C", "D", "E"]);
    expect(imp.project.selected).toEqual(["A", "B", "C", "D"]);
    expect(imp.project.matches).toHaveLength(1);
    expect(imp.players.find((p) => p.name === "E")?.active).toBe(false);
  });
});

describe("集計の連続待ちの上限", () => {
  it("名簿全員ではなく出席者数で決まる", () => {
    const cfg = { ...DEFAULT_CONFIG, courts: 1 };
    const members = Array.from({ length: 20 }, (_, i) => newPlayer(`P${i}`));
    // 名簿 20 人なら ceil(20/4)+2 = 7、出席 9 人なら ceil(9/4)+2 = 5
    expect(buildDashboard(members, [], cfg).people.meta.wait_cap).toBe(7);
    expect(buildDashboard(members, [], cfg, { attending: 9 }).people.meta.wait_cap).toBe(5);
    // 出席 0 人（まだ誰もチェックしていない）は名簿の人数で代用する
    expect(buildDashboard(members, [], cfg, { attending: 0 }).people.meta.wait_cap).toBe(7);
  });
});

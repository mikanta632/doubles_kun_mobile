/**
 * 共通データベースの管理（書き出し・読み込み・まとめて操作・出場履歴）の確認。
 */
import { describe, expect, it } from "vitest";
import { newMatch, newPlayer } from "../src/core/models";
import { databaseCsv, databaseJson, parseCsv, parseDatabaseFile } from "../src/io";
import { addMembers, deletePlayers, emptyState, mergePlayerPatches, newProject, playerHistory, updatePlayers, type AppState } from "../src/store";

function fixture(): AppState {
  const db = [newPlayer("A", 1600, "総務"), newPlayer("B", 1500, "研究"), newPlayer("C"), newPlayer("D")];
  db[1].rating = 1523.456;
  const p1 = newProject("春", {
    date: "2026-04-01",
    members: ["A", "B", "C", "D"],
    selected: ["A", "B", "C", "D"],
    matches: [{ ...newMatch(["A", "B"], ["C", "D"]), games_a: 6, games_b: 3, result: "A" }],
  });
  const p2 = newProject("秋", { date: "2026-10-01", members: ["A", "C"], selected: ["A", "C"] });
  return { ...emptyState(), db, projects: [p1, p2], current: p2.id };
}

const bytes = (text: string) => new TextEncoder().encode(text).buffer as ArrayBuffer;

describe("CSV", () => {
  it("引用符の中の , と改行、CRLF を読める", () => {
    expect(parseCsv('名前,所属\r\n"山田, 太郎","総務\n二課"\r\n\r\n鈴木,')).toEqual([["名前", "所属"], ["山田, 太郎", "総務\n二課"], ["鈴木", ""]]);
  });

  it("書き出したものを読み込むと元に戻る（休会も）", () => {
    const s = fixture();
    s.db[3].active = false;
    const csv = databaseCsv(s);
    expect(csv.startsWith("﻿名前,所属,レート,初期レート,休会\r\n")).toBe(true);
    const patches = parseDatabaseFile(bytes(csv));
    const back = mergePlayerPatches({ ...s, db: [] }, patches).db;
    expect(back.map((p) => [p.name, p.team, p.initial_rating, p.active])).toEqual(s.db.map((p) => [p.name, p.team, p.initial_rating, p.active]));
    expect(back[1].rating).toBe(1523.46);
  });

  it("無い列は登録済みの値を残し、空の所属はなしにする", () => {
    const s = fixture();
    const next = mergePlayerPatches(s, parseDatabaseFile(bytes("name,team\nA,\nE,営業\n")));
    const a = next.db.find((p) => p.name === "A")!;
    expect([a.team, a.rating, a.initial_rating, a.active]).toEqual([null, 1600, 1600, true]);
    const e = next.db.find((p) => p.name === "E")!;
    expect([e.team, e.rating, e.active]).toEqual(["営業", 1500, true]);
  });

  it("レートだけの列なら初期レートも合わせる", () => {
    const next = mergePlayerPatches(fixture(), parseDatabaseFile(bytes("名前,レート\nB,1700\n")));
    const b = next.db.find((p) => p.name === "B")!;
    expect([b.rating, b.initial_rating]).toEqual([1700, 1700]);
  });

  it("Shift_JIS の CSV も読める", () => {
    // 「名前」「所属」「山田」「総務」の Shift_JIS
    const sjis = new Uint8Array([0x96, 0xbc, 0x91, 0x4f, 0x2c, 0x8f, 0x8a, 0x91, 0xae, 0x0a, 0x8e, 0x52, 0x93, 0x63, 0x2c, 0x91, 0x8d, 0x96, 0xb1, 0x0a]);
    expect(parseDatabaseFile(sjis.buffer)).toEqual([{ name: "山田", team: "総務" }]);
  });

  it("名前の列がなければ断る", () => {
    expect(() => parseDatabaseFile(bytes("skill,team\n4,総務\n"))).toThrow("名前");
  });

  it("休会にした人は試合の候補から外れる", () => {
    const next = mergePlayerPatches(fixture(), parseDatabaseFile(bytes("名前,休会\nA,1\n")));
    expect(next.db[0].active).toBe(false);
    expect(next.projects.every((p) => !p.selected.includes("A"))).toBe(true);
  });
});

describe("JSON", () => {
  it("書き出したデータベースをそのまま読める", () => {
    const s = fixture();
    const back = mergePlayerPatches({ ...s, db: [] }, parseDatabaseFile(bytes(databaseJson(s)))).db;
    expect(back).toEqual(s.db);
  });

  it("matches.json は断る", () => {
    expect(() => parseDatabaseFile(bytes(JSON.stringify([newMatch(["A", "B"], ["C", "D"])])))).toThrow("試合");
  });
});

describe("まとめて操作", () => {
  it("所属・休会をまとめて変え、休会の人は候補から外す", () => {
    let s = updatePlayers(fixture(), ["A", "C"], { team: "営業" });
    expect(s.db.map((p) => p.team)).toEqual(["営業", "研究", "営業", null]);
    s = updatePlayers(s, ["A", "C"], { active: false });
    expect(s.projects[1].selected).toEqual([]);
    expect(s.projects[1].members).toEqual(["A", "C"]);
  });

  it("名簿に入れる。休会中の人は試合の候補には入れない", () => {
    const s0 = fixture();
    s0.db[3].active = false;
    const s = addMembers(s0, ["B", "D"]);
    expect(s.projects[1].members).toEqual(["A", "C", "B", "D"]);
    expect(s.projects[1].selected).toEqual(["A", "C", "B"]);
  });

  it("削除すると全プロジェクトの名簿からも消える", () => {
    const s = deletePlayers(fixture(), ["C", "D"]);
    expect(s.db.map((p) => p.name)).toEqual(["A", "B"]);
    expect(s.projects.map((p) => p.members)).toEqual([["A", "B"], ["A"]]);
  });
});

describe("出場履歴", () => {
  it("名簿に入っているか試合に出たプロジェクトを、日付の新しい順に", () => {
    const s = fixture();
    const a = playerHistory(s, "A");
    expect(a.map((r) => [r.project.name, r.member, r.played, r.wins, r.losses])).toEqual([["秋", true, 0, 0, 0], ["春", true, 1, 1, 0]]);
    const d = playerHistory(s, "D");
    expect(d.map((r) => [r.project.name, r.played, r.wins, r.losses])).toEqual([["春", 1, 0, 1]]);
  });
});

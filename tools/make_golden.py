# -*- coding: utf-8 -*-
"""デスクトップ版（Python）から正解データを書き出す。

TypeScript 版が Python 版と同じ結果を出すことを保証するための固定データ。
乱数は Python の random.Random（MT19937 + Python 流の seed）を TypeScript 側でも
そのまま再現しているので、seed を固定すれば提案・計画・並び順まで一致する。

実行: <desktop>/source/.venv/Scripts/python -X utf8 tools/make_golden.py <desktop repo>
出力: tests/golden/*.json
"""

from __future__ import annotations

import json
import random
import sys
from pathlib import Path

DESKTOP = Path(sys.argv[1] if len(sys.argv) > 1 else "../doubles_kun/doubles_kun").resolve()
sys.path.insert(0, str(DESKTOP / "source"))

from core.models.player import Player  # noqa: E402
from core.models.match import Match  # noqa: E402
from core.models.win_model import game_win_prob, rating_diff_for_prob  # noqa: E402
from core.models.doubles_evaluator import pair_strength  # noqa: E402
from core.engine.engine_config import EngineConfig  # noqa: E402
from core.engine.day_engine import GoodDayEngine, wait_cap_for, band_cutoffs, band_of  # noqa: E402
from core.engine.plan_optimizer import optimize_plan  # noqa: E402
from core.services.elo_service import EloService  # noqa: E402
from core.services.day_metrics import compute_day_metrics  # noqa: E402
from core.services.pair_model_estimator import estimate  # noqa: E402

OUT = Path(__file__).resolve().parents[1] / "tests" / "golden"
OUT.mkdir(parents=True, exist_ok=True)


def dump(name: str, data) -> None:
    (OUT / f"{name}.json").write_text(json.dumps(data, ensure_ascii=False, indent=1), encoding="utf-8")
    print("wrote", name)


def make_players(n: int, spread: float = 500.0, center: float = 1450.0, teams: int = 0):
    ps = []
    for i in range(n):
        r = center if n == 1 else center - spread / 2 + spread * i / (n - 1)
        team = f"T{i % teams}" if teams else None
        ps.append(Player(name=f"P{i:02d}", rating=round(r, 1), team=team))
    return ps


def player_dicts(ps):
    return [{"name": p.name, "rating": p.rating, "initial_rating": p.initial_rating,
             "team": p.team, "active": p.active} for p in ps]


def match_dict(m: Match):
    return {"id": m.id, "team_a": m.team_a, "team_b": m.team_b, "games_a": m.games_a,
            "games_b": m.games_b, "result": m.result, "in_play": m.in_play,
            "created_at": m.created_at, "updated_at": m.updated_at}


def pairing_names(pairing):
    (a1, a2), (b1, b2) = pairing
    return [[a1.name, a2.name], [b1.name, b2.name]]


# ── 乱数 ──

def golden_rng():
    cases = []
    for seed in (0, 1, 42, 123456789, 2 ** 40 + 5, 2 ** 64 + 3):
        r = random.Random(seed)
        rnd = [r.random() for _ in range(5)]
        rr = [r.randrange(10) for _ in range(5)]
        big = [r.randrange(1000003) for _ in range(3)]
        xs = list(range(12))
        r.shuffle(xs)
        ch = [r.choice(["a", "b", "c", "d", "e"]) for _ in range(5)]
        keyed = sorted(range(8), key=lambda i: (i % 3, r.random()))
        cases.append({"seed": str(seed), "random": rnd, "randrange10": rr, "randrange_big": big,
                      "shuffle12": xs, "choice": ch, "sorted_with_random_key": keyed})
    dump("rng", cases)


# ── 勝率・ペア強度 ──

def golden_win_model():
    cases = []
    for a, b, g in ((1500, 1500, 500), (1700, 1500, 500), (1200, 1650, 500),
                    (1500, 1400, 400), (1900, 1300, 800), (1500, 1500, 0.5)):
        cases.append({"a": a, "b": b, "scale": g, "prob": game_win_prob(a, b, g)})
    diffs = [{"target": t, "scale": g, "diff": rating_diff_for_prob(t, g)}
             for t, g in ((0.65, 500), (0.35, 500), (0.9, 400), (0.5, 500), (1.5, 500), (-1, 500))]
    ps = [{"r1": r1, "r2": r2, "p": p, "s": pair_strength(r1, r2, p)}
          for r1, r2, p in ((1500, 1300, 0.5), (1300, 1500, 0.7), (1500, 1300, 0.3), (1600, 1600, 1.5))]
    dump("win_model", {"win": cases, "diff": diffs, "pair": ps})


# ── 一日の再生（貪欲法） ──

def outcome(rng, a1, a2, b1, b2, cfg):
    sa = pair_strength(a1.rating, a2.rating, cfg.pair_weak_weight)
    sb = pair_strength(b1.rating, b2.rating, cfg.pair_weak_weight)
    q = game_win_prob(sa, sb, cfg.game_scale)
    # 6 ゲーム先取の簡易モデル: 各ゲームを独立に決める
    ga = gb = 0
    while ga < 6 and gb < 6:
        if rng.random() < q:
            ga += 1
        else:
            gb += 1
    return ga, gb


def replay_day(n, courts, seed, n_matches, *, teams=0, avoid_same_team=False, rating_match=True,
               cfg_kw=None):
    cfg = EngineConfig(courts=courts, **(cfg_kw or {}))
    players = make_players(n, teams=teams)
    rng = random.Random(seed)
    res_rng = random.Random(seed + 1000)
    matches = []
    steps = []
    for i in range(n_matches):
        counts = {}
        for m in matches:
            for nm in m.all_players():
                counts[nm] = counts.get(nm, 0) + 1
        for p in players:
            p.matches_played = counts.get(p.name, 0)
        in_play = sum(1 for m in matches if m.in_play)
        engine = GoodDayEngine(players, matches, config=cfg, courts=courts,
                               free_courts=max(1, courts - in_play), all_players=players, rng=rng)
        props = engine.generate_matches(rating_match_on=rating_match, avoid_same_team_on=avoid_same_team)
        if not props:
            steps.append({"proposals": [], "explain": ""})
            break
        top = props[:6]
        first = top[0]
        (a1, a2), (b1, b2) = first
        m = Match.new([a1.name, a2.name], [b1.name, b2.name])
        m.id = f"m{i:03d}"
        m.created_at = m.updated_at = 1_700_000_000 + i
        ga, gb = outcome(res_rng, a1, a2, b1, b2, cfg)
        m.games_a, m.games_b = ga, gb
        m.result = "A" if ga > gb else "B"
        matches.append(m)
        steps.append({
            "proposals": [pairing_names(p) for p in top],
            "explain": engine.explain(first),
            "wait_cap": engine.wait_cap(),
            "dyad_cap": engine.dyad_cap(),
            "result": [ga, gb],
        })
    return cfg, players, matches, steps


def golden_day_engine():
    scenarios = [
        dict(name="12p_1c", n=12, courts=1, seed=1, n_matches=20),
        dict(name="16p_2c", n=16, courts=2, seed=2, n_matches=24),
        dict(name="20p_3c", n=20, courts=3, seed=3, n_matches=30),
        dict(name="9p_1c_wait", n=9, courts=1, seed=4, n_matches=14),
        dict(name="12p_1c_teams", n=12, courts=1, seed=5, n_matches=12, teams=3, avoid_same_team=True),
        dict(name="10p_1c_norating", n=10, courts=1, seed=6, n_matches=10, rating_match=False),
        dict(name="14p_2c_strict", n=14, courts=2, seed=7, n_matches=16,
             cfg_kw=dict(day_win_prob_min=0.45, day_play_slack=0, day_wait_slack=0)),
    ]
    out = []
    for sc in scenarios:
        kw = {k: v for k, v in sc.items() if k != "name"}
        cfg, players, matches, steps = replay_day(**kw)
        # 初期状態に戻して保存（TS 側で同じ再生をする）
        for p in players:
            p.matches_played = 0
        out.append({
            "name": sc["name"],
            "seed": sc["seed"],
            "config": cfg.to_dict(),
            "avoid_same_team": sc.get("avoid_same_team", False),
            "rating_match": sc.get("rating_match", True),
            "players": player_dicts(players),
            "steps": steps,
            "matches": [match_dict(m) for m in matches],
        })
    dump("day_engine", out)
    return out


# ── 一括計画 ──

def golden_plan(day_cases):
    out = []
    specs = [
        dict(name="12p_1c", n=12, courts=1, n_matches=12, seed=11, set_iters=4000, order_iters=2000),
        dict(name="16p_3c", n=16, courts=3, n_matches=24, seed=12, set_iters=6000, order_iters=2000),
        dict(name="8p_3c_capped", n=8, courts=3, n_matches=6, seed=13, set_iters=2000, order_iters=1000),
        dict(name="13p_2c_partial", n=13, courts=2, n_matches=9, seed=14, set_iters=3000, order_iters=1000),
    ]
    for sp in specs:
        players = make_players(sp["n"])
        r = optimize_plan(players, [], sp["n_matches"], courts=sp["courts"], seed=sp["seed"],
                          set_iters=sp["set_iters"], order_iters=sp["order_iters"])
        out.append({**sp, "players": player_dicts(players), "result": plan_dict(r)})
    # 履歴あり: 貪欲法で作った 12p_1c の最初の 8 試合を履歴にして残りを組む
    base = day_cases[0]
    players = [Player(name=d["name"], rating=d["rating"], team=d["team"]) for d in base["players"]]
    past = [Match.from_dict(d) for d in base["matches"][:8]]
    r = optimize_plan(players, past, 10, courts=1, seed=15, set_iters=3000, order_iters=1000)
    out.append({"name": "12p_1c_history", "n": 12, "courts": 1, "n_matches": 10, "seed": 15,
                "set_iters": 3000, "order_iters": 1000, "players": player_dicts(players),
                "past": [match_dict(m) for m in past], "result": plan_dict(r)})
    # 不成立
    out.append({"name": "too_few", "n": 3, "courts": 1, "n_matches": 5, "seed": 0,
                "set_iters": 10, "order_iters": 10, "players": player_dicts(make_players(3)),
                "result": None})
    dump("plan_optimizer", out)


def plan_dict(r):
    if r is None:
        return None
    return {
        "matches": [pairing_names(p) for p in r.matches],
        "plays_spread": r.plays_spread, "dyad_max": r.dyad_max, "dyad_over": r.dyad_over,
        "pair_repeats": r.pair_repeats, "out_of_band": r.out_of_band, "max_wait": r.max_wait,
        "conflicts": r.conflicts, "courts": r.courts, "summary": r.summary(),
    }


# ── Elo・指標・推定 ──

def golden_services(day_cases):
    out = []
    for case in day_cases[:3]:
        players = [Player(name=d["name"], rating=d["rating"], team=d["team"]) for d in case["players"]]
        matches = [Match.from_dict(d) for d in case["matches"]]
        cfg = EngineConfig.from_dict(case["config"])
        elo = EloService(k_factor=cfg.elo_k_factor, weak_weight=cfg.pair_weak_weight, game_scale=cfg.game_scale)
        elo.recalculate_all(players, matches)
        ratings0 = {d["name"]: d["rating"] for d in case["players"]}
        rep = compute_day_metrics(matches, ratings0, [p.name for p in players], courts=cfg.courts,
                                  k_factor=cfg.elo_k_factor, win_band=cfg.day_win_prob_min,
                                  game_scale=cfg.game_scale, weak_weight=cfg.pair_weak_weight,
                                  apply_elo=False)
        rep_elo = compute_day_metrics(matches, ratings0, [p.name for p in players], courts=cfg.courts,
                                      k_factor=cfg.elo_k_factor, win_band=cfg.day_win_prob_min,
                                      game_scale=cfg.game_scale, weak_weight=cfg.pair_weak_weight,
                                      apply_elo=True)
        est = estimate(matches, ratings0)
        out.append({
            "name": case["name"],
            "elo_after": {p.name: p.rating for p in players},
            "metrics": metrics_dict(rep),
            "metrics_elo": metrics_dict(rep_elo),
            "wait_cap": wait_cap_for(cfg, len(players), cfg.courts),
            "cutoffs": band_cutoffs([p.rating for p in players]),
            "bands": {p.name: band_of(p.rating, band_cutoffs([q.rating for q in players])) for p in players},
            "estimate": None if est is None else {
                "weak_weight": est.weak_weight, "ci_low": est.ci_low, "ci_high": est.ci_high,
                "game_scale": est.game_scale, "n_matches": est.n_matches, "n_games": est.n_games,
                "log_likelihood": est.log_likelihood, "log_likelihood_half": est.log_likelihood_half,
                "conclusive": est.conclusive, "differs_from_half": est.differs_from_half,
            },
        })
    dump("services", out)


def metrics_dict(rep):
    persons = {}
    for n, pm in rep.persons.items():
        persons[n] = {"plays": pm.plays, "max_wait": pm.max_wait, "current_wait": pm.current_wait,
                      "blowouts": pm.blowouts, "partners": sorted(pm.partners),
                      "opponents": sorted(pm.opponents), "mixed_matches": pm.mixed_matches,
                      "short_repeats": pm.short_repeats, "band": pm.band}
    return {"persons": persons, "summary": rep.summary(), "match_count": rep.match_count}


if __name__ == "__main__":
    golden_rng()
    golden_win_model()
    cases = golden_day_engine()
    golden_plan(cases)
    golden_services(cases)

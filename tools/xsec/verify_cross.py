#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
剖面缓存校验：CI 里紧跟在 build_cross.py 之后跑，不过就不许提交。

它检查的是「产物能不能被前端安全地当数据用」：
结构、数量、单位量级、地形遮罩一致性、时间单调、NaN/缺测处理。
不检查物理正确性（那要跟观测比对，见 docs）。
"""
import json
import math
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
CROSS = ROOT / "data" / "cross"
SPOTS_JSON = ROOT / "src" / "data" / "forecast" / "spots.json"

FIELDS = ["hgtM", "tC", "rhPct", "clwMgKg", "iciMgKg", "uMs", "vMs", "wPaS", "cfPct", "belowGround"]
LEVELS = [1000, 925, 850, 700, 600, 500, 400, 300, 200]
AZIMUTHS = [240, 255, 265, 280, 295]

errors: list[str] = []
warns: list[str] = []


def check(cond, msg):
    if not cond:
        errors.append(msg)


def main():
    idx_path = CROSS / "index.json"
    if not idx_path.exists():
        print("✗ data/cross/index.json 不存在")
        return 2
    idx = json.loads(idx_path.read_text(encoding="utf-8"))

    for k in ("version", "source", "model", "cycle", "generatedAt", "gridKm", "levelsHpa",
              "levelFields", "times", "spots", "thresholds", "notes"):
        check(k in idx, f"index.json 缺字段 {k}")
    check(idx.get("source") == "gfs", "index.source 必须是 gfs")
    check(len(idx.get("spots", [])) == 8, f"代表机位应为 8 个，实际 {len(idx.get('spots', []))}")
    check(idx.get("levelFields") == FIELDS, "levelFields 与前端约定不一致")
    check(idx.get("levelsHpa") == LEVELS, "levelsHpa 与前端约定不一致")
    check(26 <= float(idx.get("gridKm", 0)) <= 29, f"网格分辨率异常：{idx.get('gridKm')}")
    times = idx.get("times", [])
    check(len(times) == 4, f"时次应为 4 个，实际 {len(times)}")
    for a, b in zip(times, times[1:]):
        check(a["utc"] < b["utc"], f"时次不是递增：{a['utc']} → {b['utc']}")
        check(b["leadHours"] > a["leadHours"], "leadHours 没有递增")

    hn = {row["n"]: row for row in json.loads(SPOTS_JSON.read_text(encoding="utf-8")) if row.get("prov") == "hn"}

    total_bytes = 0
    for meta in idx["spots"]:
        f = CROSS / meta["file"]
        check(f.exists(), f"机位文件缺失 {meta['file']}")
        if not f.exists():
            continue
        total_bytes += f.stat().st_size
        check(f.stat().st_size < 300_000, f"{meta['file']} 体积异常大（{f.stat().st_size} B）")
        d = json.loads(f.read_text(encoding="utf-8"))
        check(d.get("source") == "gfs", f"{meta['file']} source 不是 gfs")
        check(d.get("cycle") == idx["cycle"], f"{meta['file']} 起报时刻与 index 不一致")
        spot = d["spot"]
        check(spot["id"] == meta["id"], f"{meta['file']} spot.id 不一致")
        src = hn.get(spot["name"])
        check(src is not None, f"{meta['file']} 机位名「{spot['name']}」不在 spots.json")
        if src:
            check(abs(src["lat"] - spot["lat"]) < 1e-6, f"{meta['file']} 纬度与机位表不一致")
            check(abs(src["lon"] - spot["lon"]) < 1e-6, f"{meta['file']} 经度与机位表不一致")

        check(len(d["sections"]) == 4 * 5, f"{meta['file']} sections 应为 20，实际 {len(d['sections'])}")
        seen = {(s["t"], s["az"]) for s in d["sections"]}
        for t in range(4):
            for az in AZIMUTHS:
                check((t, az) in seen, f"{meta['file']} 缺 section t={t} az={az}")

        for sec in d["sections"]:
            check(len(sec["samples"]) == 5, f"{meta['file']} t={sec['t']} az={sec['az']} 采样点不是 5 个")
            check(0 <= sec["az"] <= 360, "方位角越界")
            ds = [s["d"] for s in sec["samples"]]
            check(ds == [0.0, 12.5, 25.0, 37.5, 50.0], f"{meta['file']} 采样距离不对：{ds}")
            for smp in sec["samples"]:
                check(len(smp["levels"]) == len(LEVELS), "层数不对")
                check(smp["terrainM"] >= 0, "地形高度为负")
                prev_h = -1.0
                for li, row in enumerate(smp["levels"]):
                    check(len(row) == len(FIELDS), f"字段数 {len(row)} ≠ {len(FIELDS)}")
                    hgt, t, rh, clw, ici, u, v, w, cf, below = row
                    if hgt is None:
                        continue
                    check(hgt > prev_h, f"高度未随气压降低而升高（{hgt} ≤ {prev_h}）")
                    prev_h = hgt
                    check(-80 <= t <= 60, f"温度量级异常 {t} °C")
                    check(0 <= rh <= 110, f"湿度量级异常 {rh} %")
                    check(0 <= clw <= 20000, f"云水量级异常 {clw} mg/kg")
                    check(0 <= ici <= 20000, f"云冰量级异常 {ici} mg/kg")
                    check(0 <= cf <= 100, f"云分数越界 {cf}")
                    # 地形以下必须被标记（否则前端会把地下层画成晴空）
                    expect_below = 1 if hgt <= smp["terrainM"] + 5 else 0
                    check(below == expect_below,
                          f"地形遮罩标记不一致 slot={smp['d']} {LEVELS[li]}hPa hgt={hgt} terrain={smp['terrainM']}")
                    for val in row[:9]:
                        check(val is None or math.isfinite(val), "出现 NaN/Inf")

    # 有云样本至少要有一些，否则说明下载/解码全空
    have_cloud = 0
    for meta in idx["spots"]:
        d = json.loads((CROSS / meta["file"]).read_text(encoding="utf-8"))
        for sec in d["sections"]:
            for smp in sec["samples"]:
                for row in smp["levels"]:
                    if (row[3] or 0) + (row[4] or 0) > 0:
                        have_cloud += 1
    check(have_cloud > 0, "全部样本云水/云冰都是 0 —— 很可能是下载或解码失败")
    if have_cloud < 20:
        warns.append(f"有云样本只有 {have_cloud} 个，时次可能特别晴（不一定是错）")

    print(f"机位 {len(idx['spots'])} 个 / 剖面 {len(idx['spots']) * 20} 条 / 总体积 {total_bytes / 1024:.1f} KB")
    print(f"有云样本点：{have_cloud}")
    for w in warns:
        print(f"⚠ {w}")
    if errors:
        print(f"\n✗ 校验失败 {len(errors)} 项：")
        for e in errors[:40]:
            print("  - " + e)
        return 1
    print("✓ 剖面缓存校验通过")
    return 0


if __name__ == "__main__":
    sys.exit(main())

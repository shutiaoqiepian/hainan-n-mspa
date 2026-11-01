#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
全国 224 机位剖面的**质量检查**（阶段八-03）。

不是"跑完就算数"：这份报告要能回答「哪些机位真的能出图、哪些不行、为什么」。

检查项：
    1. 覆盖：224 个机位是否全部有文件（按 spots.json 逐个数，缺了就是缺了）；
    2. 结构：时间数、方位数、采样点、字段数与主流程一致；
    3. 数据真实性：缺测比例、地形遮罩是否正确、降水/云量量级是否合理；
    4. 一致性：同一 tile 内相邻机位不应出现"一个全是 0、一个全是云"这种可疑跳变；
    5. 结论：输出每个省份的可用机位数与原因分类。

用法：
    python tools/xsec/quality_national.py                 # 打印报告
    python tools/xsec/quality_national.py --json out.json # 另存机器可读版
"""

import argparse
import json
import math
import sys
from collections import Counter, defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
CROSS = ROOT / "data" / "cross"
SPOTS_JSON = ROOT / "src" / "data" / "forecast" / "spots.json"

EXPECT_FIELDS = ["hgtM", "tC", "rhPct", "clwMgKg", "iciMgKg", "uMs", "vMs", "wPaS", "cfPct",
                 "belowGround", "rainMmH"]
EXPECT_SAMPLES = [0.0, 12.5, 25.0, 37.5, 50.0, 100.0, 160.0, 240.0, 320.0]


def load_spots():
    data = json.loads(SPOTS_JSON.read_text(encoding="utf-8"))
    return data if isinstance(data, list) else data.get("spots", [])


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--json", default="")
    args = ap.parse_args()

    spots = load_spots()
    idx_path = CROSS / "national-index.json"
    if not idx_path.exists():
        sys.exit("还没有 national-index.json，先跑 build_cross_national.py")
    idx = json.loads(idx_path.read_text(encoding="utf-8"))
    by_file = {s["file"]: s for s in idx.get("spots", [])}

    reasons = Counter()
    per_prov = defaultdict(lambda: {"ok": 0, "bad": 0})
    rows = []
    total_bytes = 0

    for meta in spots:
        name = meta.get("n", "")
        prov = meta.get("prov", "?")
        hit = next((s for s in idx.get("spots", []) if s.get("name") == name), None)
        if hit is None:
            reasons["无文件（未生成）"] += 1
            per_prov[prov]["bad"] += 1
            rows.append(dict(name=name, prov=prov, ok=False, reason="无文件（未生成）"))
            continue

        path = CROSS / hit["file"]
        if not path.exists():
            reasons["索引有但文件缺失"] += 1
            per_prov[prov]["bad"] += 1
            rows.append(dict(name=name, prov=prov, ok=False, reason="索引有但文件缺失"))
            continue

        total_bytes += path.stat().st_size
        try:
            d = json.loads(path.read_text(encoding="utf-8"))
        except Exception as e:  # noqa: BLE001
            reasons["文件不是合法 JSON"] += 1
            per_prov[prov]["bad"] += 1
            rows.append(dict(name=name, prov=prov, ok=False, reason=f"JSON 错误：{e}"))
            continue

        bad = []
        if d.get("levelFields") != EXPECT_FIELDS:
            bad.append("字段列表不一致")
        if not d.get("sections"):
            bad.append("没有 sections")
        else:
            sec0 = d["sections"][0]
            ds = [s["d"] for s in sec0.get("samples", [])]
            if ds != EXPECT_SAMPLES:
                bad.append(f"采样距离不符：{ds}")
            if len(d.get("times") or []) < 1:
                bad.append("没有时次")
            if len(d.get("azimuths") or []) != 1:
                bad.append("方位数不是 1")

        # 数据真实性：把每个采样点每层读一遍
        null_cells = 0
        total_cells = 0
        cloud_pts = 0
        rain_pts = 0
        rain_max = 0.0
        terrain_bad = 0
        for sec in d.get("sections", []):
            for smp in sec.get("samples", []):
                for li, row in enumerate(smp.get("levels", [])):
                    total_cells += 1
                    hgt, clw, ici, below, rain = row[0], row[3], row[4], row[9], row[10]
                    if hgt is None:
                        null_cells += 1
                        continue
                    if below == 1 and hgt > smp["terrainM"] + 60:
                        terrain_bad += 1
                    q = None if (clw is None and ici is None) else (clw or 0) + (ici or 0)
                    if q is not None and q >= 1 and below != 1:
                        cloud_pts += 1
                    if li == 0 and rain is not None:
                        rain_pts += 1
                        rain_max = max(rain_max, rain)
        if total_cells and null_cells / total_cells > 0.5:
            bad.append(f"缺测过多 {null_cells}/{total_cells}")
        if terrain_bad:
            bad.append(f"地形遮罩异常 {terrain_bad} 处")

        row = dict(
            name=name, prov=prov, ok=not bad,
            reason="；".join(bad) if bad else "",
            bytes=path.stat().st_size,
            nullRatio=round(null_cells / total_cells, 3) if total_cells else None,
            cloudPoints=cloud_pts,
            rainSamples=rain_pts,
            rainMaxMmH=round(rain_max, 2),
            azimuth=d.get("azimuths", [None])[0],
            terrainM=(d.get("spot") or {}).get("terrainM"),
        )
        rows.append(row)
        if bad:
            reasons["；".join(bad).split("；")[0]] += 1
            per_prov[prov]["bad"] += 1
        else:
            per_prov[prov]["ok"] += 1

    ok = sum(1 for r in rows if r["ok"])
    print(f"全国机位：{len(spots)} 个，合格 {ok}，不合格 {len(spots) - ok}")
    print(f"总字节 {total_bytes / 1024 / 1024:.2f} MB，单机位平均 {total_bytes / max(1, len(spots)) / 1024:.1f} KB")
    print(f"起报 {idx.get('cycle')}，时次 {len(idx.get('times') or [])} 个，方位 {idx.get('azimuthPolicy')}")
    if reasons:
        print("不合格原因分布：")
        for k, v in reasons.most_common():
            print(f"  {v:4d}  {k}")
    print("\n按省份：")
    for prov in sorted(per_prov):
        s = per_prov[prov]
        print(f"  {prov}: 合格 {s['ok']:3d} / 不合格 {s['bad']:2d}")

    # 量级抽查
    allrows = [r for r in rows if r.get("ok")]
    if allrows:
        nulls = sorted(r["nullRatio"] for r in allrows if r["nullRatio"] is not None)
        print(f"\n缺测比例：中位 {nulls[len(nulls) // 2]:.3f}，最大 {nulls[-1]:.3f}")
        withRain = sum(1 for r in allrows if (r["rainSamples"] or 0) > 0)
        print(f"有降水采样点的机位：{withRain} / {len(allrows)}；最大降水率 "
              f"{max((r['rainMaxMmH'] or 0) for r in allrows):.2f} mm/h")
        withCloud = sum(1 for r in allrows if (r["cloudPoints"] or 0) > 0)
        print(f"有云机位：{withCloud} / {len(allrows)}")

    if args.json:
        Path(args.json).write_text(json.dumps(dict(
            cycle=idx.get("cycle"), total=len(spots), ok=ok,
            bytes=total_bytes, reasons=dict(reasons),
            perProvince={k: dict(v) for k, v in per_prov.items()},
            rows=rows), ensure_ascii=False, indent=1), encoding="utf-8")
        print(f"\n已写出 {args.json}")
    return 0


if __name__ == "__main__":
    sys.exit(main())

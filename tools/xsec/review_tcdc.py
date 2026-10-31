# -*- coding: utf-8 -*-
"""
GFS 云体阈值专项审查（TCDC × CLWMR/ICMR）

背景：上一轮用 GFS 原生云分数 TCDC≥50% 作参照，标定「总凝结水 qt = CLWMR+ICMR」的显示阈值，
      报出 POD 97.2% / FAR 0.96%。**这不是物理定律，只是经验性阈值标定**。
      本脚本回答五个问题：
        1. TCDC 与 CLWMR / ICMR 到底是什么关系（TCDC 是层云量 %，不是水物质质量浓度）
        2. 样本独立吗（同一格点场在空间/时间上强相关 → 有效样本量远小于名义样本量）
        3. 有没有时空数据泄漏（标定与展示用的是同一轮次、同一格点 → in-sample）
        4. 不同预报时效下稳定吗
        5. 液态云与冰晶云要不要不同判据

用法：
    python tools/xsec/review_tcdc.py
    python tools/xsec/review_tcdc.py --cross-cycle 20261031 00 22,23   # 额外做跨起报外推
输出：打印表格 + 写 .cache/xsec/tcdc-review.json（不进仓库）
"""
import argparse
import json
import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent))
import build_cross as B  # noqa: E402

LEVELS = B.LEVELS_HPA
CACHE = B.CACHE_DIR
OUT = CACHE / "tcdc-review.json"


def load_cube(path):
    cube, lats, lons = {}, None, None
    for m in B.decode_messages(path.read_bytes()):
        if m["typ"] != "isobaricInhPa":
            continue
        la, lo, v = B.to_canonical(m)
        if lats is None:
            lats, lons = la, lo
        cube[(m["sn"], int(m["lev"]))] = v
    return cube, lats, lons


def pool_qt(cube, mask=None):
    """把 qt / cf / t 摊平成一维（可选空间掩膜，用于训练/测试切分）"""
    qt, cf, tc, lv = [], [], [], []
    for level in LEVELS:
        if ("tcc", level) not in cube or ("t") not in str(cube.keys()):
            pass
        cf_l = cube[("tcc", level)]
        qt_l = cube[("clwmr", level)] + cube[("icmr", level)]
        tc_l = cube[("t", level)] - 273.15
        if mask is not None:
            cf_l, qt_l, tc_l = cf_l[mask], qt_l[mask], tc_l[mask]
        qt.append(qt_l.ravel())
        cf.append(cf_l.ravel())
        tc.append(tc_l.ravel())
        lv.append(np.full(qt_l.size, level))
    return np.concatenate(qt), np.concatenate(cf), np.concatenate(tc), np.concatenate(lv)


def stats(qt, cf, th):
    cc = cf >= 50.0
    cq = qt >= th
    hit = int((cc & cq).sum())
    miss = int((cc & ~cq).sum())
    fa = int((~cc & cq).sum())
    tn = int((~cc & ~cq).sum())
    tot = max(1, qt.size)
    return dict(
        thKgKg=th, hit=hit, miss=miss, fa=fa, tn=tn,
        pod=round(hit / (hit + miss), 4) if hit + miss else None,
        far=round(fa / (fa + tn), 5) if fa + tn else None,
        agreement=round((hit + tn) / tot, 4),
    )


def threshold_table(qt, cf, thresholds):
    return [stats(qt, cf, th) for th in thresholds]


def lag1_autocorr(field):
    """二维场 i/j 方向的一阶自相关（估计有效样本量用）"""
    a = field - np.nanmean(field)
    var = np.nanmean(a * a)
    if var <= 0:
        return 0.0, 0.0
    ri = np.nanmean(a[:, :-1] * a[:, 1:]) / var
    rj = np.nanmean(a[:-1, :] * a[1:, :]) / var
    return float(ri), float(rj)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--cross-cycle", nargs=3, metavar=("DATE", "HH", "FHS"),
                    help="额外做一个跨起报外推：如 20261031 00 22,23")
    args = ap.parse_args()

    files = sorted(CACHE.glob("filter_*.grib2"))
    if not files:
        sys.exit("没有本地 grib 缓存，先跑一次 tools/xsec/build_cross.py")
    leads = []
    for f in files:
        fh = int(f.stem.split("_f")[-1])
        leads.append((fh, f))
    print(f"本地缓存 {len(leads)} 个时次：{leads}")

    cubes = []
    for fh, path in leads:
        cube, lats, lons = load_cube(path)
        cubes.append((fh, cube, lats, lons))

    thresholds = [1e-6, 2e-6, 5e-6, 1e-5, 2e-5, 1e-4]
    out = {"leads": [c[0] for c in cubes], "thresholds": thresholds}

    # ---------- 1. 逐时效稳定性 ----------
    print("\n=== 1. 逐时效标定（同一轮起报，4 个时效）===")
    print("lead   P(有云点)  阈值=2e-6: POD/FAR   阈值=1e-5: POD/FAR")
    per_lead = []
    for fh, cube, _, _ in cubes:
        qt, cf, tc, _ = pool_qt(cube)
        tab = threshold_table(qt, cf, thresholds)
        per_lead.append(dict(leadHours=fh, table=tab,
                             cloudFrac=round(float((cf >= 50).mean()), 4)))
        t2 = next(r for r in tab if r["thKgKg"] == 2e-6)
        t5 = next(r for r in tab if r["thKgKg"] == 1e-5)
        print(f" {fh:3d}   {(cf >= 50).mean():6.3f}    {t2['pod']}/{t2['far']}        {t5['pod']}/{t5['far']}")
    out["perLead"] = per_lead

    # ---------- 2. 时间外推（训练一个时效，测其他时效）----------
    print("\n=== 2. 时间外推：用 f%d 标定，在其余时效上评估（阈值 2e-6）===" % cubes[0][0])
    _, c0, _, _ = cubes[0]
    qt0, cf0, _, _ = pool_qt(c0)
    t_tab = threshold_table(qt0, cf0, thresholds)
    chosen = next(r for r in t_tab if r["thKgKg"] == 2e-6)
    print(f"训练集：f{cubes[0][0]}，POD={chosen['pod']} FAR={chosen['far']}")
    temp_eval = []
    for fh, cube, _, _ in cubes[1:]:
        qt, cf, _, _ = pool_qt(cube)
        r = stats(qt, cf, 2e-6)
        temp_eval.append(dict(leadHours=fh, **r))
        print(f"测试集 f{fh}：POD={r['pod']} FAR={r['far']} 一致率={r['agreement']}")
    out["temporalHoldout"] = temp_eval

    # ---------- 3. 空间切分（棋盘格：一半格点训练，另一半测试）----------
    print("\n=== 3. 空间外推：棋盘格切半（阈值 2e-6）===")
    _, cube, lats, _ = cubes[0]
    ny, nx = cube[("tcc", LEVELS[0])].shape
    ii, jj = np.meshgrid(np.arange(nx), np.arange(ny))
    mask_a = ((ii + jj) % 2 == 0)
    mask_b = ~mask_a
    qa, ca, _, _ = pool_qt(cube, mask_a)
    qb, cb, _, _ = pool_qt(cube, mask_b)
    ra = stats(qb, cb, 2e-6)
    print(f"训练 A 半区 → 测试 B 半区：POD={ra['pod']} FAR={ra['far']} 一致率={ra['agreement']}")
    rb = stats(qa, ca, 2e-6)
    print(f"训练 B 半区 → 测试 A 半区：POD={rb['pod']} FAR={rb['far']} 一致率={rb['agreement']}")
    out["spatialHoldout"] = [ra, rb]

    # ---------- 4. 有效样本量（空间自相关折算）----------
    print("\n=== 4. 有效样本量估计（空间自相关折算）===")
    n_total = qt0.size
    ri_list, rj_list = [], []
    for level in LEVELS:
        ri, rj = lag1_autocorr(cube[("tcc", level)])
        ri_list.append(ri)
        rj_list.append(rj)
    ri, rj = float(np.mean(ri_list)), float(np.mean(rj_list))
    eff_factor = ((1 - ri) / (1 + ri)) * ((1 - rj) / (1 + rj))
    print(f"名义样本 {n_total}；TCDC 一阶自相关 i={ri:.3f} j={rj:.3f}")
    print(f"按二维自相关折算，有效独立样本 ≈ {n_total * eff_factor:.0f}"
          f"（4 个时效再打折后约 {n_total * eff_factor / 2:.0f}）")
    out["sampleSize"] = dict(nominal=int(n_total), rhoI=round(ri, 3), rhoJ=round(rj, 3),
                             effective=int(n_total * eff_factor))

    # ---------- 5. 温度分相（液态 / 混合 / 冰晶）----------
    print("\n=== 5. 分相标定：暖云(>−5°C) / 混合(−20~−5) / 冰云(<−20°C) ===")
    qt, cf, tc, _ = pool_qt(cube)
    phases = []
    for lo, hi, name in ((-200, -20, "ice"), (-20, -5, "mixed"), (-5, 100, "warm")):
        m = (tc >= lo) & (tc < hi)
        if m.sum() == 0:
            continue
        tab = threshold_table(qt[m], cf[m], [1e-6, 2e-6, 1e-5, 1e-4])
        phases.append(dict(phase=name, samples=int(m.sum()),
                           modelCloudPts=int((cf[m] >= 50).sum()), table=tab))
        best = next(r for r in tab if r["thKgKg"] == 2e-6)
        print(f" {name:6s} n={m.sum():5d} 有云点={int((cf[m]>=50).sum()):4d} "
              f"@2e-6 POD={best['pod']} FAR={best['far']}")
    out["phases"] = phases

    # ---------- 6. TCDC 与 CLWMR / ICMR 的逐层关系 ----------
    print("\n=== 6. 逐层：corr(TCDC, CLWMR) / corr(TCDC, ICMR) / corr(TCDC, qt) ===")
    print(" 层     r(cf,clw)  r(cf,ici)  r(cf,qt)   TCDC>=50处 qt 中位数   TCDC<=10处 qt 99 分位")
    rows = []
    for level in LEVELS:
        cf_l = cube[("tcc", level)].ravel()
        clw = cube[("clwmr", level)].ravel()
        ici = cube[("icmr", level)].ravel()
        qtl = clw + ici
        def corr(a, b):
            a0, b0 = a - a.mean(), b - b.mean()
            d = np.sqrt((a0 * a0).sum() * (b0 * b0).sum())
            return float((a0 * b0).sum() / d) if d > 0 else float("nan")
        med = float(np.median(qtl[cf_l >= 50])) if (cf_l >= 50).any() else float("nan")
        p99 = float(np.percentile(qtl[cf_l <= 10], 99)) if (cf_l <= 10).any() else float("nan")
        rows.append(dict(level=level, rClw=round(corr(cf_l, clw), 3), rIci=round(corr(cf_l, ici), 3),
                         rQt=round(corr(cf_l, qtl), 3), qtMedianInCloud=med, qtP99Clear=p99))
        print(f" {level:5d}   {corr(cf_l, clw):+.3f}     {corr(cf_l, ici):+.3f}     {corr(cf_l, qtl):+.3f}      "
              f"{med:9.2e}        {p99:9.2e}")
    out["perLevelCorrelation"] = rows

    # ---------- 7. 跨起报外推 ----------
    if args.cross_cycle:
        date, hh, fhs = args.cross_cycle
        print(f"\n=== 7. 跨起报外推：gfs.{date} {hh}Z f{fhs} ===")
        pairs = [(v, lv) for v in ("CLWMR", "ICMR", "TCDC", "TMP") for lv in LEVELS]
        cross = []
        for fh in [int(x) for x in fhs.split(",")]:
            got = B.fetch_via_filter(date, hh, fh, pairs)
            if got is None:
                got = B.fetch_via_range(date, hh, fh, pairs)
            cube2 = {}
            for v, short in (("CLWMR", "clwmr"), ("ICMR", "icmr"), ("TCDC", "tcc"), ("TMP", "t")):
                for lv in LEVELS:
                    cube2[(short, lv)] = B.to_canonical(got[(short, lv)])[2]
            q2, c2, t2, _ = pool_qt(cube2)
            tr = stats(q2, c2, 2e-6)
            # 用本轮阈值去评估另一轮
            print(f" 另一轮 f{fh}：POD={tr['pod']} FAR={tr['far']} 一致率={tr['agreement']}")
            cross.append(dict(cycle=f"{date}{hh}", fh=fh, **tr))
        out["crossCycle"] = cross

    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(out, ensure_ascii=False, indent=1, default=float), encoding="utf-8")
    print(f"\n结果已写入 {OUT}（.cache 已 gitignore，不进仓库）")


if __name__ == "__main__":
    main()

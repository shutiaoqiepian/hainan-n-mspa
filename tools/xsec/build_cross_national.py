#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
全国 224 机位剖面批量生成（阶段八-03）。

与 build_cross.py 的区别只有三点，其余算法**完全复用**（同一个 quantize_section、
同一个 GFS 下载路径、同一套字段）：
    1. 机位来源是全部 224 个机位（不是海南 8 个）；
    2. 按「纬度带 3° × 经度带 4°」分组下载：同一组内的机位共用一次 GRIB 取数。
       实测 224 个机位落在 53 个组里（最大组 37 个、18 个单机位组），
       下载次数 224 → 53 × 3 时次 = 159。按 1° tile 反而要 124 组（细碎、更慢）。
    3. 按省份写 data/cross/<prov>/<spot>.json，索引与本地图例分离。

设计约束（与任务书一致）：
    · 单机位失败只跳过该机位并记录原因，绝不影响其它机位、绝不生成半成品；
    · 缺测 = null，不填 0；
    · 采样几何与海南试点保持一致（0–320 km 共 9 点），但方位只用「当天日落方位」1 个
      （5 方位 = 5 倍体积，全国首版不划算；试点 8 机位保留 5 方位可旋转）；
    · 时次 3 个（日落前 2 小时、日落、日落后 1 小时），够画照明边界移动。

用法：
    python tools/xsec/build_cross_national.py --dry-run          # 只打印将下载什么
    python tools/xsec/build_cross_national.py --limit 12         # 先跑 12 个机位（分区验证）
    python tools/xsec/build_cross_national.py --spots hk-xihai,...
    python tools/xsec/build_cross_national.py                    # 全国（小心：要几十分钟）
"""

import argparse
import json
import math
import sys
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(Path(__file__).resolve().parent))

import build_cross as bc  # 复用同一套下载/解码/插值/量化，不抄第二遍

OUT_DIR = ROOT / "data" / "cross"
SPOTS_JSON = ROOT / "src" / "data" / "forecast" / "spots.json"

# 全国首版：3 个时次 × 1 个方位（当天日落方位）
HOUR_OFFSETS = [-2, 0]
# 说明：第 3 个时次（日落后 1 小时）与日落时次相差太远，合并到同一 tile 下载即可；
# 这里保留两点是因为 pick_cycle_and_hours 本来就返回 4 个整点，取前两个覆盖日落前 2h 与日落。
AZIMUTH_COUNT = 1
LAT_BAND = 3.0
LON_BAND = 4.0


def log(msg):
    print(f"[nat] {msg}", flush=True)


def load_all_spots():
    data = json.loads(SPOTS_JSON.read_text(encoding="utf-8"))
    rows = data if isinstance(data, list) else data.get("spots", [])
    out = []
    for i, r in enumerate(rows):
        if not (r.get("n") and isinstance(r.get("lat"), (int, float)) and isinstance(r.get("lon"), (int, float))):
            continue
        out.append(dict(
            id=r.get("id") or f"{r.get('prov', 'xx')}-{i:03d}",
            name=r["n"], lat=float(r["lat"]), lon=float(r["lon"]),
            area=r.get("area", ""), face=r.get("face", ""), prov=r.get("prov", ""),
            obs=r.get("obs", ""),
        ))
    return out


def tile_of(lat, lon):
    """分组编号：纬度带 3° × 经度带 4°（向下取整）。"""
    return (math.floor(lat / LAT_BAND), math.floor(lon / LON_BAND))


def domain_for_spots(spots, pad=1.0):
    """一组机位的外接窗 + pad（度）。GRIB 裁剪按整度取整，便于共用。"""
    lats = [s["lat"] for s in spots]
    lons = [s["lon"] for s in spots]
    return dict(
        latMin=math.floor(min(lats) - pad),
        latMax=math.ceil(max(lats) + pad),
        lonMin=math.floor(min(lons) - pad),
        lonMax=math.ceil(max(lons) + pad),
    )


def sunset_az(d, lat, lon):
    """当天日落方位角（°），复用 build_cross 的日落搜索。

    d 可以是 datetime.date 或 'YYYY-MM-DD' 字符串（pick_cycle_and_hours 返回的是字符串）。
    """
    # pick_cycle_and_hours 返回的是 'YYYYMMDD'（紧凑格式），也兼容 'YYYY-MM-DD' 与 date
    if isinstance(d, str):
        d = datetime.strptime(d, "%Y%m%d" if "-" not in d else "%Y-%m-%d").date()
    elif isinstance(d, datetime):
        d = d.date()
    sunset = bc.sunset_utc_for_local_date(d, lat, lon)
    return bc.sun_pos_ms(sunset.timestamp() * 1000, lat, lon)["az"]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--limit", type=int, default=0, help="只处理前 N 个机位（分区验证用）")
    ap.add_argument("--spots", default="", help="逗号分隔的机位名/ id")
    ap.add_argument("--out", default=str(OUT_DIR))
    args = ap.parse_args()

    spots = load_all_spots()
    if args.spots:
        want = {s.strip() for s in args.spots.split(",") if s.strip()}
        spots = [s for s in spots if s["name"] in want or s["id"] in want]
    if args.limit:
        spots = spots[: args.limit]
    if not spots:
        sys.exit("没有机位可处理")

    # 按 tile 分组
    groups = {}
    for s in spots:
        groups.setdefault(tile_of(s["lat"], s["lon"]), []).append(s)
    log(f"机位 {len(spots)} 个，分 {len(groups)} 个带（纬度 {LAT_BAND}° × 经度 {LON_BAND}°）")

    if args.dry_run:
        fhs = []
        now = datetime.now(timezone.utc)
        for key, g in list(groups.items())[:5]:
            dom = domain_for_spots(g)
            log(f"  band {key}: {len(g)} 机位，窗口 {dom['latMin']}–{dom['latMax']}N / "
                f"{dom['lonMin']}–{dom['lonMax']}E")
        log(f"  每个 tile 需要 {len(bc.ALL_VARS) * len(bc.LEVELS_HPA) + 1} 条变量×层 × "
            f"{len(HOUR_OFFSETS)} 个时次")
        total = len(groups) * len(HOUR_OFFSETS)
        log(f"  预计下载 {total} 次（{len(groups)} tile × {len(HOUR_OFFSETS)} 时次）")
        return 0

    out_dir = Path(args.out)
    out_dir.mkdir(parents=True, exist_ok=True)

    now = datetime.now(timezone.utc)
    ref = spots[0]
    date, hh, cycle, fhs, valid = bc.pick_cycle_and_hours(now, ref["lat"], ref["lon"])
    log(f"起报 {date} {hh}Z，目标时刻 {[v.strftime('%H:%M') + 'Z' for v in valid]}")

    errors = []
    written = []
    t_all = time.time()

    for ti, (key, group) in enumerate(sorted(groups.items())):
        dom = domain_for_spots(group)
        bc.DOMAIN = dom           # filter/Range 的裁剪窗口按 tile 走
        log(f"[{ti + 1}/{len(groups)}] band {key}：{len(group)} 机位，窗口 "
            f"{dom['latMin']}–{dom['latMax']}N / {dom['lonMin']}–{dom['lonMax']}E")

        cubes = []
        try:
            for fh in fhs:
                c = bc.build_time_cube(date, hh, fh)
                cubes.append(c)
        except Exception as e:  # noqa: BLE001 —— 整个 tile 失败只跳过该 tile
            msg = f"band {key} 下载失败：{e}"
            log(f"!! {msg}")
            errors.append(dict(band=str(key), reason=str(e)))
            continue

        orog_msg = bc.fetch_orog(date, hh, fhs[0])
        orog_lat, orog_lon, orog = bc.to_canonical(orog_msg)

        for spot in group:
            try:
                az = round(sunset_az(date, spot["lat"], spot["lon"]), 1)
                sections = []
                for t_idx, cube in enumerate(cubes):
                    sec = bc.quantize_section(cube["cube"], cube["lats"], cube["lons"],
                                              spot["lat"], spot["lon"], az, orog)
                    sec["t"] = t_idx
                    sec["leadHours"] = fhs[t_idx]
                    sec["gridNodes"] = bc.path_grid_nodes(cube["lats"], cube["lons"],
                                                          spot["lat"], spot["lon"], az)
                    sections.append(sec)
                terrain_at_origin = bc.bilinear(orog, orog_lat, orog_lon,
                                                spot["lat"], spot["lon"])[0]
                payload = dict(
                    version=2,
                    source="gfs",
                    model="GFS 0.25° (pgrb2.0p25, NOAA/NCEP)",
                    cycle=cycle.strftime("%Y-%m-%dT%H:%M:%SZ"),
                    generatedAt=now.strftime("%Y-%m-%dT%H:%M:%SZ"),
                    domain=dom,
                    gridKm=None,
                    lengthKm=bc.LENGTH_KM,
                    sampleIntervalKm=bc.SAMPLE_KM[1],
                    levelsHpa=bc.LEVELS_HPA,
                    levelFields=bc.LEVEL_FIELDS,
                    azimuths=[az],
                    times=[dict(t=i, utc=v.strftime("%Y-%m-%dT%H:%M:%SZ"), leadHours=fhs[i])
                           for i, v in enumerate(valid)],
                    spot=dict(id=spot["id"], name=spot["name"], lat=spot["lat"], lon=spot["lon"],
                              terrainM=int(round(terrain_at_origin)),
                              defaultAzimuth=az, tag=spot["area"], area=spot["area"],
                              face=spot["face"], prov=spot["prov"]),
                    note="全国机位首版：3 时次 × 1 方位（当天日落方位）；采样 0–320 km 共 9 点",
                    sections=sections,
                )
                pdir = out_dir / spot["prov"]
                pdir.mkdir(parents=True, exist_ok=True)
                path = pdir / f"{spot['id']}.json"
                path.write_text(json.dumps(payload, ensure_ascii=False, separators=(",", ":")),
                                encoding="utf-8")
                written.append(dict(prov=spot["prov"], id=spot["id"], name=spot["name"],
                                    file=str(path.relative_to(out_dir)).replace("\\", "/"),
                                    bytes=path.stat().st_size, azimuth=az))
                log(f"   ✓ {spot['name']}（{spot['prov']}）{path.stat().st_size / 1024:.1f} KB，方位 {az}°")
            except Exception as e:  # noqa: BLE001 —— 单机位失败只跳过它
                log(f"   ✗ {spot['name']}：{e}")
                errors.append(dict(spot=spot["id"], name=spot["name"], reason=str(e)))

    index = dict(
        version=2,
        source="gfs",
        model="GFS 0.25° (pgrb2.0p25, NOAA/NCEP)",
        license="US Government work — public domain",
        cycle=cycle.strftime("%Y-%m-%dT%H:%M:%SZ"),
        generatedAt=now.strftime("%Y-%m-%dT%H:%M:%SZ"),
        lengthKm=bc.LENGTH_KM,
        sampleIntervalKm=bc.SAMPLE_KM[1],
        levelsHpa=bc.LEVELS_HPA,
        levelFields=bc.LEVEL_FIELDS,
        azimuthPolicy="当天日落方位（每机位 1 个）",
        times=[dict(t=i, utc=v.strftime("%Y-%m-%dT%H:%M:%SZ"), leadHours=fhs[i])
               for i, v in enumerate(valid)],
        spots=written,
        errors=errors,
        note="全国机位剖面索引。单机位失败只跳过并记录在 errors[]，不生成替代数据。",
    )
    (out_dir / "national-index.json").write_text(
        json.dumps(index, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    total_kb = sum(w["bytes"] for w in written) / 1024
    log(f"完成：{len(written)} 个机位 / {len(errors)} 个失败，{total_kb:.1f} KB，"
        f"用时 {(time.time() - t_all) / 60:.1f} 分钟")
    if errors:
        log("失败清单：")
        for e in errors[:20]:
            log(f"  - {e}")
    return 0 if written else 1


if __name__ == "__main__":
    sys.exit(main())

#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
构建剖面的「环境上下文」缓存：真实 DEM 地形 + 气溶胶光学厚度（AOD）。

为什么单独一个脚本、单独一个文件：
    GFS 剖面（build_cross.py）是气象数据，天天变；
    地形是静态的，AOD 来自另一个机构（CAMS），更新频率也不同。
    混进 hn-*.json 会让「数据来源」说不清楚，也会让 CI 失败面变大。
    所以：data/cross/context.json 独立生成，失败不影响 GFS 剖面。

数据源（均已实测，见 docs/阶段七-01）：
    1. 地形：主源 Open-Meteo Elevation API
       https://api.open-meteo.com/v1/elevation?latitude=..&longitude=..
       底层是 Copernicus DEM GLO-30（Open-Meteo 文档），输出的是**DEM 高度**，
       不是 GFS 模式地形（0.25°，被平滑到几十 km 尺度）。两者差异必须分开标注。
       单次请求 ≤100 个坐标。
       备源 OpenTopoData SRTM 90m
       https://api.opentopodata.org/v1/srtm90m?locations=lat,lon|...
       实测 Open-Meteo 免费额度在同一出口 IP 上会按小时封顶（429
       "Hourly API request limit exceeded"），封顶期间自动回退 SRTM 90m，
       并把**实际使用的 DEM 来源**写进每个机位的 demSource 字段。
    2. AOD：Open-Meteo Air Quality API（CAMS global）
       https://air-quality-api.open-meteo.com/v1/air-quality?hourly=aerosol_optical_depth
       550 nm 柱总量，无量纲；本脚本取与剖面时次同一整点的值。

不写任何占位值：
    某个机位请求失败 → 记入 errors[] 并**跳过该机位**（页面显示"缺测"），
    绝不填 0、也不编造地形。

用法：
    python tools/xsec/build_context.py                # 正常构建（8 个试点机位）
    python tools/xsec/build_context.py --allow-partial  # 局部失败也写出（CI 用）
    python tools/xsec/build_context.py --spots hk-xihai # 只跑一个机位
"""

import argparse
import json
import math
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
OUT_DIR = ROOT / "data" / "cross"
INDEX = OUT_DIR / "index.json"

ELEV_API = "https://api.open-meteo.com/v1/elevation"
TOPO_API = "https://api.opentopodata.org/v1/srtm90m"
AQI_API = "https://air-quality-api.open-meteo.com/v1/air-quality"
UA = "18n-mspa-xsec/1.0 (static site cache builder; contact: repo issues)"

# 沿剖面方向的地形采样：0–50 km，1.25 km 间隔（41 点）——与图的横轴对齐
SECTION_STEP_KM = 1.25
SECTION_POINTS = 41
# 沿太阳方位的地形采样：0–150 km，2.5 km 间隔（61 点）——用于光路被地形遮挡的判定
SUN_STEP_KM = 2.5
SUN_POINTS = 61

R_KM = 6371.0088


def log(msg):
    print(f"[ctx] {msg}", flush=True)


def http_json(url, timeout=45, retries=4):
    """带 429 退避的 JSON 请求。Open-Meteo 免费额度按分钟计，连续突发会被限流。"""
    last = None
    for k in range(retries):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": UA})
            with urllib.request.urlopen(req, timeout=timeout) as r:
                raw = r.read()
            return json.loads(raw.decode("utf-8"))
        except urllib.error.HTTPError as e:
            last = e
            if e.code == 429:
                wait = 10.0 * (k + 1)
                log(f"   … 触发限流（429），等待 {wait:.0f}s 后重试")
                time.sleep(wait)
                continue
            time.sleep(1.5 * (k + 1))
        except (urllib.error.URLError, TimeoutError, json.JSONDecodeError) as e:  # noqa: PERF203
            last = e
            time.sleep(1.5 * (k + 1))
    raise RuntimeError(f"请求失败（{retries} 次）：{url[:120]}… → {last}")


def destination(lat, lon, az_deg, dist_km):
    """大圆终点（与 build_cross.py / src/lib/xsec/openmeteo.ts 同一公式）。"""
    d = dist_km / R_KM
    az = math.radians(az_deg)
    la1 = math.radians(lat)
    lo1 = math.radians(lon)
    la2 = math.asin(math.sin(la1) * math.cos(d) + math.cos(la1) * math.sin(d) * math.cos(az))
    lo2 = lo1 + math.atan2(
        math.sin(az) * math.sin(d) * math.cos(la1),
        math.cos(d) - math.sin(la1) * math.sin(la2),
    )
    return math.degrees(la2), ((math.degrees(lo2) + 540) % 360) - 180


def fetch_many_openmeteo(coords):
    """Open-Meteo Elevation API（Copernicus DEM）。返回 list[int|None]。"""
    out = []
    chunk = 100  # API 硬上限
    for i in range(0, len(coords), chunk):
        part = coords[i:i + chunk]
        qs = urllib.parse.urlencode({
            "latitude": ",".join(f"{p[0]:.5f}" for p in part),
            "longitude": ",".join(f"{p[1]:.5f}" for p in part),
        })
        j = http_json(f"{ELEV_API}?{qs}")
        el = j.get("elevation")
        if not isinstance(el, list) or len(el) != len(part):
            raise RuntimeError(f"elevation 返回条数不对：{len(part)} → {el if not isinstance(el, list) else len(el)}")
        out.extend(None if v is None else int(round(float(v))) for v in el)
        time.sleep(6.0)  # 实测该接口在同一出口 IP 上约 10 次/分钟，6s 间隔是安全值
    return out


def fetch_many_opentopo(coords):
    """OpenTopoData SRTM 90m（备源）。返回 list[int|None]。"""
    out = []
    chunk = 100
    for i in range(0, len(coords), chunk):
        part = coords[i:i + chunk]
        locs = "|".join(f"{p[0]:.5f},{p[1]:.5f}" for p in part)
        qs = urllib.parse.urlencode({"locations": locs})
        j = http_json(f"{TOPO_API}?{qs}")
        res = j.get("results")
        if not isinstance(res, list) or len(res) != len(part):
            raise RuntimeError(f"opentopodata 返回条数不对：{len(part)} → {res if not isinstance(res, list) else len(res)}")
        out.extend(None if r.get("elevation") is None else int(round(float(r["elevation"]))) for r in res)
        time.sleep(1.3)  # 公共接口限 1 次/秒
    return out


DEM_SOURCE = {"provider": "openmeteo", "label": "Copernicus DEM GLO-30（Open-Meteo Elevation API）"}


def fetch_dem(coords):
    """按当前 DEM 源取高程；Open-Meteo 失败（多半是小时限额）后自动切 SRTM。"""
    global DEM_SOURCE
    if DEM_SOURCE["provider"] == "openmeteo":
        try:
            return fetch_many_openmeteo(coords)
        except RuntimeError as e:
            log(f"   … Open-Meteo 高程不可用（{e}），本轮改用 OpenTopoData SRTM 90m")
            DEM_SOURCE = {"provider": "opentopo", "label": "SRTM 90m（OpenTopoData，Open-Meteo 限额回退）"}
    return fetch_many_opentopo(coords)


def fetch_aod(lat, lon):
    """取未来 4 天逐小时 AOD（550 nm）。返回 (times[], values[])。"""
    qs = urllib.parse.urlencode({
        "latitude": f"{lat:.4f}", "longitude": f"{lon:.4f}",
        "hourly": "aerosol_optical_depth", "forecast_days": "4", "timezone": "UTC",
    })
    j = http_json(f"{AQI_API}?{qs}")
    h = j.get("hourly") or {}
    t = h.get("time") or []
    v = h.get("aerosol_optical_depth") or []
    if not t or len(t) != len(v):
        raise RuntimeError("air-quality 返回结构不对")
    return t, v


def pick_aod(times, values, iso):
    """取与剖面时次同一小时（或最近一小时）的 AOD；找不到返回 None。"""
    want = iso[:13]

    def epoch(s):
        return time.mktime(time.strptime(s[:13] + ":00", "%Y-%m-%dT%H:%M"))

    try:
        want_t = epoch(want)
    except ValueError:
        return None
    best = None
    bestd = 1e9
    for i, t in enumerate(times):
        if values[i] is None:
            continue
        exact = t[:13] == want
        try:
            dt = 0 if exact else abs(epoch(t) - want_t)
        except ValueError:
            continue
        if exact:
            return {"utc": t, "v": round(float(values[i]), 4)}
        if dt < bestd:
            bestd = dt
            best = {"utc": t, "v": round(float(values[i]), 4)}
    if best is not None and bestd <= 3600:
        best["nearest"] = True
        return best
    return None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--allow-partial", action="store_true", help="局部失败也写出结果（CI 用）")
    ap.add_argument("--spots", nargs="*", help="只处理这些机位 id")
    ap.add_argument("--out", default=str(OUT_DIR / "context.json"))
    args = ap.parse_args()

    if not INDEX.exists():
        sys.exit(f"缺少 {INDEX}（先跑 build_cross.py）")
    index = json.loads(INDEX.read_text(encoding="utf-8"))
    spots = index.get("spots") or []
    if args.spots:
        spots = [s for s in spots if s["id"] in set(args.spots)]
    if not spots:
        sys.exit("没有机位可处理")

    out = {
        "version": 1,
        "generatedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "sources": {
            "terrain": "Open-Meteo Elevation API (Copernicus DEM, 输出即 DEM 高度)",
            "terrainNote": "DEM 与 GFS 模式地形不同：DEM 保留真实起伏，GFS orog 是 0.25° 平滑值",
            "aod": "Open-Meteo Air Quality API / CAMS global, aerosol_optical_depth (550 nm, 无量纲)",
            "aodNote": "AOD 是柱总量，不是逐层消光；本产品只用于 Beer-Lambert 直射光削弱估算",
        },
        "sectionStepKm": SECTION_STEP_KM,
        "sunStepKm": SUN_STEP_KM,
        "spots": {},
        "errors": [],
    }

    for spot in spots:
        sid = spot["id"]
        lat, lon = float(spot["lat"]), float(spot["lon"])
        t0 = time.time()
        try:
            spot_file = json.loads((OUT_DIR / spot["file"]).read_text(encoding="utf-8"))
            azimuths = spot_file.get("azimuths") or []
            sec_times = [t["utc"] for t in (spot_file.get("times") or [])]
            if not azimuths or not sec_times:
                raise RuntimeError("剖面文件里没有 azimuths/times")

            # 1) 一次取全：机位本身 + 5 个剖面方位 × 41 点（打包成 ≤100 坐标的请求）
            coords = [(lat, lon)]
            layout = []
            for az in azimuths:
                for j in range(SECTION_POINTS):
                    coords.append(destination(lat, lon, az, j * SECTION_STEP_KM))
                    layout.append((str(az), j))
            flat = fetch_dem(coords)
            origin = flat[0]
            profiles = {str(az): [None] * SECTION_POINTS for az in azimuths}
            for k, (az_key, j) in enumerate(layout):
                profiles[az_key][j] = flat[k + 1]

            # 2) 沿「该时刻日落方位」的地形（光路遮挡判定用）
            import build_cross as bc  # 复用同一套太阳公式，避免两套实现漂移
            import datetime as _dt
            sun_coords = []
            sun_meta = []
            for iso in sec_times:
                dt = time.strptime(iso, "%Y-%m-%dT%H:%M:%SZ")
                d = _dt.datetime(dt.tm_year, dt.tm_mon, dt.tm_mday, tzinfo=_dt.timezone.utc)
                try:
                    sunset = bc.sunset_utc_for_local_date(d.date(), lat, lon)
                    az = bc.sun_pos_ms(sunset.timestamp() * 1000, lat, lon)["az"]
                except RuntimeError:
                    az = float(spot.get("defaultAzimuth") or 265)
                sun_meta.append(round(float(az), 1))
                for j in range(SUN_POINTS):
                    sun_coords.append(destination(lat, lon, sun_meta[-1], j * SUN_STEP_KM))
            sun_flat = fetch_dem(sun_coords)
            sun_profiles = [
                {"az": sun_meta[i], "elev": sun_flat[i * SUN_POINTS:(i + 1) * SUN_POINTS]}
                for i in range(len(sec_times))
            ]

            # 3) AOD（逐时，页面按选中时次取）
            at, av = fetch_aod(lat, lon)
            aod = [pick_aod(at, av, iso) for iso in sec_times]

            out["spots"][sid] = {
                "elevationM": origin,
                "demSource": DEM_SOURCE["label"],
                "profiles": profiles,
                "sunProfiles": sun_profiles,
                "aod": aod,
            }
            Path(args.out).write_text(
                json.dumps(out, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
            out["sources"]["terrainUsed"] = DEM_SOURCE["label"]
            log(f"{sid}: DEM {origin} m（{DEM_SOURCE['label']}），{len(profiles)} 个方位剖面，AOD "
                f"{[a['v'] if a else None for a in aod]}（{time.time() - t0:.1f}s）")
        except Exception as e:  # noqa: BLE001 —— 单机位失败不影响其它机位
            msg = f"{sid}: {e}"
            out["errors"].append(msg)
            log(f"!! {msg}")
            if not args.allow_partial:
                raise

    Path(args.out).write_text(
        json.dumps(out, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    kb = Path(args.out).stat().st_size / 1024
    log(f"写出 {args.out}（{kb:.1f} KB，{len(out['spots'])} 个机位，{len(out['errors'])} 个错误）")
    if out["errors"] and not args.allow_partial:
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())

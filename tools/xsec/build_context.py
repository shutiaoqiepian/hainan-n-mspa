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
from datetime import datetime, timezone
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
    """OpenTopoData SRTM 90m（备源）。返回 list[int|None]。

    该接口单次点数少、容易超时，所以每段只发 50 个点、超时放宽到 90 s。
    """
    out = []
    chunk = 50
    for i in range(0, len(coords), chunk):
        part = coords[i:i + chunk]
        locs = "|".join(f"{p[0]:.5f},{p[1]:.5f}" for p in part)
        qs = urllib.parse.urlencode({"locations": locs})
        j = http_json(f"{TOPO_API}?{qs}", timeout=90, retries=3)
        res = j.get("results")
        if not isinstance(res, list) or len(res) != len(part):
            raise RuntimeError(f"opentopodata 返回条数不对：{len(part)} → {res if not isinstance(res, list) else len(res)}")
        out.extend(None if r.get("elevation") is None else int(round(float(r["elevation"]))) for r in res)
        time.sleep(1.3)  # 公共接口限 1 次/秒
    return out


DEM_SOURCE = {"provider": "openmeteo", "label": "Copernicus DEM GLO-30（Open-Meteo Elevation API）"}


def fetch_dem(coords):
    """按当前 DEM 源取高程。

    Open-Meteo 被限流（429）时切到 SRTM；SRTM 也失败时**每批重新试一次主源**——
    否则一旦回退就永远用备源，既慢（每批 1–2 分钟）又错过限额恢复的窗口。
    """
    global DEM_SOURCE
    if DEM_SOURCE["provider"] == "openmeteo":
        try:
            return fetch_many_openmeteo(coords)
        except RuntimeError as e:
            log(f"   … Open-Meteo 高程不可用（{e}），本批改用 OpenTopoData SRTM 90m")
            DEM_SOURCE = {"provider": "opentopo", "label": "SRTM 90m（OpenTopoData，Open-Meteo 限额回退）"}
    try:
        return fetch_many_opentopo(coords)
    except RuntimeError as e:
        # SRTM 也挂了：下一批重新试主源（限额是按小时算的，可能已经恢复）
        log(f"   … SRTM 也不可用（{e}），下一批重新尝试 Open-Meteo")
        DEM_SOURCE = {"provider": "openmeteo", "label": "Copernicus DEM GLO-30（Open-Meteo Elevation API）"}
        raise


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


def dem_batch(batch, out):
    """一批机位合并取 DEM（每批 100 坐标以内），AOD 逐机位取。结果写入 out['spots']。"""
    spots_info = []
    coords = []
    for sp in batch:
        spot_file = json.loads((OUT_DIR / sp["file"]).read_text(encoding="utf-8"))
        meta = spot_file.get("spot") or {}
        lat = float(meta.get("lat", sp.get("lat")))
        lon = float(meta.get("lon", sp.get("lon")))
        if not math.isfinite(lat) or not math.isfinite(lon):
            raise RuntimeError(f"{sp['id']} 经纬度缺失")
        azimuths = spot_file.get("azimuths") or []
        sec_times = [t["utc"] for t in (spot_file.get("times") or [])]
        if not azimuths or not sec_times:
            raise RuntimeError(f"{sp['id']} 剖面文件里没有 azimuths/times")
        # 采样点：机位本身 + 每个剖面方位 41 点 + 太阳方位 61 点
        pts = [(lat, lon)]
        layout = []
        for az in azimuths:
            for j in range(SECTION_POINTS):
                pts.append(destination(lat, lon, az, j * SECTION_STEP_KM))
                layout.append(("sec", str(az), j))
        sun_meta = []
        # 太阳方位地形只需"日落方位"那一组：4 个时次的日落方位相差 <5°，
        # 存 4 份是 4 倍体积换 0 收益（实测相邻时次方位差 0.0–3.2°）。
        # 其余时次复用第 0 份，并用 sunProfilesSourceTime 标注，前端不重复取数。
        for iso in sec_times[:1]:
            d0 = datetime.strptime(iso, "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=timezone.utc)
            try:
                import build_cross as bc
                sunset = bc.sunset_utc_for_local_date(d0.date(), lat, lon)
                az_sun = bc.sun_pos_ms(sunset.timestamp() * 1000, lat, lon)["az"]
            except Exception:  # noqa: BLE001
                az_sun = float(spot_file.get("spot", {}).get("defaultAzimuth") or 265)
            sun_meta.append(round(float(az_sun), 1))
            for j in range(SUN_POINTS):
                pts.append(destination(lat, lon, sun_meta[-1], j * SUN_STEP_KM))
                layout.append(("sun", len(sun_meta) - 1, j))
        spots_info.append(dict(sp=sp, lat=lat, lon=lon, azimuths=azimuths,
                               sec_times=sec_times, sun_meta=sun_meta,
                               offset=len(coords), layout=layout))
        coords.extend(pts)

    flat = fetch_dem(coords)
    log(f"   DEM 打包请求：{len(coords)} 个坐标（{len(batch)} 个机位）")
    for info in spots_info:
        off = info["offset"]
        profile = {str(az): [None] * SECTION_POINTS for az in info["azimuths"]}
        sun_profiles = [{"az": info["sun_meta"][0], "elev": [None] * SUN_POINTS}
                        for _ in info["sec_times"]]
        origin = flat[off]
        for (kind, key, j) in info["layout"]:
            v = flat[off + 1 + info["layout"].index((kind, key, j))]
            if kind == "sec":
                profile[key][j] = v
            else:
                for sp_ in sun_profiles:
                    sp_["elev"][j] = v
        # AOD：逐机位一次请求（CAMS 接口不支持批量点）
        try:
            at, av = fetch_aod(info["lat"], info["lon"])
            aod = [pick_aod(at, av, iso) for iso in info["sec_times"]]
        except Exception as e:  # noqa: BLE001
            log(f"   … {info['sp']['id']} AOD 失败（{e}），记为缺测")
            aod = [None] * len(info["sec_times"])
        out["spots"][info["sp"]["id"]] = dict(
            elevationM=origin,
            demSource=DEM_SOURCE["label"],
            profiles=profile,
            sunProfiles=sun_profiles,
            aod=aod,
        )


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--allow-partial", action="store_true", help="局部失败也写出结果（CI 用）")
    ap.add_argument("--spots", nargs="*", help="只处理这些机位 id")
    ap.add_argument("--out", default=str(OUT_DIR / "context.json"))
    ap.add_argument("--index", default=str(INDEX),
                    help="机位索引：默认海南试点 index.json；全国用 national-index.json")
    ap.add_argument("--batch", type=int, default=1,
                    help="每批合并多少机位的 DEM 采样点（全国 224 机位用 6–8，可把请求数降到 1/5）")
    ap.add_argument("--skip-existing", action="store_true",
                    help="已有 context 的机位跳过（分批续跑用，避免重复请求）")
    args = ap.parse_args()

    idx_path = Path(args.index)
    if not idx_path.exists():
        sys.exit(f"缺少 {idx_path}（先跑 build_cross.py 或 build_cross_national.py）")
    index = json.loads(idx_path.read_text(encoding="utf-8"))
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

    # 续跑：先把输出文件里已有的机位并进来（--skip-existing 时不再重复请求）
    out_path_obj = Path(args.out)
    if out_path_obj.exists():
        try:
            prev = json.loads(out_path_obj.read_text(encoding="utf-8"))
            for k, v in (prev.get("spots") or {}).items():
                out["spots"][k] = v
            log(f"续跑：已有 {len(out['spots'])} 个机位的上下文")
        except Exception as e:  # noqa: BLE001
            log(f"  已有输出读不出来，忽略：{e}")

    batch_size = max(1, int(args.batch))
    pending = [sp for sp in spots if not (args.skip_existing and sp["id"] in out["spots"])]
    log(f"待处理 {len(pending)} 个机位（批量 {batch_size}）")

    for bi in range(0, len(pending), batch_size):
        batch = pending[bi:bi + batch_size]
        t0 = time.time()
        try:
            dem_batch(batch, out)
        except Exception as e:  # noqa: BLE001 —— 一批失败只影响这一批
            log(f"!! 批 {bi // batch_size + 1} 失败：{e}")
            for sp in batch:
                out["errors"].append(f"{sp['id']}: {e}")
        Path(args.out).write_text(
            json.dumps(out, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
        log(f"批 {bi // batch_size + 1}/{(len(pending) + batch_size - 1) // batch_size} 完成，"
            f"累计 {len(out['spots'])} 个机位（{time.time() - t0:.1f}s）")

    out["sources"]["terrainUsed"] = DEM_SOURCE["label"]
    Path(args.out).write_text(
        json.dumps(out, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    kb = Path(args.out).stat().st_size / 1024
    log(f"写出 {args.out}（{kb:.1f} KB，{len(out['spots'])} 个机位，{len(out['errors'])} 个错误）")
    if out["errors"] and not args.allow_partial:
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())

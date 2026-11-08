#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
构建「大气水平—垂直截面」(cross section) 静态缓存。

数据源：NOAA GFS 0.25°（pgrb2.0p25，公有领域，无需 key）
    https://nomads.ncep.noaa.gov/pub/data/nccf/com/gfs/prod/

为什么用 Python 而不是 Node：
    GRIB2 解码目前没有成熟的 Node 等价物（见 docs/handoff/stages/阶段三-免费气象数据源调研.md §2.6）。
    前端只读本脚本产出的 JSON，浏览器里绝不解 GRIB。

两套下载方式，互为回退（实测对比见 docs/handoff/stages/阶段四-大气剖面技术方案.md）：
    A. filter_gfs_0p25.pl 服务端裁剪 —— 一次请求 8 变量 × 9 层 ≈ 40 KB
    B. 静态文件 .idx 偏移 + HTTP Range —— 每层 0.4~1.4 MB，全网格 1440×721
    A 一旦返回 HTML / 条数不对 / 超时 → 自动回退 B。B 只切海南 23×17 窗口。

本脚本不写任何"看起来像数据"的占位值：
    缺测就是 None，不填 0；下载失败直接非零退出，不生成正式缓存。

用法：
    python tools/xsec/build_cross.py                 # 正常构建（CI 用这个）
    python tools/xsec/build_cross.py --dry-run       # 只打印将请求什么
    python tools/xsec/build_cross.py --offline DIR   # 用本地已下载的 grib 复算
"""

import argparse
import json
import math
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timedelta, timezone
from pathlib import Path

import numpy as np

try:
    import eccodes
except ImportError:  # 明确失败，不要静默降级
    sys.exit(
        "缺少 eccodes。安装：pip install eccodes\n"
        "（CI 上由 .github/workflows/xsec-cache.yml 的 setup 步骤负责）"
    )

ROOT = Path(__file__).resolve().parents[2]
OUT_DIR = ROOT / "data" / "cross"
CACHE_DIR = ROOT / ".cache" / "xsec"
SPOTS_JSON = ROOT / "src" / "data" / "forecast" / "spots.json"

UA = "18n-mspa-xsec/1.0 (static site cache builder; contact: repo issues)"
PROD = "https://nomads.ncep.noaa.gov/pub/data/nccf/com/gfs/prod"
FILTER = "https://nomads.ncep.noaa.gov/cgi-bin/filter_gfs_0p25.pl"

# 临时文件名序列（Windows 下文件句柄释放有延迟，轮换几个名字避免撞车）
_TMP_SEQ = __import__("itertools").count(0)


def bbox_params():
    """filter_gfs_0p25.pl 只认这四个名字，写错会直接 500。"""
    return [("leftlon", f"{DOMAIN['lonMin']:g}"), ("rightlon", f"{DOMAIN['lonMax']:g}"),
            ("toplat", f"{DOMAIN['latMax']:g}"), ("bottomlat", f"{DOMAIN['latMin']:g}")]

# ---------------------------------------------------------------- 取样定义

# 9 个气压层：地面附近 → 12 km 左右，足够覆盖海南所有云层
LEVELS_HPA = [1000, 925, 850, 700, 600, 500, 400, 300, 200]
# 从 GFS 取的变量（短名 → eccodes shortName）
VARS = {
    "CLWMR": "clwmr",   # 云水混合比 kg/kg
    "ICMR": "icmr",     # 云冰混合比 kg/kg
    "RH": "r",          # 相对湿度 %
    "TMP": "t",         # 温度 K
    "UGRD": "u",        # U 风 m/s
    "VGRD": "v",        # V 风 m/s
    "VVEL": "w",        # 垂直速度 Pa/s（GFS 原生单位，注意不是 m/s）
    "HGT": "gh",        # 位势高度 gpm（逐格点逐层，用于垂直坐标）
}
TCDC = "tcc"            # 云分数 %（仅用于阈值标定与「云分数」图层）
# 降水率：GFS 地面层的 PRATE（kg m^-2 s^-1），换算成 mm/h = PRATE*3600
# 与「降水概率」不同，这是**强度**；缺测时保持 None，绝不填 0（"没下雨"和"没数据"必须分开）
PRATE = "prate"
ALL_VARS_SURFACE = {"PRATE": "prate"}
# 实际下载的变量集合（TCDC 也取：既是图层，也是阈值的标定基准）
ALL_VARS = dict(VARS)
ALL_VARS["TCDC"] = TCDC

# 海南窗口（0.25° → 23 列 × 17 行）
DOMAIN = dict(latMin=17.0, latMax=21.0, lonMin=107.0, lonMax=112.5)

# 剖面：8 个代表机位 × 5 个方位 × 4 个整点
AZIMUTHS = [240, 255, 265, 280, 295]
# 采样距离：前 5 个点与旧版完全一致（0–50 km，12.5 km 间隔），
# 后面 4 个点把视野延伸到 320 km —— 夕阳照明边界常在数十到数百 km 外，
# 没有远场就看不到边界在画面里移动（阶段七-01 §5、阶段七-03 的结论）。
# 增加采样点不会造假数据：每个点都是 GFS 0.25° 的插值，320 km 内约 12 个真实格点，
# 比原来 50 km 内 2–4 个格点信息更多。体积：每机位每剖面 5→9 个采样点（约 +75%）。
SAMPLE_KM = [0.0, 12.5, 25.0, 37.5, 50.0, 100.0, 160.0, 240.0, 320.0]
LENGTH_KM = 320.0
DEFAULT_AZ = 265        # 海南日落方向初始值（§4.2），不是固定值

# 字段量化：整数尽量省字节，但语义要写清楚（index.json 里有 units）
LEVEL_FIELDS = ["hgtM", "tC", "rhPct", "clwMgKg", "iciMgKg", "uMs", "vMs", "wPaS", "cfPct",
                "belowGround", "rainMmH"]

SPOTS = [
    # id, 机位名（必须与 spots.json 完全一致）, 默认方位, 地形标签
    ("hk-xihai", "海口西海岸观海台", DEFAULT_AZ, "城市西岸"),
    ("cm-yingbin", "澄迈盈滨半岛", DEFAULT_AZ, "西岸"),
    ("lg-jiao", "临高角", DEFAULT_AZ, "西北角"),
    ("cj-qizhiwan", "昌江棋子湾", DEFAULT_AZ, "西岸"),
    ("df-yulinzhou", "东方鱼鳞洲", DEFAULT_AZ, "西南岸"),
    ("ld-longmuwan", "乐东龙沐湾", DEFAULT_AZ, "西南岸"),
    ("sy-tianya", "三亚天涯海角", DEFAULT_AZ, "南岸"),
    ("wzs-main", "五指山主峰", DEFAULT_AZ, "中部山地"),
]


# ---------------------------------------------------------------- 基础工具

def log(msg):
    print(f"[xsec] {msg}", flush=True)


def http_get(url, timeout=90, retries=3, rng=None):
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    if rng:
        req.add_header("Range", f"bytes={rng[0]}-{rng[1]}")
    last = None
    for i in range(retries):
        try:
            with urllib.request.urlopen(req, timeout=timeout) as r:
                return r.status, r.read()
        except Exception as e:  # noqa: BLE001 网络异常一律重试
            last = e
            if i < retries - 1:
                time.sleep(2.0 * (i + 1))
    raise RuntimeError(f"下载失败 {url}: {last}")


def decode_messages(buf):
    """把一段（可能多条的）GRIB2 字节流解成结构化列表。

    用临时文件 + codes_grib_new_from_file 逐条读，比手工按魔数切片稳。
    （Windows 下 eccodes 可能短暂占住文件句柄，所以 unlink 容错。）
    """
    import itertools
    import tempfile

    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    n = next(_TMP_SEQ)
    tmp = CACHE_DIR / f"_tmp{n % 16}.grib2"
    tmp.write_bytes(buf)
    out = []
    with open(tmp, "rb") as fh:
        while True:
            gid = eccodes.codes_grib_new_from_file(fh)
            if gid is None:
                break
            try:
                sn = eccodes.codes_get(gid, "shortName")
                lev = eccodes.codes_get(gid, "level")
                typ = eccodes.codes_get(gid, "typeOfLevel")
                ni = eccodes.codes_get(gid, "Ni")
                nj = eccodes.codes_get(gid, "Nj")
                vals = eccodes.codes_get_values(gid).astype("float64")
                lats = np.asarray(eccodes.codes_get_array(gid, "distinctLatitudes"), dtype="float64")
                lons = np.asarray(eccodes.codes_get_array(gid, "distinctLongitudes"), dtype="float64")
                out.append(dict(sn=sn, lev=lev, typ=typ, ni=ni, nj=nj,
                                vals=vals.reshape(nj, ni), lats=lats, lons=lons))
            finally:
                eccodes.codes_release(gid)
    try:
        tmp.unlink(missing_ok=True)
    except OSError:
        pass
    return out


def to_canonical(m):
    """统一成「纬度升序、经度升序」的二维场，后面插值不用再判断扫描方向。"""
    lats = m["lats"]
    lons = m["lons"]
    v = m["vals"]
    if lats[0] > lats[-1]:
        lats = lats[::-1].copy()
        v = v[::-1, :].copy()
    if lons[0] > lons[-1]:
        lons = lons[::-1].copy()
        v = v[:, ::-1].copy()
    return lats, lons, v


# ---------------------------------------------------------------- 时次选择

def idx_url(date, hh, fh):
    return f"{PROD}/gfs.{date}/{hh}/atmos/gfs.t{hh}z.pgrb2.0p25.f{fh:03d}.idx"


def file_url(date, hh, fh):
    return f"{PROD}/gfs.{date}/{hh}/atmos/gfs.t{hh}z.pgrb2.0p25.f{fh:03d}"


def parse_idx(text):
    rows = []
    for ln in text.strip().split("\n"):
        p = ln.split(":")
        if len(p) < 5:
            continue
        rows.append(dict(msg=int(p[0]), offset=int(p[1]), var=p[3], level=p[4]))
    return rows


def probe_status(url):
    """用 GET 探活（NOMADS 对 HEAD 支持不稳定）。.idx 只有几十 KB。"""
    try:
        _, buf = http_get(url, timeout=30, retries=1)
        return 200 if buf[:1] else 200
    except urllib.error.HTTPError as e:
        return e.code
    except Exception:  # noqa: BLE001
        return 0


def sun_pos_ms(ms, lat_deg, lon_deg):
    """与 src/lib/forecast/sun.ts 同一套 NOAA 低精度公式（必须保持一致）。"""
    rad = math.pi / 180
    n = ms / 86400000.0 + 2440587.5 - 2451545.0
    L = (280.46 + 0.9856474 * n) % 360
    g = (357.528 + 0.9856003 * n) % 360
    lam = (L + 1.915 * math.sin(g * rad) + 0.02 * math.sin(2 * g * rad)) * rad
    eps = (23.439 - 0.0000004 * n) * rad
    dec = math.asin(math.sin(eps) * math.sin(lam))
    ra = math.atan2(math.cos(eps) * math.sin(lam), math.cos(lam))
    gmst = (280.46061837 + 360.98564736629 * n) % 360
    lst = ((gmst + lon_deg) % 360) * rad
    ha = lst - ra
    lat = lat_deg * rad
    sin_el = math.sin(lat) * math.sin(dec) + math.cos(lat) * math.cos(dec) * math.cos(ha)
    sin_el = max(-1.0, min(1.0, sin_el))
    el = math.asin(sin_el)
    cos_el = math.cos(el) or 1e-6
    sin_a = -math.cos(dec) * math.sin(ha) / cos_el
    cos_a = (math.sin(dec) - sin_el * math.sin(lat)) / (cos_el * math.cos(lat))
    az = math.atan2(sin_a, cos_a) / rad
    return dict(el=el / rad, az=az % 360)


def sunset_utc_for_local_date(local_date, lat, lon):
    """求当地日落的 UTC 时刻（搜索 08:00–14:00 UTC，1 分钟精度）。"""
    base = datetime(local_date.year, local_date.month, local_date.day, 8, 0, tzinfo=timezone.utc)
    prev = None
    for k in range(0, 361):  # 6 小时，1 分钟步长
        t = base + timedelta(minutes=k)
        el = sun_pos_ms(t.timestamp() * 1000, lat, lon)["el"]
        if prev is not None and prev > -0.833 >= el:
            return t
        prev = el
    raise RuntimeError("日落搜索失败（不应发生）")


def sunrise_utc_for_local_date(local_date, lat, lon):
    """求当地日出的 UTC 时刻（搜索前一天 16:00 UTC 起 10 小时，1 分钟精度）。

    ★ 2026-11-04 加：原来整条管道只认日落。
      用户从「朝霞」卡片点进 /cross，看到的是西面 254° 的日落剖面，
      数据没错但答非所问 —— 因为早晨的时刻根本没存过。

      搜索窗口为什么从前一天 16:00 UTC 起：
        东八区日出在北京时间 06:00 左右 ≈ UTC 前一天 22:00。
        从当天 00:00 UTC 起搜会直接错过跨零点的那一段。
    """
    base = datetime(local_date.year, local_date.month, local_date.day, 0, 0, tzinfo=timezone.utc) \
        - timedelta(hours=8)
    prev = None
    for k in range(0, 601):  # 10 小时，1 分钟步长
        t = base + timedelta(minutes=k)
        el = sun_pos_ms(t.timestamp() * 1000, lat, lon)["el"]
        if prev is not None and prev < -0.833 <= el:
            return t
        prev = el
    raise RuntimeError("日出搜索失败（不应发生）")


def _hours_around(ev_utc, span_before=2, n=4):
    """以事件时刻（日出/日落）为基准取 n 个整点，返回真正的 datetime 列表。

    ★ 为什么返回 datetime 而不是「小时列表 + 日期偏移」：
      跨零点的窗口**装不进同一个 UTC 日期**。
      喀什 11 月日出约 UTC 01:29，往前 2 小时就落到前一天 UTC 23:29 ——
      这个窗口横跨两个日期，任何「同一天 + 小时平移」的写法都会算错。
      我在这里连写错三版（while 互抵 / 只平移一次 / 整窗平移），根因都是同一个：
      不该先把时刻拆成「日期 + 小时」再拼回去。
      直接用 timedelta 在绝对时刻上加减，跨日由 datetime 自己处理，不可能错。
    """
    base = ev_utc.replace(minute=0, second=0, microsecond=0) - timedelta(hours=span_before)
    return [base + timedelta(hours=i) for i in range(n)]


def pick_cycle_and_hours(now_utc, spot_lat, spot_lon, force_cycle=None, kind="sunset"):
    """选最新可用 GFS 起报，并给出要取的 4 个整点 UTC 时刻。

    kind: "sunset"（默认，保持原行为）或 "sunrise"。

    ★ 2026-11-04 加 kind 参数：原来这个函数写死日落，
      早晨的时次永远拿不到，/cross 也就永远画不出朝霞剖面。
      两种 kind 共用同一套「选起报」逻辑，只是目标事件和日期判定不同。

    日期判定：
      sunset —— 今天日落还没过就今天，否则明天（留 30 分钟余量）
      sunrise —— 明天日出（因为今天早上的日出大概率已经过了，
                 要预览「明天早上」才符合用户预期；若此刻还在今天日出前
                 6 小时内，则仍给今天早上）
    """
    local_now = now_utc + timedelta(hours=8)
    today = local_now.date()

    if kind == "sunrise":
        sr_today = sunrise_utc_for_local_date(today, spot_lat, spot_lon)
        # 今天的日出还没到（留 30 分钟余量）→ 用今天；否则用明天
        target_date = today if now_utc < sr_today - timedelta(minutes=30) else today + timedelta(days=1)
        event = sunrise_utc_for_local_date(target_date, spot_lat, spot_lon)
    else:
        ts_today = sunset_utc_for_local_date(today, spot_lat, spot_lon)
        target_date = today if now_utc < ts_today - timedelta(minutes=30) else today + timedelta(days=1)
        event = sunset_utc_for_local_date(target_date, spot_lat, spot_lon)

    # 直接用绝对时刻：跨日交给 datetime 处理。
    # （原来这里是「target_date + 小时」拼装，日出跨零点时会整整错一天 ——
    #   23:00 查日出给出后天早晨，就是这个原因。）
    valid = _hours_around(event)

    candidates = []
    if force_cycle:
        candidates = [(force_cycle[:8], force_cycle[8:10])]
    else:
        for d in range(0, 3):
            day = (now_utc - timedelta(days=d)).strftime("%Y%m%d")
            for hh in ("18", "12", "06", "00"):
                cyc = datetime(int(day[:4]), int(day[4:6]), int(day[6:]), int(hh), tzinfo=timezone.utc)
                if cyc > now_utc:
                    continue
                candidates.append((day, hh))

    for date, hh in candidates:
        cyc = datetime(int(date[:4]), int(date[4:6]), int(date[6:]), int(hh), tzinfo=timezone.utc)
        fhs = [int((v - cyc).total_seconds() // 3600) for v in valid]
        if min(fhs) < 0 or max(fhs) > 384:
            continue
        # 只要 0~120 h 内都有逐小时步长；超过则退到 3 小时步长（此处直接跳过）
        if max(fhs) > 120:
            continue
        ok = True
        for fh in fhs:
            if probe_status(idx_url(date, hh, fh)) != 200:
                ok = False
                break
        if ok:
            return (date, hh, cyc, fhs, valid)
    raise RuntimeError("找不到可用的 GFS 起报时次（NOMADS 不可用或全部未生成）")


# ---------------------------------------------------------------- 下载

def fetch_via_filter(date, hh, fh, var_level_pairs):
    """A 方案：服务端裁剪。返回 None 表示这一路失败（交给 B 方案）。"""
    params = [("file", f"gfs.t{hh}z.pgrb2.0p25.f{fh:03d}"), ("subregion", ""),
              ("dir", f"/gfs.{date}/{hh}/atmos")]
    vars_ = sorted({v for v, _ in var_level_pairs})
    levels_ = sorted({lv for _, lv in var_level_pairs})
    for v in vars_:
        params.append((f"var_{v}", "on"))
    for lv in levels_:
        params.append((f"lev_{lv}_mb", "on"))
    params.extend(bbox_params())
    url = FILTER + "?" + urllib.parse.urlencode(params)
    # ⚠ 缓存键必须包含裁剪窗口：全国批量会给不同 tile 用不同 DOMAIN，
    #   只按 cycle+小时命名会把海南窗口的文件当成别处窗口的缓存用（实测踩过）。
    win = f"{DOMAIN['latMin']:g}_{DOMAIN['latMax']:g}_{DOMAIN['lonMin']:g}_{DOMAIN['lonMax']:g}"
    cache = CACHE_DIR / f"filter_{date}_{hh}_f{fh:03d}_{win}.grib2"
    if cache.exists() and cache.stat().st_size > 1000:
        buf = cache.read_bytes()
        if buf[:4] == b"GRIB":
            log(f"  f{fh:03d} 用本地缓存 {cache.name}（{len(buf) / 1024:.1f} KB）")
            msgs = decode_messages(buf)
            pairs = {(m["sn"], int(m["lev"])) for m in msgs}
            want = {(ALL_VARS[v], lv) for v, lv in var_level_pairs}
            missing = want - pairs
            if missing:
                log(f"  缓存少 {len(missing)} 条 → 重新下载")
                cache.unlink()
            else:
                return {(m["sn"], int(m["lev"])): m for m in msgs if m["typ"] == "isobaricInhPa"}
    try:
        st, buf = http_get(url, timeout=180, retries=2)
    except Exception as e:  # noqa: BLE001
        log(f"  filter 请求异常：{e}")
        return None
    if buf[:4] != b"GRIB":
        log(f"  filter 返回非 GRIB（{len(buf)} B，http={st}）→ 回退 Range")
        return None
    msgs = decode_messages(buf)
    pairs = {(m["sn"], int(m["lev"])) for m in msgs}
    want = {(ALL_VARS[v], lv) for v, lv in var_level_pairs}
    missing = want - pairs
    if missing:
        log(f"  filter 少给 {len(missing)} 条（例：{sorted(missing)[:3]}）→ 回退 Range")
        return None
    cache.write_bytes(buf)
    return {(m["sn"], int(m["lev"])): m for m in msgs if m["typ"] == "isobaricInhPa"}


def fetch_via_range(date, hh, fh, var_level_pairs):
    """B 方案：静态文件 + .idx + Range。只切海南窗口。"""
    _, idx_text = http_get(idx_url(date, hh, fh), timeout=60)
    rows = parse_idx(idx_text.decode("utf-8", "replace"))
    out = {}
    for var, level in sorted(var_level_pairs):
        want_level = f"{level} mb"
        hit = None
        for i, r in enumerate(rows):
            if r["var"] == var and r["level"] == want_level:
                hit = (i, r)
                break
        if hit is None:
            raise RuntimeError(f"索引里没有 {var} @ {want_level}")
        i, r = hit
        end = rows[i + 1]["offset"] - 1 if i + 1 < len(rows) else r["offset"] + 5_000_000
        st, data = http_get(file_url(date, hh, fh), timeout=180, rng=(r["offset"], end))
        if st not in (200, 206) or data[:4] != b"GRIB":
            raise RuntimeError(f"Range 取 {var}@{level} 失败 http={st} magic={data[:4]}")
        msgs = decode_messages(data)
        if not msgs:
            raise RuntimeError(f"Range 取 {var}@{level} 解不出消息")
        m = msgs[0]
        out[(m["sn"], int(m["lev"]))] = m
    return out


def fetch_orog(date, hh, fh):
    """地形（orog，gpm）。filter: HGT@surface；Range: 索引里 HGT:surface。"""
    params = [("file", f"gfs.t{hh}z.pgrb2.0p25.f{fh:03d}"), ("subregion", ""),
              ("dir", f"/gfs.{date}/{hh}/atmos"), ("var_HGT", "on"), ("lev_surface", "on")]
    params.extend(bbox_params())
    win = f"{DOMAIN['latMin']:g}_{DOMAIN['latMax']:g}_{DOMAIN['lonMin']:g}_{DOMAIN['lonMax']:g}"
    cache = CACHE_DIR / f"orog_{date}_{hh}_f{fh:03d}_{win}.grib2"
    if cache.exists() and cache.stat().st_size > 200:
        buf = cache.read_bytes()
        if buf[:4] == b"GRIB":
            for m in decode_messages(buf):
                if m["typ"] in ("surface", "heightAboveGround"):
                    return m
    try:
        _, buf = http_get(FILTER + "?" + urllib.parse.urlencode(params), timeout=120, retries=2)
        if buf[:4] == b"GRIB":
            msgs = decode_messages(buf)
            for m in msgs:
                if m["typ"] in ("surface", "heightAboveGround"):
                    if "orog" in m["sn"] or m["sn"] == "gh":
                        cache.write_bytes(buf)
                        return m
    except Exception as e:  # noqa: BLE001
        log(f"  orog filter 失败：{e}")
    # 回退：Range 取 HGT:surface
    _, idx_text = http_get(idx_url(date, hh, fh), timeout=60)
    rows = parse_idx(idx_text.decode("utf-8", "replace"))
    for i, r in enumerate(rows):
        if r["var"] == "HGT" and r["level"] == "surface":
            end = rows[i + 1]["offset"] - 1 if i + 1 < len(rows) else r["offset"] + 2_000_000
            _, data = http_get(file_url(date, hh, fh), timeout=180, rng=(r["offset"], end))
            msgs = decode_messages(data)
            if msgs:
                return msgs[0]
    raise RuntimeError("拿不到地形高度 orog")


def build_time_cube(date, hh, fh):
    pairs = [(v, lv) for v in ALL_VARS for lv in LEVELS_HPA]
    log(f"  下载 f{fh:03d}（{len(pairs)} 条变量×层）…")
    got = fetch_via_filter(date, hh, fh, pairs)
    how = "filter"
    if got is None:
        got = fetch_via_range(date, hh, fh, pairs)
        how = "range"
    cube = {}
    lats = lons = None
    for var, short in ALL_VARS.items():
        for lv in LEVELS_HPA:
            m = got[(short, lv)]
            la, lo, v = to_canonical(m)
            if lats is None:
                lats, lons = la, lo
            cube[(var, lv)] = v
    # 地面降水率单独取一次：filter 的 lev_*_mb 只覆盖气压层，地面场要单独指定。
    # 失败不影响主体（降水只是辅助层），但要记下来，不能在图上假装"没下雨"。
    cube[("PRATE", 0)] = None
    try:
        got2 = fetch_via_filter_surface(date, hh, fh, "PRATE")
        if got2 is not None:
            la2, lo2, v2 = to_canonical(got2)
            if la2.shape == lats.shape and lo2.shape == lons.shape and np.allclose(la2, lats) and np.allclose(lo2, lons):
                cube[("PRATE", 0)] = v2
            else:
                log("  PRATE 网格与气压层不一致，丢弃（不插值到别的网格上）")
    except Exception as e:  # noqa: BLE001
        log(f"  PRATE 取数失败：{e}（降水层将显示为缺测）")
    return dict(cube=cube, lats=lats, lons=lons, how=how)


def fetch_via_filter_surface(date, hh, fh, var):
    """只取一个地面变量（无 lev 参数）。返回 eccodes 消息或 None。"""
    params = [("file", f"gfs.t{hh}z.pgrb2.0p25.f{fh:03d}"), ("subregion", ""),
              ("dir", f"/gfs.{date}/{hh}/atmos"), (f"var_{var}", "on")]
    params.extend(bbox_params())
    url = FILTER + "?" + urllib.parse.urlencode(params)
    st, buf = http_get(url, timeout=180, retries=2)
    if buf[:4] != b"GRIB":
        log(f"  地面 {var} 返回非 GRIB（{len(buf)} B，http={st}）")
        return None
    msgs = decode_messages(buf)
    want = ALL_VARS_SURFACE[var]
    for m in msgs:
        if m["sn"] == want:
            return m
    return None


# ---------------------------------------------------------------- 几何与插值

def bilinear(field, lats, lons, lat, lon):
    """在规则经纬网格上双线性插值；越界夹到边界并返回越界标记。"""
    if lat < lats[0] or lat > lats[-1] or lon < lons[0] or lon > lons[-1]:
        lat = min(max(lat, lats[0]), lats[-1])
        lon = min(max(lon, lons[0]), lons[-1])
        clamped = True
    else:
        clamped = False
    j = int(np.searchsorted(lats, lat) - 1)
    i = int(np.searchsorted(lons, lon) - 1)
    j = min(max(j, 0), len(lats) - 2)
    i = min(max(i, 0), len(lons) - 2)
    ty = (lat - lats[j]) / (lats[j + 1] - lats[j])
    tx = (lon - lons[i]) / (lons[i + 1] - lons[i])
    v00 = field[j, i]
    v10 = field[j, i + 1]
    v01 = field[j + 1, i]
    v11 = field[j + 1, i + 1]
    return (v00 * (1 - tx) * (1 - ty) + v10 * tx * (1 - ty) +
            v01 * (1 - tx) * ty + v11 * tx * ty), clamped


def destination(lat, lon, az_deg, dist_km):
    """大圆终点（球面，R=6371 km）。"""
    R = 6371.0088
    d = dist_km / R
    az = math.radians(az_deg)
    la1 = math.radians(lat)
    lo1 = math.radians(lon)
    la2 = math.asin(math.sin(la1) * math.cos(d) + math.cos(la1) * math.sin(d) * math.cos(az))
    lo2 = lo1 + math.atan2(math.sin(az) * math.sin(d) * math.cos(la1),
                           math.cos(d) - math.sin(la1) * math.sin(la2))
    return math.degrees(la2), (math.degrees(lo2) + 540) % 360 - 180


def great_circle_km(lat1, lon1, lat2, lon2):
    R = 6371.0088
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp = p2 - p1
    dl = math.radians(lon2 - lon1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * R * math.asin(math.sqrt(a))


def path_grid_nodes(lats, lons, origin_lat, origin_lon, az_deg):
    """路径附近 ±30 km 的真实模式格点，投影到路径上的距离（用于画「原始格点」虚线）。"""
    nodes = []
    for j, la in enumerate(lats):
        for i, lo in enumerate(lons):
            d = great_circle_km(origin_lat, origin_lon, la, lo)
            if d > LENGTH_KM + 12 or d < -12:
                continue
            brg = math.degrees(math.atan2(
                math.sin(math.radians(lo - origin_lon)) * math.cos(math.radians(la)),
                math.cos(math.radians(origin_lat)) * math.sin(math.radians(la)) -
                math.sin(math.radians(origin_lat)) * math.cos(math.radians(la)) *
                math.cos(math.radians(lo - origin_lon)))) % 360
            daz = abs(((brg - az_deg + 180) % 360) - 180)
            perp = d * math.sin(math.radians(daz))
            along = d * math.cos(math.radians(daz))
            # ±30 km 是为了把双线性插值真正用到的那两行格点都算进来
            # （0.25° ≈ 27 km，路径贴着两行之间时，另一行也只差 27 km）
            if abs(perp) <= 30 and 0 <= along <= LENGTH_KM:
                nodes.append((round(along, 2), round(la, 3), round(lo, 3)))
    nodes.sort()
    return nodes


# ---------------------------------------------------------------- 物理量

R_DRY = 287.05   # J/(kg·K)
G0 = 9.80665


def quantize_section(cube, lats, lons, origin_lat, origin_lon, az, orog):
    samples = []
    for dist in SAMPLE_KM:
        lat, lon = destination(origin_lat, origin_lon, az, dist) if dist > 0 else (origin_lat, origin_lon)
        terrain, _ = bilinear(orog, lats, lons, lat, lon)
        levels = []
        for lv in LEVELS_HPA:
            def q(var):
                return bilinear(cube[(var, lv)], lats, lons, lat, lon)[0]

            hgt = q("HGT")
            t = q("TMP")
            rh = q("RH")
            clw = q("CLWMR")
            ici = q("ICMR")
            u = q("UGRD")
            v = q("VGRD")
            w = q("VVEL")
            cf = q("TCDC")
            below = hgt <= terrain + 5.0       # 地形以下（或贴着地面）→ 必须遮罩，不能画成晴空
            levels.append([
                int(round(hgt)) if math.isfinite(hgt) else None,
                round(t - 273.15, 1) if math.isfinite(t) else None,
                int(round(rh)) if math.isfinite(rh) else None,
                int(round(clw * 1e6)) if math.isfinite(clw) else None,
                int(round(ici * 1e6)) if math.isfinite(ici) else None,
                round(u, 1) if math.isfinite(u) else None,
                round(v, 1) if math.isfinite(v) else None,
                round(w, 2) if math.isfinite(w) else None,
                int(round(cf)) if math.isfinite(cf) else None,
            ])
            if below:
                # 地下层保留原始值但打标记：前端画遮罩，不画云
                levels[-1].append(1)
            else:
                levels[-1].append(0)
        # 降水率（mm/h）：与层无关，但为了不让前端多一套数据形状，挂在每一层上重复一次。
        # PRATE 缺测 → None（绝不写 0），前端显示"缺测"而不是"没下雨"。
        prate = None
        if cube.get(("PRATE", 0)) is not None:
            prate_v = bilinear(cube[("PRATE", 0)], lats, lons, lat, lon)[0]
            if math.isfinite(prate_v):
                prate = round(float(prate_v) * 3600.0, 2)
        for row in levels:
            row.append(prate)
        samples.append(dict(d=dist, lat=round(lat, 4), lon=round(lon, 4),
                            terrainM=int(round(terrain)), levels=levels))
    return dict(az=az, samples=samples)


def lwp_iwp(cube, lats, lons, origin_lat, origin_lon):
    """液水路径/冰水路径（g/m²），用于物理量级自检（不是产品输出）。"""
    out = dict(lwp=0.0, iwp=0.0)
    prev = None
    for lv in sorted(LEVELS_HPA, reverse=True):
        hgt = bilinear(cube[("HGT", lv)], lats, lons, origin_lat, origin_lon)[0]
        t = bilinear(cube[("TMP", lv)], lats, lons, origin_lat, origin_lon)[0]
        clw = bilinear(cube[("CLWMR", lv)], lats, lons, origin_lat, origin_lon)[0]
        ici = bilinear(cube[("ICMR", lv)], lats, lons, origin_lat, origin_lon)[0]
        rho = (lv * 100.0) / (R_DRY * t)
        if prev is not None:
            dz = hgt - prev[1]
            if dz > 0:
                out["lwp"] += rho * clw * dz
                out["iwp"] += rho * ici * dz
        prev = (lv, hgt)
    return out["lwp"] * 1000.0, out["iwp"] * 1000.0


# ---------------------------------------------------------------- 标定

def calibrate_cloud_threshold(cubes):
    """用 GFS 原生云分数 TCDC 标定「总凝结水（液+冰）」的可视化阈值。

    为什么不能只拿 CLWMR 对有云点：海南 11 月傍晚的云主要是 200–300 hPa 卷云，
    那里 CLWMR 恒为 0、ICMR 才是云体；只标定 CLWMR 会得出「怎么调阈值都命中 0」的假结论。
    所以标定对象是 qt = CLWMR + ICMR，并与 TCDC≥50% 比较。

    这只是让「画出来的云」与模式自己的云方案自洽，不代表真实云。
    """
    qt_all, cf_all, tc_all = [], [], []
    for c in cubes:
        cube = c["cube"]
        for lv in LEVELS_HPA:
            if ("TCDC", lv) not in cube:
                continue
            cf_all.append(cube[("TCDC", lv)].ravel())
            qt_all.append((cube[("CLWMR", lv)] + cube[("ICMR", lv)]).ravel())
            tc_all.append(cube[("TMP", lv)].ravel() - 273.15)
    qt = np.concatenate(qt_all)
    cf = np.concatenate(cf_all)
    tc = np.concatenate(tc_all)

    table = []
    for th in (1e-6, 2e-6, 5e-6, 1e-5, 2e-5, 5e-5, 1e-4, 2e-4):
        cloud_cf = cf >= 50.0
        cloud_q = qt >= th
        hit = int((cloud_cf & cloud_q).sum())
        miss = int((cloud_cf & ~cloud_q).sum())
        fa = int((~cloud_cf & cloud_q).sum())
        tn = int((~cloud_cf & ~cloud_q).sum())
        table.append(dict(thKgKg=th, hit=hit, missed=miss, falseAlarm=fa, correctNegative=tn,
                          pod=round(hit / (hit + miss), 4) if hit + miss else None,
                          far=round(fa / (fa + tn), 5) if fa + tn else None,
                          agreement=round((hit + tn) / (hit + miss + fa + tn), 4)))

    phases = {}
    for lo, hi, name in ((-200, -40, "cirrus"), (-40, -10, "ice"), (-10, 0, "mixed"), (0, 100, "warm")):
        m = (tc >= lo) & (tc < hi)
        if not m.any():
            continue
        cc = cf[m] >= 50
        phases[name] = dict(samples=int(m.sum()), modelCloudPts=int(cc.sum()),
                            qtPositivePts=int((qt[m] > 0).sum()),
                            qtGe1e5Pts=int((qt[m] >= 1e-5).sum()),
                            qtMeanAtCloud=float(qt[m][cc].mean()) if cc.any() else None,
                            tRangeC=[lo, hi])
    return dict(
        reference="GFS TCDC (cloud fraction, %) ≥ 50% 视为模式认为有云",
        variable="qt = CLWMR + ICMR (kg/kg)",
        table=table,
        phases=phases,
        # 画图用的三条分界（不是"科学常量"，是本次实测标定结果）：
        # 1e-6 → 有凝结水的下限；1e-5 → 可辨识云（传统 0.01 g/kg 阈值，本项目实测 POD 39% / FAR 0.3%）；
        # 1e-4 → 厚云
        displayBandsKgKg=[1e-6, 1e-5, 1e-4],
        samples=int(qt.size),
        modelCloudPoints=int((cf >= 50).sum()),
        note="格点总数含 TCDC≤10% 的晴空点；海南该时次云主要在高空冰云",
    )


# ---------------------------------------------------------------- 主流程

def load_spots():
    data = json.loads(SPOTS_JSON.read_text(encoding="utf-8"))
    by_name = {row["n"]: row for row in data if row.get("prov") == "hn"}
    out = []
    for sid, name, az, tag in SPOTS:
        row = by_name.get(name)
        if row is None:
            log(f"!! spots.json 里找不到机位「{name}」，跳过")
            continue
        out.append(dict(id=sid, name=name, lat=row["lat"], lon=row["lon"],
                        area=row.get("area", ""), face=row.get("face", ""),
                        defaultAzimuth=az, tag=tag))
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--offline", metavar="DIR", help="使用本地已下载的 grib 目录复算（不联网）")
    ap.add_argument("--cycle", metavar="YYYYMMDDHH", help="强制起报时次")
    ap.add_argument("--out", default=str(OUT_DIR))
    args = ap.parse_args()

    out_dir = Path(args.out)
    out_dir.mkdir(parents=True, exist_ok=True)
    CACHE_DIR.mkdir(parents=True, exist_ok=True)

    spots = load_spots()
    if not spots:
        sys.exit("没有机位可算")

    now = datetime.now(timezone.utc)
    ref = spots[0]
    date, hh, cycle, fhs, valid = pick_cycle_and_hours(now, ref["lat"], ref["lon"], args.cycle)
    log(f"起报 {date} {hh}Z，目标时刻 {[v.strftime('%H:%M') + 'Z' for v in valid]}（lead {fhs} h）")

    if args.dry_run:
        for fh in fhs:
            log(f"  将下载 f{fh:03d}：{len(ALL_VARS) * len(LEVELS_HPA)} 条（{len(ALL_VARS)} 变量 × {len(LEVELS_HPA)} 层）+ orog")
        return 0

    # ---- 下载 + 解码 ----
    cubes = []
    for fh in fhs:
        t0 = time.time()
        try:
            c = build_time_cube(date, hh, fh)
        except Exception as e:  # noqa: BLE001
            log(f"!! f{fh:03d} 构建失败：{e}")
            raise
        # 校验：所有场必须同网格
        n = len(c["lats"]) * len(c["lons"])
        bad = [k for k, v in c["cube"].items() if v.size != n]
        if bad:
            raise RuntimeError(f"f{fh:03d} 网格不一致：{bad[:3]}")
        log(f"  f{fh:03d} ok（{c['how']}，{len(c['cube'])} 场，网格 {len(c['lons'])}×{len(c['lats'])}，{time.time() - t0:.1f}s）")
        cubes.append(c)

    orog_msg = fetch_orog(date, hh, fhs[0])
    orog_lat, orog_lon, orog = to_canonical(orog_msg)
    if orog.shape != cubes[0]["cube"][("HGT", LEVELS_HPA[0])].shape:
        raise RuntimeError("地形网格与气压层网格不一致，拒绝继续")
    if not (np.allclose(orog_lat, cubes[0]["lats"]) and np.allclose(orog_lon, cubes[0]["lons"])):
        raise RuntimeError("地形经纬度轴与气压层不一致，拒绝继续")
    log(f"地形 orog：{orog.shape[1]}×{orog.shape[0]}，最高 {float(np.nanmax(orog)):.0f} m")

    # 网格分辨率（km，按海南纬度算）
    dlat = abs(cubes[0]["lats"][1] - cubes[0]["lats"][0])
    grid_km = dlat * 111.32
    log(f"网格 {len(cubes[0]['lons'])}×{len(cubes[0]['lats'])}，水平约 {grid_km:.1f} km")

    # ---- 逐机位生成剖面 ----
    files = []

    phys_rows = []
    for spot in spots:
        sections = []
        for t_idx, cube in enumerate(cubes):
            lats, lons = cube["lats"], cube["lons"]
            for az in AZIMUTHS:
                sec = quantize_section(cube["cube"], lats, lons, spot["lat"], spot["lon"], az, orog)
                sec["t"] = t_idx
                sec["leadHours"] = fhs[t_idx]
                sec["gridNodes"] = path_grid_nodes(lats, lons, spot["lat"], spot["lon"], az)
                sections.append(sec)
            lwp, iwp = lwp_iwp(cube["cube"], lats, lons, spot["lat"], spot["lon"])
            phys_rows.append(dict(spot=spot["id"], t=t_idx, lwpGm2=round(lwp, 1), iwpGm2=round(iwp, 1)))
        terrain_at_origin = bilinear(orog, orog_lat, orog_lon, spot["lat"], spot["lon"])[0]
        payload = dict(
            version=1,
            source="gfs",
            model="GFS 0.25° (pgrb2.0p25, NOAA/NCEP)",
            cycle=cycle.strftime("%Y-%m-%dT%H:%M:%SZ"),
            generatedAt=now.strftime("%Y-%m-%dT%H:%M:%SZ"),
            domain=DOMAIN,
            gridKm=round(grid_km, 1),
            lengthKm=LENGTH_KM,
            sampleIntervalKm=SAMPLE_KM[1],
            levelsHpa=LEVELS_HPA,
            levelFields=LEVEL_FIELDS,
            azimuths=AZIMUTHS,
            times=[dict(t=i, utc=v.strftime("%Y-%m-%dT%H:%M:%SZ"), leadHours=fhs[i])
                   for i, v in enumerate(valid)],
            spot=dict(spot, terrainM=int(round(terrain_at_origin))),
            sections=sections,
        )
        path = out_dir / f"hn-{spot['id']}.json"
        path.write_text(json.dumps(payload, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
        files.append(dict(id=spot["id"], name=spot["name"], lat=spot["lat"], lon=spot["lon"],
                          terrainM=int(round(terrain_at_origin)), defaultAzimuth=spot["defaultAzimuth"],
                          tag=spot["tag"], area=spot["area"], face=spot["face"],
                          file=path.name, bytes=path.stat().st_size))
        log(f"  {spot['name']}: {path.name} {path.stat().st_size / 1024:.1f} KB")

    # ---- TCDC 校准（4 个时次全部格点池化，输出到 quality.json）----
    calib = calibrate_cloud_threshold(cubes)
    log(f"阈值标定样本 {calib['samples']} 个，其中模式有云点 {calib['modelCloudPoints']} 个")

    index = dict(
        version=1,
        source="gfs",
        model="GFS 0.25° (pgrb2.0p25, NOAA/NCEP)",
        license="US Government work — public domain",
        cycle=cycle.strftime("%Y-%m-%dT%H:%M:%SZ"),
        generatedAt=now.strftime("%Y-%m-%dT%H:%M:%SZ"),
        gridKm=round(grid_km, 1),
        gridApproxKm=27,
        lengthKm=LENGTH_KM,
        sampleIntervalKm=SAMPLE_KM[1],
        levelsHpa=LEVELS_HPA,
        levelFields=LEVEL_FIELDS,
        levelFieldUnits=dict(hgtM="m (MSL)", tC="°C", rhPct="%", clwMgKg="mg/kg (1e-6 kg/kg)",
                             iciMgKg="mg/kg", uMs="m/s", vMs="m/s", wPaS="Pa/s",
                             cfPct="% (GFS 原生云分数)", belowGround="0/1 标记（1 = 在地形以下，已遮罩）"),
        azimuths=AZIMUTHS,
        times=[dict(t=i, utc=v.strftime("%Y-%m-%dT%H:%M:%SZ"), leadHours=fhs[i])
               for i, v in enumerate(valid)],
        spots=files,
        thresholds=dict(
            reference=calib["reference"],
            variable=calib["variable"],
            displayBandsKgKg=calib["displayBandsKgKg"],
        ),
        notes=[
            "云水/云冰是 GFS 模式预报变量，不是观测事实；格点之间为双线性插值，插值不提高分辨率。",
            "水平网格约 27 km，50 km 路径内只有 2~4 个真实格点；图上虚线标出真实格点位置。",
            "地形高度使用 GFS 模式地形（orog），不是真实 DEM；地形以下的层已被标记并遮罩。",
            "垂直速度为 GFS 原生 Pa/s，未换算成 m/s。",
        ],
    )
    (out_dir / "index.json").write_text(json.dumps(index, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")

    quality = dict(
        generatedAt=index["generatedAt"], cycle=index["cycle"],
        downloads=[dict(fh=fh, how=c["how"], fields=len(c["cube"])) for fh, c in zip(fhs, cubes)],
        physics=phys_rows,
        thresholds=calib,
    )
    (out_dir / "quality.json").write_text(json.dumps(quality, ensure_ascii=False, indent=1), encoding="utf-8")
    log(f"完成：{len(files)} 个机位文件 + index.json + quality.json")
    total_kb = sum(f["bytes"] for f in files) / 1024
    log(f"总体积 {total_kb:.1f} KB")
    return 0


if __name__ == "__main__":
    sys.exit(main())

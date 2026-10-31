# -*- coding: utf-8 -*-
"""
NOMADS filter_gfs_0p25.pl（服务端子区域裁剪）实测探针
对比对象：静态文件 + HTTP Range 全网格下载（probe_gfs.py 已验证）
目的：确认 1) 支持哪些变量/层 2) 输出是否与全网格一致 3) 单次请求能装多少 4) 失败长什么样
"""
import json
import sys
import urllib.parse
import urllib.request

import eccodes
import numpy as np

CYCLE_DIR = "/gfs.20261031/12/atmos"
FILE = "gfs.t12z.pgrb2.0p25.f003"
HAN = dict(leftlon=107.0, rightlon=112.5, toplat=21.0, bottomlat=17.0)
LEVELS = [1000, 925, 850, 700, 600, 500, 400, 300, 250, 200, 150, 100]
VARS = ["CLWMR", "ICMR", "RH", "TMP", "HGT", "UGRD", "VGRD", "VVEL"]


def build_url(vars_, levels_):
    q = [("file", FILE), ("subregion", ""), ("dir", CYCLE_DIR)]
    for v in vars_:
        q.append((f"var_{v}", "on"))
    for lv in levels_:
        q.append((f"lev_{lv}_mb", "on"))
    for k, v in HAN.items():
        q.append((k, f"{v:g}"))
    return "https://nomads.ncep.noaa.gov/cgi-bin/filter_gfs_0p25.pl?" + urllib.parse.urlencode(q)


def fetch(url):
    req = urllib.request.Request(url, headers={"User-Agent": "18n-mspa-probe/0.1"})
    with urllib.request.urlopen(req, timeout=300) as r:
        return r.status, r.geturl(), r.read()


def count_msgs(buf):
    return eccodes.codes_count_in_file if False else len(_split_messages(buf))


def _split_messages(buf):
    """按 GRIB 魔数粗切，用于统计消息条数（eccodes 也提供 count，但这里顺便验证结构）"""
    out = []
    i = 0
    while True:
        j = buf.find(b"GRIB", i)
        if j < 0:
            break
        out.append(j)
        i = j + 4
    return out


def main():
    print("=" * 78)
    # 1) 单个变量单层
    for n in (1, 6, 96):
        vs = VARS[: (1 if n == 1 else len(VARS))] if n >= 1 else VARS
        ls = LEVELS[: (1 if n == 1 else len(LEVELS))]
        if n == 6:
            vs, ls = VARS[:2], LEVELS[:3]
        url = build_url(vs, ls)
        st, final, buf = fetch(url)
        magic = buf[:4]
        msgs = len(_split_messages(buf))
        print(f"[{len(vs)}var x {len(ls)}lev] http={st} bytes={len(buf)} magic={magic} msgs={msgs} expected={len(vs)*len(ls)}")
        if magic != b"GRIB":
            print("      !!! 不是 GRIB，服务器返回了 HTML")
            print("      " + buf[:300].decode("utf-8", "replace").replace("\n", " "))
        else:
            # 解码第一个消息，看网格与数值
            gid = eccodes.codes_new_from_message(buf)
            try:
                meta = {k: eccodes.codes_get(gid, k) for k in
                        ("shortName", "units", "Ni", "Nj", "latitudeOfFirstGridPointInDegrees",
                         "longitudeOfFirstGridPointInDegrees")}
                vals = eccodes.codes_get_values(gid)
            finally:
                eccodes.codes_release(gid)
            print(f"      第一消息: {meta['shortName']} [{meta['units']}] grid={meta['Ni']}x{meta['Nj']} "
                  f"lon1={meta['lon1'] if 'lon1' in meta else meta['longitudeOfFirstGridPointInDegrees']} "
                  f"lat1={meta['latitudeOfFirstGridPointInDegrees']} n={vals.size} "
                  f"min={np.nanmin(vals):.6g} max={np.nanmax(vals):.6g}")

    # 2) 全量（8 变量 × 12 层）
    url = build_url(VARS, LEVELS)
    st, final, buf = fetch(url)
    msgs = len(_split_messages(buf))
    print(f"\n[全量 8var x 12lev] http={st} bytes={len(buf)} msgs={msgs} expected={len(VARS)*len(LEVELS)}")
    print(f"最终 URL 长度: {len(final)}")
    got = set()
    vals_by = {}
    i = 0
    while True:
        gid = eccodes.codes_new_from_message(buf[i:])
        if gid is None:
            break
        sn = eccodes.codes_get(gid, "shortName")
        lv = eccodes.codes_get(gid, "level")
        v = eccodes.codes_get_values(gid).copy()
        got.add((sn, lv))
        vals_by[(sn, lv)] = v
        off = eccodes.codes_get_message_size(gid)
        eccodes.codes_release(gid)
        i += off
    print(f"实际解出 {len(got)} 个 (var,level) 组合")
    # 与 Range 全网格那份比对 CLWMR@850 的海南窗口
    lat1 = eccodes.codes_get if False else None
    print("CLWMR@850 子区域网格内 min/max:",
          float(np.nanmin(vals_by[("clwmr", 850)])), float(np.nanmax(vals_by[("clwmr", 850)])))
    print("VVEL@500 单位期望 Pa/s，min/max:",
          float(np.nanmin(vals_by[("w", 500)])), float(np.nanmax(vals_by[("w", 500)])))
    return 0


if __name__ == "__main__":
    sys.exit(main())

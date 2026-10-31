# -*- coding: utf-8 -*-
"""
GFS GRIB2 实测探针（阶段四 4.1 可行性验证）
目的：证明「.idx 索引 + HTTP Range 取单层 → eccodes 解码 → 取海南格点」这条链路真的能跑通，
      并记录每个变量的真实单位、量级、格点结构。
不写任何生产数据，只打印。
用法：python probe_gfs.py [YYYYMMDD] [HH]
"""
import json
import sys
import urllib.request

import eccodes
import numpy as np

BASE = "https://nomads.ncep.noaa.gov/pub/data/nccf/com/gfs/prod"
DATE = sys.argv[1] if len(sys.argv) > 1 else "20261031"
HH = sys.argv[2] if len(sys.argv) > 2 else "12"
FH = sys.argv[3] if len(sys.argv) > 3 else "f003"

HAN_LAT = (17.0, 21.0)
HAN_LON = (107.5, 112.0)


def http_get(url, byte_range=None, timeout=180):
    req = urllib.request.Request(url, headers={"User-Agent": "18n-mspa-probe/0.1"})
    if byte_range:
        req.add_header("Range", f"bytes={byte_range[0]}-{byte_range[1]}")
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.status, r.read()


def load_index():
    url = f"{BASE}/gfs.{DATE}/{HH}/atmos/gfs.t{HH}z.pgrb2.0p25.{FH}.idx"
    st, body = http_get(url)
    assert st == 200, st
    lines = body.decode("utf-8").strip().split("\n")
    rows = []
    for ln in lines:
        p = ln.split(":")
        if len(p) < 5:
            continue
        rows.append({"msg": int(p[0]), "offset": int(p[1]), "var": p[3], "level": p[4], "tail": p[5] if len(p) > 5 else ""})
    return url, rows


def pick(rows, var, level):
    """返回 (start, end) 字节区间；end = 下一条消息起点 - 1。"""
    for i, r in enumerate(rows):
        if r["var"] == var and r["level"] == level:
            start = r["offset"]
            end = rows[i + 1]["offset"] - 1 if i + 1 < len(rows) else None
            return start, end, i
    return None


def decode(data):
    gid = eccodes.codes_new_from_message(data)
    try:
        meta = {
            "shortName": eccodes.codes_get(gid, "shortName"),
            "name": eccodes.codes_get(gid, "name"),
            "units": eccodes.codes_get(gid, "units"),
            "Ni": eccodes.codes_get(gid, "Ni"),
            "Nj": eccodes.codes_get(gid, "Nj"),
            "gridType": eccodes.codes_get(gid, "gridType"),
            "lat1": eccodes.codes_get(gid, "latitudeOfFirstGridPointInDegrees"),
            "lon1": eccodes.codes_get(gid, "longitudeOfFirstGridPointInDegrees"),
            "lat2": eccodes.codes_get(gid, "latitudeOfLastGridPointInDegrees"),
            "lon2": eccodes.codes_get(gid, "longitudeOfLastGridPointInDegrees"),
            "iStep": eccodes.codes_get(gid, "iDirectionIncrementInDegrees"),
            "jStep": eccodes.codes_get(gid, "jDirectionIncrementInDegrees"),
            "scanMode": eccodes.codes_get(gid, "scanningMode"),
            "dataDate": eccodes.codes_get(gid, "dataDate"),
            "dataTime": eccodes.codes_get(gid, "dataTime"),
            "step": eccodes.codes_get(gid, "step"),
            "level": eccodes.codes_get(gid, "level"),
            "typeOfLevel": eccodes.codes_get(gid, "typeOfLevel"),
        }
        vals = eccodes.codes_get_values(gid)
    finally:
        eccodes.codes_release(gid)
    meta["nValues"] = int(vals.size)
    return meta, vals


def hainan_slice(meta):
    """按 0.25° 全球格（i 快，j 慢）切海南窗口。"""
    ni, nj = meta["Ni"], meta["Nj"]
    lat1, lon1 = meta["lat1"], meta["lon1"]
    dj, di = meta["jStep"], meta["iStep"]
    j0 = int(round((lat1 - HAN_LAT[1]) / dj))
    j1 = int(round((lat1 - HAN_LAT[0]) / dj))
    i0 = int(round((HAN_LON[0] - lon1) / di))
    i1 = int(round((HAN_LON[1] - lon1) / di))
    return i0, i1, j0, j1, ni, nj


def main():
    print("=" * 78)
    print(f"GFS 探针  cycle=gfs.{DATE}/{HH}  fh={FH}")
    idx_url, rows = load_index()
    print(f"索引: {len(rows)} 条消息")
    counts = {}
    for r in rows:
        counts[r["var"]] = counts.get(r["var"], 0) + 1
    want = ["CLWMR", "ICMR", "RWMR", "SNMR", "GRLE", "VVEL", "HGT", "TMP", "RH", "SPFH", "UGRD", "VGRD"]
    print("命中变量条数: " + json.dumps({k: counts.get(k, 0) for k in want}, ensure_ascii=False))

    tests = [
        ("CLWMR", "850 mb"),
        ("ICMR", "300 mb"),
        ("RH", "850 mb"),
        ("TMP", "850 mb"),
        ("HGT", "850 mb"),
        ("VVEL", "500 mb"),
        ("UGRD", "850 mb"),
        ("SPFH", "850 mb"),
    ]
    url = f"{BASE}/gfs.{DATE}/{HH}/atmos/gfs.t{HH}z.pgrb2.0p25.{FH}"
    report = []
    for var, level in tests:
        got = pick(rows, var, level)
        if not got:
            print(f"!! 索引里没有 {var} @ {level}")
            continue
        start, end, msg_idx = got
        st, data = http_get(url, (start, end))
        meta, vals = decode(data)
        i0, i1, j0, j1, ni, nj = hainan_slice(meta)
        block = vals.reshape(nj, ni)[j0 : j1 + 1, i0 : i1 + 1]
        finite = block[np.isfinite(block)]
        report.append(
            {
                "var": var,
                "level": level,
                "http": st,
                "msgIdx": msg_idx,
                "bytes": end - start + 1,
                "magic": data[:4].decode("ascii", "replace"),
                "declaredLen": (data[8] << 56) | (data[9] << 48) | (data[10] << 40) | (data[11] << 32)
                | (data[12] << 24) | (data[13] << 16) | (data[14] << 8) | data[15],
                "units": meta["units"],
                "name": meta["name"],
                "grid": f"{meta['Ni']}x{meta['Nj']} {meta['gridType']} scan={meta['scanMode']} "
                        f"lat1={meta['lat1']} lon1={meta['lon1']} d={meta['iStep']}",
                "valid": f"{meta['dataDate']}+{meta['dataTime']} step {meta['step']} {meta['typeOfLevel']}={meta['level']}",
                "hainanShape": list(block.shape),
                "hainanMin": float(finite.min()) if finite.size else None,
                "hainanMax": float(finite.max()) if finite.size else None,
                "hainanMean": float(finite.mean()) if finite.size else None,
                "nanCount": int(block.size - finite.size),
                "sampleRows": [
                    [round(float(v), 8) if np.isfinite(v) else None for v in row]
                    for row in block[:3]
                ],
            }
        )
    print()
    for r in report:
        print(f"--- {r['var']} @ {r['level']}  [{r['units']}] {r['name']}")
        print(f"    HTTP {r['http']}  Range {r['bytes']} B  magic={r['magic']}  声明长={r['declaredLen']}")
        print(f"    格点: {r['grid']}")
        print(f"    时刻: {r['valid']}")
        print(f"    海南窗口 {r['hainanShape']}: min={r['hainanMin']:.6g} max={r['hainanMax']:.6g} mean={r['hainanMean']:.6g} NaN={r['nanCount']}")
    return report


if __name__ == "__main__":
    main()

# -*- coding: utf-8 -*-
"""filter_gfs_0p25.pl 能力探测：地形高度、低中高云量、逐小时步长是否可用"""
import urllib.parse
import urllib.request

import eccodes

BASE = "https://nomads.ncep.noaa.gov/cgi-bin/filter_gfs_0p25.pl"
CYCLE_DIR = "/gfs.20261031/12/atmos"
FILE = "gfs.t12z.pgrb2.0p25.f003"
BOX = dict(leftlon=107.0, rightlon=112.5, toplat=21.0, bottomlat=17.0)


def get(params, timeout=240):
    q = [("file", FILE), ("subregion", ""), ("dir", CYCLE_DIR)] + params
    for k, v in BOX.items():
        q.append((k, f"{v:g}"))
    url = BASE + "?" + urllib.parse.urlencode(q)
    req = urllib.request.Request(url, headers={"User-Agent": "18n-mspa-probe/0.1"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.status, r.read(), url


def dump(tag, params):
    try:
        st, buf, url = get(params)
    except Exception as e:
        print(f"{tag:28s} EXC {e}")
        return
    if buf[:4] != b"GRIB":
        print(f"{tag:28s} http={st} NOT-GRIB bytes={len(buf)} :: {buf[:160].decode('utf-8','replace').replace(chr(10),' ')}")
        return
    n = 0
    out = []
    i = 0
    while i < len(buf) - 4:
        j = buf.find(b"GRIB", i)
        if j < 0:
            break
        try:
            gid = eccodes.codes_new_from_message(buf[j:])
        except Exception as e:
            out.append(f"<decode fail at {j}: {e}>")
            break
        sn = eccodes.codes_get(gid, "shortName")
        name = eccodes.codes_get(gid, "name")
        lvl = eccodes.codes_get(gid, "level")
        tl = eccodes.codes_get(gid, "typeOfLevel")
        size = eccodes.codes_get_message_size(gid)
        vals = eccodes.codes_get_values(gid)
        out.append(f"{sn}({name}) {tl}={lvl} n={vals.size} min={vals.min():.6g} max={vals.max():.6g}")
        eccodes.codes_release(gid)
        n += 1
        i = j + size
    print(f"{tag:28s} http={st} bytes={len(buf)} msgs={n}")
    for line in out[:8]:
        print("     " + line)


print("== 地形/地表 ==")
dump("HGT@surface", [("var_HGT", "on"), ("lev_surface", "on")])
dump("OROG@surface", [("var_OROG", "on"), ("lev_surface", "on")])
dump("TMP@2m", [("var_TMP", "on"), ("lev_2_m_above_ground", "on")])
print("== 低中高云量 ==")
dump("TCDC low", [("var_TCDC", "on"), ("lev_low_cloud_layer", "on")])
dump("TCDC mid", [("var_TCDC", "on"), ("lev_middle_cloud_layer", "on")])
dump("TCDC high", [("var_TCDC", "on"), ("lev_high_cloud_layer", "on")])
dump("TCDC entire", [("var_TCDC", "on"), ("lev_entire_atmosphere", "on")])
print("== 降水粒子（区分云/降水）==")
dump("RWMR@850", [("var_RWMR", "on"), ("lev_850_mb", "on")])
dump("SNMR@300", [("var_SNMR", "on"), ("lev_300_mb", "on")])
dump("GRLE@850", [("var_GRLE", "on"), ("lev_850_mb", "on")])

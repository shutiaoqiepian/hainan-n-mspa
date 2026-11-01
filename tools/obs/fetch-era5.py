#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
ERA5 原始压力层抓取（**未验证，等 CDS 账号**）。

为什么单独放一个脚本、还标注"未验证"：
    ERA5 的 CLWC/CIWC/TCDC/RH 只在 Copernicus CDS 上，下载必须注册账号、
    接受数据集许可、配 API key（`.cdsapirc` 或环境变量）。
    2026-11-01 实测：`https://cds.climate.copernicus.eu/api/retrieve/v1/jobs`
    匿名访问返回 401。所以**本脚本从未在生产环境跑通过**，
    按项目硬约束（"没有验证过的数据接口不得写入正式生产代码"），
    它只是"账号到位即可跑"的准备件，不会被 CI 调用、也不会生成被页面读取的数据。

拿到账号后怎么用：
    # 1) 装客户端
    pip install cdsapi xarray netcdf4
    # 2) 配置 key（二选一）
    #    · 写 ~/.cdsapirc
    #    · 或设环境变量 CDSAPI_URL / CDSAPI_KEY
    # 3) 先看请求长什么样（不联网）
    python tools/obs/fetch-era5.py --dry-run
    # 4) 真跑（默认拉海南窗口 3 天，体积几十 MB）
    python tools/obs/fetch-era5.py --days 3
    # 5) 抓完用 tools/obs/compare-era5.py（待写）与 data/obs/xsec-snapshot/ 对照

产出（**只写 data/obs/era5/，不写任何页面依赖的路径**）：
    data/obs/era5/era5-pl-<cycle>.nc

设计约束：
    · 只拉海南窗口（18–21°N、108–112°E），9 个气压层，日落前后 4 个整点；
    · 变量名严格按 CDS ERA5 pressure-levels 官方字段名；
    · 失败就非零退出，不生成半成品。
"""

import argparse
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
OUT_DIR = ROOT / "data" / "obs" / "era5"

# ERA5 pressure-levels 官方变量名（CDS API 文档字段，不是 shortName）
VARIABLES = [
    "specific_cloud_liquid_water_content",   # 云水 kg/kg
    "specific_cloud_ice_water_content",      # 云冰 kg/kg
    "fraction_of_cloud_cover",               # 云量 0–1
    "relative_humidity",                     # RH %
    "temperature",                           # K
    "geopotential",                          # m²/s²
]
LEVELS = ["1000", "925", "850", "700", "600", "500", "400", "300", "200"]
# 海南窗口（与 tools/xsec/build_cross.py 的 DOMAIN 对齐，外边留 0.5°）
AREA = [21.5, 107.5, 17.0, 113.0]   # [北, 西, 南, 东]


def build_request(date, hours):
    return {
        "product_type": ["reanalysis"],
        "variable": VARIABLES,
        "year": [date[:4]],
        "month": [date[5:7]],
        "day": [date[8:10]],
        "time": [f"{h:02d}:00" for h in hours],
        "pressure_level": LEVELS,
        "area": AREA,
        "data_format": "netcdf",
        "download_format": "unarchived",
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--date", help="YYYY-MM-DD（默认昨天，UTC）")
    ap.add_argument("--days", type=int, default=3, help="连续天数（默认 3）")
    ap.add_argument("--hours", default="8,9,10,11", help="UTC 整点，默认日落前后 4 个")
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    from datetime import datetime, timedelta, timezone
    base = args.date or (datetime.now(timezone.utc) - timedelta(days=1)).strftime("%Y-%m-%d")
    hours = [int(h) for h in args.hours.split(",") if h.strip()]

    requests = []
    for k in range(args.days):
        d = (datetime.strptime(base, "%Y-%m-%d") + timedelta(days=k)).strftime("%Y-%m-%d")
        requests.append((d, build_request(d, hours)))

    if args.dry_run:
        import json
        for d, req in requests:
            print(f"[dry-run] {d} → {len(req['variable'])} 变量 × {len(req['pressure_level'])} 层 × "
                  f"{len(req['time'])} 时次，area={req['area']}")
        print(json.dumps(requests[0][1], indent=1, ensure_ascii=False))
        return 0

    try:
        import cdsapi
    except ImportError:
        sys.exit("缺少 cdsapi。安装：pip install cdsapi（并配置 ~/.cdsapirc 或 CDSAPI_KEY）")
    if not (os.path.exists(os.path.expanduser("~/.cdsapirc")) or os.environ.get("CDSAPI_KEY")):
        sys.exit("没有找到 CDS 凭据：写 ~/.cdsapirc 或设 CDSAPI_KEY / CDSAPI_URL 环境变量")

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    client = cdsapi.Client()
    for d, req in requests:
        out = OUT_DIR / f"era5-pl-{d.replace('-', '')}.nc"
        if out.exists():
            print(f"已存在 {out}，跳过")
            continue
        print(f"下载 {d} → {out}")
        client.retrieve("reanalysis-era5-pressure-levels", req, str(out))
        print(f"  ok {out.stat().st_size / 1024 / 1024:.1f} MB")
    return 0


if __name__ == "__main__":
    sys.exit(main())

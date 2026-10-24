#!/usr/bin/env node
/* ============================================================
   预生成预报缓存（按省份分文件）
   ------------------------------------------------------------
   每 4 小时由 GitHub Actions 跑一次（一天 6 次）：
   把 Open-Meteo 的结果存成 data/forecast.json（海南）与
   data/forecast-gd.json（广东）。访客只读自己那个省的文件，
   不现场调接口，加载快、也不消耗接口额度。

   机位表在 src/data/forecast/spots.json（页面与脚本共用同一份，
   不再各存一份靠名字对账）。

   用法：
     node tools/build-cache.mjs            # 生成全部省份
     node tools/build-cache.mjs gd         # 只生成广东（调试用）
   ============================================================ */

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SPOT_FILE = resolve(ROOT, "src/data/forecast/spots.json");

/* 省份 → 输出文件。加省份：这里加一项 + spots.json 里加机位 + 前端 PROVINCES 加一项。 */
const PROVINCES = [
  { key: "hn", name: "海南", out: "data/forecast.json" },
  { key: "gd", name: "广东", out: "data/forecast-gd.json" }
];

const MULTI = ["ecmwf_ifs025", "icon_seamless", "gfs_seamless"];
const TZ = "timezone=Asia%2FShanghai&forecast_days=2";

/* 气压层变量：云种识别与「大气截面图」的原料。
   必须与 src/lib/forecast/api.ts 的 PROFILE_VARS 保持一致。 */
const PROFILE_LEVELS = [1000, 925, 850, 700, 600, 500, 300, 200];
const PROFILE_VARS = [
  ...PROFILE_LEVELS.flatMap((lv) => [
    `cloud_cover_${lv}hPa`,
    `relative_humidity_${lv}hPa`,
    `temperature_${lv}hPa`,
    `geopotential_height_${lv}hPa`
  ]),
  ...[1000, 925, 850, 700].map((lv) => `dew_point_${lv}hPa`),
  "temperature_2m",
  "dew_point_2m",
  "visibility",
  "boundary_layer_height",
  "cape",
  "precipitation",
  "wind_speed_10m"
].join(",");

/* ---------- 工具 ---------- */

/** 请求前按 0.05° 去重坐标：同一格里的机位没必要重复请求 */
function uniqueCoords(spots) {
  const seen = new Set();
  const out = [];
  for (const s of spots) {
    const k = `${(Math.round(s.lat / 0.05) * 0.05).toFixed(3)},${(Math.round(s.lon / 0.05) * 0.05).toFixed(3)}`;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(s);
  }
  return out;
}

/** 响应 → 按机位顺序。Open-Meteo 按各模式格点吸附去重后条数会变少，
    所以每个机位认领「离它最近」的那一条（允许多机位共用同一格）。 */
function remapByNearest(list, spots) {
  if (!Array.isArray(list) || !list.length) return list;
  const hasCoords = list.every((p) => typeof p.latitude === "number");
  if (!hasCoords) {
    console.warn("  ⚠ 响应没有坐标，按顺序对齐");
    return spots.map((_, i) => list[i] || list[0]);
  }
  return spots.map((s) => {
    let best = 0;
    let bestD = Infinity;
    list.forEach((p, i) => {
      const d = Math.abs(p.latitude - s.lat) + Math.abs(p.longitude - s.lon);
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    });
    return list[best];
  });
}

/** 数字取整降体积：小数位按量级裁剪（云量/高度 0 位、温度 0.1、AOD 0.01） */
function roundDeep(v) {
  if (typeof v === "number") {
    const a = Math.abs(v);
    if (a >= 100) return Math.round(v);
    if (a >= 10) return Math.round(v * 10) / 10;
    return Math.round(v * 100) / 100;
  }
  if (Array.isArray(v)) return v.map(roundDeep);
  if (v && typeof v === "object") {
    const out = {};
    for (const k of Object.keys(v)) {
      /* 坐标保留 3 位小数：前端要靠它做「机位↔格点」配对，不能只留 1 位 */
      if (k === "latitude" || k === "longitude") out[k] = Math.round(v[k] * 1000) / 1000;
      else out[k] = roundDeep(v[k]);
    }
    return out;
  }
  return v;
}

function buildUrls(spots) {
  const coords = uniqueCoords(spots);
  const LL = `latitude=${coords.map((s) => s.lat).join(",")}&longitude=${coords.map((s) => s.lon).join(",")}`;
  return {
    count: coords.length,
    weather:
      `https://api.open-meteo.com/v1/forecast?${LL}` +
      `&hourly=cloud_cover_low,cloud_cover_mid,cloud_cover_high,relative_humidity_2m,precipitation_probability` +
      `&daily=sunrise,sunset&models=${MULTI.join(",")}&${TZ}`,
    prof:
      `https://api.open-meteo.com/v1/forecast?${LL}` +
      `&hourly=${PROFILE_VARS}&models=ecmwf_ifs025&${TZ}`,
    air:
      `https://air-quality-api.open-meteo.com/v1/air-quality?${LL}` +
      `&hourly=aerosol_optical_depth,pm2_5&timezone=Asia%2FShanghai&forecast_days=2`
  };
}

async function get(url, label, tries = 3) {
  for (let i = 1; i <= tries; i++) {
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(90000) });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const j = await r.json();
      console.log(`  ${label}: ok (${Math.round(JSON.stringify(j).length / 1024)} KB)`);
      return Array.isArray(j) ? j : [j];
    } catch (e) {
      console.warn(`  ${label}: 第 ${i} 次失败 — ${e.message}`);
      if (i === tries) throw e;
      await new Promise((r) => setTimeout(r, 3000));
    }
  }
}

/* ---------- 主流程 ---------- */

async function buildProvince(prov, spots) {
  console.log(`\n[${prov.name}] ${spots.length} 个机位`);
  const u = buildUrls(spots);
  console.log(`  唯一坐标 ${u.count} 个`);

  const [weather, prof, air] = await Promise.all([
    get(u.weather, "cloud"),
    get(u.prof, "profile"),
    get(u.air, "air")
  ]);

  const payload = {
    generatedAt: new Date().toISOString(),
    models: MULTI,
    prov: prov.key,
    spots: spots.length,
    weather: roundDeep(remapByNearest(weather, spots)),
    prof: roundDeep(remapByNearest(prof, spots)),
    air: roundDeep(remapByNearest(air, spots))
  };

  const out = resolve(ROOT, prov.out);
  await mkdir(dirname(out), { recursive: true });
  await writeFile(out, JSON.stringify(payload), "utf8");

  const kb = Math.round((await readFile(out)).length / 1024);
  console.log(`  写入 ${prov.out}（${kb} KB）`);
}

const main = async () => {
  const all = JSON.parse(await readFile(SPOT_FILE, "utf8"));
  if (!Array.isArray(all) || !all.length) throw new Error("spots.json 为空");

  const names = all.map((s) => s.n);
  const dup = names.filter((n, i) => names.indexOf(n) !== i);
  if (dup.length) throw new Error("机位重名：" + dup.join("、"));

  const only = process.argv[2];
  for (const prov of PROVINCES) {
    if (only && only !== prov.key) continue;
    const spots = all.filter((s) => s.prov === prov.key);
    if (!spots.length) {
      console.warn(`⚠ ${prov.name} 没有机位，跳过`);
      continue;
    }
    await buildProvince(prov, spots);
  }
  console.log(`\n完成 · ${new Date().toISOString()}`);
};

main().catch((e) => {
  console.error("生成失败：", e);
  process.exit(1);
});

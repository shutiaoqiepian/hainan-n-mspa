#!/usr/bin/env node
/* ============================================================
   预生成预报缓存（按省份分文件）
   ------------------------------------------------------------
   每 4 小时由 GitHub Actions 跑一次（一天 6 次）：
   把 Open-Meteo 的结果按省存成 data/forecast/<省份>.json（共 34 个省级单元）。
   访客只读自己那个省的文件，
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

/* 省份 → 输出文件。加省份：这里加一项 + spots.json 里加机位 + 前端 PROVINCES 加一项。
   注意：每个省一个文件，访客只下载自己那个省。 */
const PROV_KEYS = [
  ["hn", "海南"], ["gd", "广东"], ["gx", "广西"],
  ["sh", "上海"], ["js", "江苏"], ["zj", "浙江"], ["ah", "安徽"], ["fj", "福建"], ["jx", "江西"], ["sd", "山东"],
  ["bj", "北京"], ["tj", "天津"], ["he", "河北"], ["sx", "山西"], ["nm", "内蒙古"],
  ["ha", "河南"], ["hb", "湖北"], ["hu", "湖南"],
  ["cq", "重庆"], ["sc", "四川"], ["gz", "贵州"], ["yn", "云南"], ["xz", "西藏"],
  ["sn", "陕西"], ["gs", "甘肃"], ["qh", "青海"], ["nx", "宁夏"], ["xj", "新疆"],
  ["ln", "辽宁"], ["jl", "吉林"], ["hl", "黑龙江"],
  ["hk", "香港"], ["mo", "澳门"], ["tw", "台湾"]
];
const PROVINCES = PROV_KEYS.map(([key, name]) => ({ key, name, out: `data/forecast/${key}.json` }));

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
      if (k === "latitude" || k === "longitude") out[k] = Math.round(v[k] * 10000) / 10000;
      else out[k] = roundDeep(v[k]);
    }
    return out;
  }
  return v;
}

/** 剖面变量只在「日出/日落前后各 3 小时」有用，其余置 null。
    null 在 gzip 里几乎不占字节，能让 34 个省的总体积降一大截。 */
function trimProfile(prof, weather) {
  return prof.map((p, i) => {
    const w = weather[i];
    if (!p || !p.hourly || !w || !w.daily) return p;
    const times = p.hourly.time || [];
    const keep = new Set();
    const days = (w.daily.time || []).length;
    for (const key of ["sunrise", "sunset"]) {
      const series = w.daily[key] || w.daily[`${key}_ecmwf_ifs025`];
      if (!series) continue;
      for (let d = 0; d < Math.min(days, series.length); d++) {
        const iso = String(series[d]).slice(0, 13); // 2026-10-24T18
        const hour = Number(String(series[d]).slice(11, 13));
        if (Number.isNaN(hour)) continue;
        for (let k = hour - 3; k <= hour + 3; k++) {
          const h = ((k % 24) + 24) % 24;
          keep.add(iso.slice(0, 11) + String(h).padStart(2, "0"));
        }
      }
    }
    if (!keep.size) return p;
    const hourly = {};
    for (const k of Object.keys(p.hourly)) {
      if (k === "time") { hourly[k] = p.hourly[k]; continue; }
      hourly[k] = p.hourly[k].map((v, idx) => {
        const t = String(times[idx] || "").slice(0, 13);
        return keep.has(t) ? v : null;
      });
    }
    return { ...p, hourly };
  });
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
      /* 429 = 撞到限速：退避久一点，别继续加速撞 */
      const wait = /429/.test(e.message) ? 15000 * i : 3000;
      await new Promise((r) => setTimeout(r, wait));
    }
  }
}

/* ---------- 主流程 ----------
   一次性把全国机位按「每批 8 个坐标」分批抓取，再把结果分回各省。
   原因：Open-Meteo 对「一次请求多个地点」是按地点数计费的，
   169 个机位如果逐个省跑会很快撞到 600 次/分钟的限速（实测 429）。
   分批 + 每批之间停 ~1.5 秒，把峰值压到限速以下。 */

const CHUNK = 8;
const GAP_MS = 1500;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function buildChunkUrls(coords) {
  const LL = `latitude=${coords.map((s) => s.lat).join(",")}&longitude=${coords.map((s) => s.lon).join(",")}`;
  return {
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

/** 全国机位分块：每块 CHUNK 个坐标（同一块里的地点一起请求） */
function makeChunks(spots) {
  const chunks = [];
  for (let i = 0; i < spots.length; i += CHUNK) chunks.push(spots.slice(i, i + CHUNK));
  return chunks;
}

function trimProfileOne(p, w) {
  if (!p || !p.hourly || !w || !w.daily) return p;
  const times = p.hourly.time || [];
  const days = (w.daily.time || []).length;
  const keep = new Set();
  for (const key of ["sunrise", "sunset"]) {
    const series = w.daily[key] || w.daily[`${key}_ecmwf_ifs025`];
    if (!series) continue;
    for (let d = 0; d < Math.min(days, series.length); d++) {
      const iso = String(series[d]);
      const hour = Number(iso.slice(11, 13));
      if (Number.isNaN(hour)) continue;
      for (let k = hour - 3; k <= hour + 3; k++) {
        const h = ((k % 24) + 24) % 24;
        keep.add(iso.slice(0, 11) + String(h).padStart(2, "0"));
      }
    }
  }
  if (!keep.size) return p;
  const hourly = {};
  for (const k of Object.keys(p.hourly)) {
    if (k === "time") { hourly[k] = p.hourly[k]; continue; }
    hourly[k] = p.hourly[k].map((v, idx) => (keep.has(String(times[idx] || "").slice(0, 13)) ? v : null));
  }
  return { ...p, hourly };
}

/** 抓全国所有机位，返回 Map<机位名, {weather, prof, air}> */
async function fetchAll(spots) {
  const byName = new Map();
  const chunks = makeChunks(spots);
  console.log(`全国 ${spots.length} 个机位，分 ${chunks.length} 批（每批 ≤${CHUNK} 个坐标）`);

  for (let ci = 0; ci < chunks.length; ci++) {
    const chunk = chunks[ci];
    const u = buildChunkUrls(chunk);
    if (ci) await sleep(GAP_MS);

    const [weather, prof, air] = await Promise.all([
      get(u.weather, `cloud ${ci + 1}/${chunks.length}`, 4),
      get(u.prof, `profile ${ci + 1}/${chunks.length}`, 4),
      get(u.air, `air ${ci + 1}/${chunks.length}`, 4)
    ]);

    const w = remapByNearest(weather, chunk);
    const pr = remapByNearest(prof, chunk);
    const ar = remapByNearest(air, chunk);
    chunk.forEach((s, i) => {
      byName.set(s.n, {
        weather: roundDeep(w[i]),
        prof: roundDeep(trimProfileOne(pr[i], w[i])),
        air: roundDeep(ar[i])
      });
    });
    console.log(`  进度 ${ci + 1}/${chunks.length}`);
  }
  return byName;
}

async function writeProvince(prov, spots, data) {
  const payload = {
    generatedAt: new Date().toISOString(),
    models: MULTI,
    prov: prov.key,
    spots: spots.length,
    weather: spots.map((s) => data.get(s.n)?.weather),
    prof: spots.map((s) => data.get(s.n)?.prof),
    air: spots.map((s) => data.get(s.n)?.air)
  };

  const out = resolve(ROOT, prov.out);
  await mkdir(dirname(out), { recursive: true });
  const text = JSON.stringify(payload);
  await writeFile(out, text, "utf8");

  const kb = Math.round(Buffer.byteLength(text) / 1024);
  console.log(`  ${prov.name} → ${prov.out}（${spots.length} 个机位，${kb} KB）`);

}

const main = async () => {
  const all = JSON.parse(await readFile(SPOT_FILE, "utf8"));
  if (!Array.isArray(all) || !all.length) throw new Error("spots.json 为空");

  const names = all.map((s) => s.n);
  const dup = names.filter((n, i) => names.indexOf(n) !== i);
  if (dup.length) throw new Error("机位重名：" + dup.join("、"));

  const only = process.argv[2];
  const target = only ? all.filter((s) => s.prov === only) : all;
  if (!target.length) throw new Error("没有匹配的省份/机位：" + only);

  const data = await fetchAll(target);

  console.log("\n按省写文件：");
  for (const prov of PROVINCES) {
    const spots = target.filter((s) => s.prov === prov.key);
    if (!spots.length) continue;
    await writeProvince(prov, spots, data);
  }
  console.log(`\n完成 · ${new Date().toISOString()}`);
};

main().catch((e) => {
  console.error("生成失败：", e);
  process.exit(1);
});

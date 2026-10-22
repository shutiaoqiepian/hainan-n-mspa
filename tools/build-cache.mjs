#!/usr/bin/env node
/* ============================================================
   预生成预报缓存
   ------------------------------------------------------------
   每 4 小时由 GitHub Actions 跑一次（一天 6 次），把 Open-Meteo
   的结果存成 data/forecast.json。访客打开页面只读这一个静态文件，
   不再现场调三个接口，加载快很多，也省掉 API 的冷启动等待。

   用法：
     node tools/build-cache.mjs
   ============================================================ */

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = resolve(ROOT, "data/forecast.json");

/* 与 assets/forecast.js 的 SPOTS 保持一致 */
const SPOTS = [
  { n: "海口西海岸观海台", lat: 20.026, lon: 110.285 },
  { n: "海口假日海滩", lat: 20.033, lon: 110.245 },
  { n: "海口西秀海滩", lat: 20.018, lon: 110.262 },
  { n: "海口湾·云洞图书馆", lat: 20.030, lon: 110.316 },
  { n: "世纪大桥西岸", lat: 20.037, lon: 110.310 },
  { n: "海甸岛白沙门", lat: 20.070, lon: 110.345 },
  { n: "桂林洋海滩", lat: 19.995, lon: 110.500 },
  { n: "东寨港红树林", lat: 19.960, lon: 110.590 },
  { n: "海口火山口", lat: 19.930, lon: 110.250 },
  { n: "澄迈盈滨半岛", lat: 19.950, lon: 110.130 },
  { n: "临高角", lat: 19.92, lon: 109.68 },
  { n: "儋州峨蔓海岸", lat: 19.78, lon: 109.35 },
  { n: "昌江棋子湾", lat: 19.36, lon: 108.68 },
  { n: "东方鱼鳞洲", lat: 19.10, lon: 108.62 },
  { n: "乐东龙沐湾", lat: 18.55, lon: 108.72 },
  { n: "三亚天涯海角", lat: 18.30, lon: 109.35 },
  { n: "三亚鹿回头", lat: 18.22, lon: 109.51 },
  { n: "三亚亚龙湾", lat: 18.225, lon: 109.635 },
  { n: "陵水清水湾", lat: 18.42, lon: 109.92 },
  { n: "万宁日月湾", lat: 18.60, lon: 110.15 },
  { n: "万宁大花角", lat: 18.72, lon: 110.55 },
  { n: "琼海博鳌", lat: 19.15, lon: 110.58 },
  { n: "文昌东郊椰林", lat: 19.55, lon: 110.85 },
  { n: "文昌铜鼓岭", lat: 19.60, lon: 111.02 },
  { n: "五指山主峰", lat: 18.90, lon: 109.68 }
];

const MULTI = ["ecmwf_ifs025", "icon_seamless", "gfs_seamless"];

const lat = SPOTS.map(s => s.lat).join(",");
const lon = SPOTS.map(s => s.lon).join(",");
const LL = `latitude=${lat}&longitude=${lon}`;
const TZ = "timezone=Asia%2FShanghai&forecast_days=2";

const URLS = {
  weather:
    `https://api.open-meteo.com/v1/forecast?${LL}` +
    `&hourly=cloud_cover_low,cloud_cover_mid,cloud_cover_high,relative_humidity_2m,precipitation_probability` +
    `&daily=sunrise,sunset&models=${MULTI.join(",")}&${TZ}`,
  prof:
    `https://api.open-meteo.com/v1/forecast?${LL}` +
    `&hourly=relative_humidity_850hPa,relative_humidity_700hPa,relative_humidity_500hPa,relative_humidity_400hPa,` +
    `temperature_850hPa,dew_point_850hPa,temperature_700hPa,dew_point_700hPa,` +
    `geopotential_height_850hPa,geopotential_height_700hPa,` +
    `temperature_2m,dew_point_2m,visibility,boundary_layer_height,cape` +
    `&models=ecmwf_ifs025&${TZ}`,
  air:
    `https://air-quality-api.open-meteo.com/v1/air-quality?${LL}` +
    `&hourly=aerosol_optical_depth,pm2_5&timezone=Asia%2FShanghai`
};

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
      await new Promise(r => setTimeout(r, 3000));
    }
  }
}

const main = async () => {
  console.log(`生成预报缓存 · ${SPOTS.length} 个机位 · ${new Date().toISOString()}`);

  const [weather, prof, air] = await Promise.all([
    get(URLS.weather, "cloud"),
    get(URLS.prof, "profile"),
    get(URLS.air, "air")
  ]);

  const payload = {
    generatedAt: new Date().toISOString(),
    models: MULTI,
    spots: SPOTS.length,
    weather,
    prof,
    air
  };

  await mkdir(dirname(OUT), { recursive: true });
  await writeFile(OUT, JSON.stringify(payload), "utf8");

  const kb = Math.round((await readFile(OUT)).length / 1024);
  console.log(`写入 ${OUT}（${kb} KB）`);
};

main().catch(e => {
  console.error("生成失败：", e);
  process.exit(1);
});

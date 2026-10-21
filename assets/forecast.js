/* ============================================================
   海南霞光预报
   数据源：Open-Meteo（免费、无需 key）
   ============================================================ */

(function () {
  "use strict";

  /* ---------- 机位库 ---------- */
  var SPOTS = [
    /* ---- 海口：西向日落 ---- */
    { n: "海口西海岸观海台", lat: 20.026, lon: 110.285, face: "西",   area: "海口" },
    { n: "海口假日海滩",     lat: 20.033, lon: 110.245, face: "西",   area: "海口" },
    { n: "海口西秀海滩",     lat: 20.018, lon: 110.262, face: "西",   area: "海口" },
    { n: "海口湾·云洞图书馆", lat: 20.030, lon: 110.316, face: "西北", area: "海口" },
    { n: "世纪大桥西岸",     lat: 20.037, lon: 110.310, face: "西北", area: "海口" },
    { n: "海甸岛白沙门",     lat: 20.070, lon: 110.345, face: "西北", area: "海口" },
    /* ---- 海口：东向日出 ---- */
    { n: "桂林洋海滩",       lat: 19.995, lon: 110.500, face: "东",   area: "海口" },
    { n: "东寨港红树林",     lat: 19.960, lon: 110.590, face: "东",   area: "海口" },
    /* ---- 海口：全景 / 制高点 ---- */
    { n: "海口火山口",       lat: 19.930, lon: 110.250, face: "山顶", area: "海口" },
    { n: "澄迈盈滨半岛",     lat: 19.950, lon: 110.130, face: "西",   area: "海口" },

    /* ---- 西岸 ---- */
    { n: "临高角",           lat: 19.92,  lon: 109.68,  face: "西",   area: "西岸" },
    { n: "儋州峨蔓海岸",     lat: 19.78,  lon: 109.35,  face: "西",   area: "西岸" },
    { n: "昌江棋子湾",       lat: 19.36,  lon: 108.68,  face: "西",   area: "西岸" },
    { n: "东方鱼鳞洲",       lat: 19.10,  lon: 108.62,  face: "西",   area: "西岸" },

    /* ---- 南部 ---- */
    { n: "乐东龙沐湾",       lat: 18.55,  lon: 108.72,  face: "西",   area: "南部" },
    { n: "三亚天涯海角",     lat: 18.30,  lon: 109.35,  face: "西南", area: "南部" },
    { n: "三亚鹿回头",       lat: 18.22,  lon: 109.51,  face: "南",   area: "南部" },
    { n: "三亚亚龙湾",       lat: 18.225, lon: 109.635, face: "东南", area: "南部" },

    /* ---- 东岸（日出）---- */
    { n: "陵水清水湾",       lat: 18.42,  lon: 109.92,  face: "东南", area: "东岸" },
    { n: "万宁日月湾",       lat: 18.60,  lon: 110.15,  face: "东",   area: "东岸" },
    { n: "万宁大花角",       lat: 18.72,  lon: 110.55,  face: "东",   area: "东岸" },
    { n: "琼海博鳌",         lat: 19.15,  lon: 110.58,  face: "东",   area: "东岸" },
    { n: "文昌东郊椰林",     lat: 19.55,  lon: 110.85,  face: "东",   area: "东岸" },
    { n: "文昌铜鼓岭",       lat: 19.60,  lon: 111.02,  face: "东",   area: "东岸" },

    /* ---- 中部 ---- */
    { n: "五指山主峰",       lat: 18.90,  lon: 109.68,  face: "山顶", area: "中部" }
  ];

  var AREAS = ["全部", "东岸", "西岸", "南部", "中部", "海口"];

  /* 逐小时详情面板固定展示这个机位 */
  var DETAIL_SPOT = "海口西海岸观海台";

  var KINDS = {
    sunrise: { key: "sunrise", word: "日出", name: "朝霞" },
    sunset:  { key: "sunset",  word: "日落", name: "晚霞" }
  };

  function dayWord(d) { return d === 1 ? "明天" : "今天"; }

  var LEVELS = [
    { min: 92, name: "火烧云", color: "#ff6a3d" },
    { min: 82, name: "大烧",   color: "#ff9640" },
    { min: 66, name: "中烧",   color: "#ffd166" },
    { min: 48, name: "小烧",   color: "#9ad9b8" },
    { min: 30, name: "微烧",   color: "#8f979f" },
    { min: 0,  name: "不烧",   color: "#5b636a" }
  ];

  var state = {
    day: 0,          /* 0=今天 1=明天 */
    kind: "sunset",  /* sunrise / sunset */
    area: "全部",
    rows: [],
    detail: null,
    shareSpot: "",
    error: null,
    loading: false
  };

  /* ---------- 工具 ---------- */
  function levelOf(score) {
    for (var i = 0; i < LEVELS.length; i++) {
      if (score >= LEVELS[i].min) return LEVELS[i];
    }
    return LEVELS[LEVELS.length - 1];
  }

  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }

  function hourIndex(times, isoTime) {
    if (!times || !times.length || !isoTime) return -1;
    var want = isoTime.slice(0, 13) + ":00";
    var i = times.indexOf(want);
    if (i >= 0) return i;

    /* 退路：找最接近的一小时 */
    var target = new Date(isoTime).getTime();
    var best = -1, bestDiff = Infinity;
    for (var k = 0; k < times.length; k++) {
      var d = Math.abs(new Date(times[k]).getTime() - target);
      if (d < bestDiff) { bestDiff = d; best = k; }
    }
    return best;
  }

  /* ---------- 评分 ---------- */

  /* 高云是火烧云的“画布”。
     最佳区间 55–78%；低于 8% 基本没得烧；高于 78% 多为厚层云，反而挡光。
     注：模式对薄卷云常有漏报，所以低端做了缓坡而不是一刀切 */
  function fHigh(h) {
    if (h < 8) return 0;
    if (h <= 55) return (h - 8) / 47;
    if (h <= 78) return 1;
    return 0.25 + 0.75 * (100 - h) / 22;
  }

  /* 低云挡地平线，越少越好 */
  function fLow(l) {
    return clamp(1 - l / 82, 0, 1);
  }

  /* 中云适中最好，太厚会盖住 */
  function fMid(m) {
    if (m <= 55) return 1;
    return clamp(1 - (m - 55) / 40, 0, 1);
  }

  /* AOD 通透度分级
     参照 SunsetBot 团队公开发布的对照表（550nm）：
       0~0.1 水晶天 / 0.1~0.2 湛蓝 / 0.2~0.3 较蓝
       0.3~0.5 普通 / 0.5~0.8 有霾 / >0.8 污烧 */
  var AOD_BANDS = [
    { max: 0.10,     name: "水晶天", v: 1.00 },
    { max: 0.20,     name: "湛蓝",   v: 0.97 },
    { max: 0.30,     name: "较蓝",   v: 0.92 },
    { max: 0.50,     name: "普通",   v: 0.80 },
    { max: 0.80,     name: "有霾",   v: 0.55 },
    { max: Infinity, name: "污烧",   v: 0.30 }
  ];

  function aodBand(a) {
    for (var i = 0; i < AOD_BANDS.length; i++) {
      if (a <= AOD_BANDS[i].max) return AOD_BANDS[i];
    }
    return AOD_BANDS[AOD_BANDS.length - 1];
  }

  function fAod(a) {
    return aodBand(a).v;
  }

  /* 太阳高度角 + 方位角（NOAA 低精度公式） */
  function sunPosition(timeMs, latDeg, lonDeg) {
    var rad = Math.PI / 180;
    var n = timeMs / 86400000 + 2440587.5 - 2451545.0;

    var L = ((280.460 + 0.9856474 * n) % 360 + 360) % 360;
    var g = ((357.528 + 0.9856003 * n) % 360 + 360) % 360;
    var lambda = (L + 1.915 * Math.sin(g * rad) + 0.020 * Math.sin(2 * g * rad)) * rad;
    var eps = (23.439 - 0.0000004 * n) * rad;

    var dec = Math.asin(Math.sin(eps) * Math.sin(lambda));
    var ra = Math.atan2(Math.cos(eps) * Math.sin(lambda), Math.cos(lambda));

    var gmst = ((280.46061837 + 360.98564736629 * n) % 360 + 360) % 360;
    var lst = ((gmst + lonDeg) % 360 + 360) * rad;
    var ha = lst - ra;

    var latR = latDeg * rad;
    var sinEl = Math.sin(latR) * Math.sin(dec) +
                Math.cos(latR) * Math.cos(dec) * Math.cos(ha);
    sinEl = Math.max(-1, Math.min(1, sinEl));

    var el = Math.asin(sinEl);
    var cosEl = Math.cos(el) || 1e-6;

    var sinA = -Math.cos(dec) * Math.sin(ha) / cosEl;
    var cosA = (Math.sin(dec) - sinEl * Math.sin(latR)) / (cosEl * Math.cos(latR));
    var az = Math.atan2(sinA, cosA) / rad;
    if (az < 0) az += 360;

    return { el: el / rad, az: az };
  }

  function sunElevation(timeMs, latDeg, lonDeg) {
    return sunPosition(timeMs, latDeg, lonDeg).el;
  }

  /* 机位朝向 → 中心方位角（正北 0°，顺时针） */
  var FACE_AZ = {
    "西": 270, "西南": 235, "南": 180, "东南": 135,
    "东": 90, "西北": 305, "北": 0
  };

  /* 太阳落在这个方向，这个机位才拍得到。偏太多就明显降分 */
  function faceMatch(spot, az) {
    var center = FACE_AZ[spot.face];
    if (center == null) return 0.9;          /* 山顶等不限方向 */

    var d = Math.abs(((az - center) % 360 + 360) % 360);
    if (d > 180) d = 360 - d;

    return 0.55 + 0.45 * clamp(1 - d / 110, 0, 1);
  }

  /* 下雨、起雾都不利 */
  function fWet(pop, rh) {
    var p = pop < 40 ? 1 : pop < 70 ? 0.62 : 0.22;
    var r = rh > 93 ? 0.5 : rh > 88 ? 0.78 : 1;
    return p * r;
  }

  /* 评分：乘法结构，任何一项差都会被放大，而不是被别的项补回来。
     再用 1.8 次方整体压缩——「条件好」不等于「一定烧」，
     误差总云量预报的 TCC 只有 0.47（1 天时效），所以必须保守。 */
  function scoreOf(m) {
    var h = clamp(fHigh(m.high), 0, 1);
    if (h <= 0) return 0;

    var lowF = 0.30 + 0.70 * fLow(m.low);
    var midF = 0.72 + 0.28 * fMid(m.mid);
    var aodF = 0.70 + 0.30 * fAod(m.aod);
    var wetF = 0.80 + 0.20 * fWet(m.pop, m.rh);

    var raw = h * lowF * midF * aodF * wetF;
    var score = 100 * Math.pow(clamp(raw, 0, 1), 1.8);

    return Math.round(Math.min(96, score));
  }

  /* 彩虹：太阳高度 4–40°，且日落前两小时内有像样的降水概率
     教程要点：虹总在太阳对面，太阳低于 42° 才可能形成 */
  function rainbowHint(spot, w, idx, prof) {
    /* 对流旺盛时降水概率会被低估，CAPE 作为补充判据 */
    var convective = prof && typeof prof.cape === "number" && prof.cape >= 1500;

    for (var back = 2; back >= 0; back--) {
      var k = idx - back;
      if (k < 0) continue;

      var popK = w.hourly.precipitation_probability[k];
      if (!(popK >= 30) && !convective) continue;

      var ms = Date.parse(w.hourly.time[k] + ":00+08:00");
      if (isNaN(ms)) continue;

      var el = sunElevation(ms, spot.lat, spot.lon);
      if (el >= 4 && el <= 40) return true;
    }
    return false;
  }

  /* 高空湿度剖面 → 粗判云在哪个高度
     对应教程里的「斜温图」思路：湿度饱和的层次就是云层所在
     气压层高度：850≈1500m 700≈3000m 500≈5500m 400≈7200m */
  function profileOf(pr, idx) {
    if (!pr || !pr.hourly) return null;

    var h = pr.hourly;
    function v(name) {
      var arr = h[name];
      if (!arr) return null;
      var x = arr[idx];
      return typeof x === "number" ? x : null;
    }

    var rh850 = v("relative_humidity_850hPa");
    var rh700 = v("relative_humidity_700hPa");
    var rh500 = v("relative_humidity_500hPa");
    var rh400 = v("relative_humidity_400hPa");
    var blh = v("boundary_layer_height");
    var cape = v("cape");

    var lowWet = rh850 != null && rh850 >= 80;
    var midWet = rh700 != null && rh700 >= 80;
    var highWet = (rh500 != null && rh500 >= 60) || (rh400 != null && rh400 >= 60);

    var label, mod;

    if (lowWet && highWet) {
      label = "低云封挡，高云被遮";
      mod = 0.72;
    } else if (lowWet) {
      label = "低层潮湿，地平线不清";
      mod = 0.82;
    } else if (highWet) {
      label = "高层有云、低层干爽";
      mod = 1.10;
    } else if (midWet) {
      label = "中层有云，高层偏干";
      mod = 0.95;
    } else {
      label = "各层偏干，本就不易有霞";
      mod = 0.90;
    }

    /* 边界层很浅：霾和雾贴着地面，低角度视野差 */
    if (blh != null && blh < 350 && mod > 0.7) {
      label += " · 边界层浅";
      mod *= 0.94;
    }

    return { label: label, mod: mod, cape: cape };
  }
  function addMin(t, delta) {
    var p = String(t).split(":");
    var d = new Date(2000, 0, 1, Number(p[0]), Number(p[1]));
    d.setMinutes(d.getMinutes() + delta);
    return ("0" + d.getHours()).slice(-2) + ":" + ("0" + d.getMinutes()).slice(-2);
  }

  /* 海口详细：日落前后逐小时 */
  function buildDetail(w, air, idx, iso, spot) {
    var times = w.hourly.time;
    var hours = [];
    var start = Math.max(0, idx - 2);
    var end = Math.min(times.length - 1, idx + 2);

    for (var k = start; k <= end; k++) {
      var aod = 0.2;
      if (air && air.hourly && air.hourly.aerosol_optical_depth) {
        var av = air.hourly.aerosol_optical_depth[k];
        if (typeof av === "number") aod = av;
      }
      var m = {
        high: w.hourly.cloud_cover_high[k],
        mid: w.hourly.cloud_cover_mid[k],
        low: w.hourly.cloud_cover_low[k],
        rh: w.hourly.relative_humidity_2m[k],
        pop: w.hourly.precipitation_probability[k],
        aod: aod
      };
      hours.push({
        t: times[k].slice(11, 16),
        high: m.high,
        mid: m.mid,
        low: m.low,
        aod: aod,
        pop: m.pop,
        score: scoreOf(m)
      });
    }

    var t = iso.slice(11, 16);
    return {
      spot: spot,
      time: t,
      golden: addMin(t, -30) + " – " + t,
      blue: addMin(t, 14) + " – " + addMin(t, 34),
      hours: hours
    };
  }

  /* ---------- 取数 ---------- */
  function buildUrl(host, params) {
    var lats = SPOTS.map(function (s) { return s.lat; }).join(",");
    var lons = SPOTS.map(function (s) { return s.lon; }).join(",");
    return host + "?latitude=" + lats + "&longitude=" + lons + "&" + params +
           "&timezone=Asia%2FShanghai&forecast_days=2";
  }

  /* 带超时 + 重试：手机网络下偶发挂住，不能让页面一直转圈 */
  function fetchJson(url, tries) {
    if (tries == null) tries = 2;

    var ctl = null;
    var timer = null;
    if (typeof AbortController !== "undefined") {
      ctl = new AbortController();
      timer = setTimeout(function () { try { ctl.abort(); } catch (e) {} }, 15000);
    }

    function done() { if (timer) { clearTimeout(timer); timer = null; } }

    return fetch(url, ctl ? { signal: ctl.signal } : undefined)
      .then(function (r) {
        done();
        if (!r.ok) throw new Error("HTTP " + r.status);
        return r.json();
      })
      .catch(function (err) {
        done();
        if (tries > 1) return fetchJson(url, tries - 1);
        throw err;
      });
  }

  /* 取某一小时的观测集合 */
  function measureAt(w, airObj, k) {
    var aod = 0.2;
    if (airObj && airObj.hourly && airObj.hourly.aerosol_optical_depth) {
      var v = airObj.hourly.aerosol_optical_depth[k];
      if (typeof v === "number") aod = v;
    }
    return {
      high: w.hourly.cloud_cover_high[k],
      mid: w.hourly.cloud_cover_mid[k],
      low: w.hourly.cloud_cover_low[k],
      rh: w.hourly.relative_humidity_2m[k],
      pop: w.hourly.precipitation_probability[k],
      aod: aod
    };
  }

  /* 一次取数，缓存起来：切换今天/明天/日出/日落不再重新请求 */
  var CACHE = null;
  var CACHE_MS = 10 * 60 * 1000;

  function load(force) {
    if (!force && CACHE && Date.now() - CACHE.at < CACHE_MS) {
      compute(CACHE.weather, CACHE.air, CACHE.profs);
      return;
    }

    state.loading = true;
    state.error = null;
    render();

    var fUrl = buildUrl(
      "https://api.open-meteo.com/v1/forecast",
      "hourly=cloud_cover_low,cloud_cover_mid,cloud_cover_high,relative_humidity_2m," +
      "precipitation_probability&daily=sunrise,sunset"
    );

    var aUrl = buildUrl(
      "https://air-quality-api.open-meteo.com/v1/air-quality",
      "hourly=aerosol_optical_depth"
    );

    /* 高空湿度剖面：失败也不影响主功能 */
    var pUrl = buildUrl(
      "https://api.open-meteo.com/v1/forecast",
      "hourly=relative_humidity_850hPa,relative_humidity_700hPa," +
      "relative_humidity_500hPa,relative_humidity_400hPa," +
      "boundary_layer_height,cape"
    );

    Promise.all([
      fetchJson(fUrl),
      fetchJson(aUrl).catch(function () { return null; }),
      fetchJson(pUrl).catch(function () { return null; })
    ]).then(function (res) {
      var weather = res[0];
      var air = res[1];
      var profs = res[2];

      /* 单点时返回对象，多点时返回数组 */
      if (!Array.isArray(weather)) weather = [weather];
      if (air && !Array.isArray(air)) air = [air];
      if (profs && !Array.isArray(profs)) profs = [profs];

      CACHE = { weather: weather, air: air, profs: profs, at: Date.now() };
      compute(weather, air, profs);
    }).catch(function (e) {
      state.loading = false;
      state.error = "取不到数据：" + (e && e.message ? e.message : "网络错误");
      render();
    });
  }

  function compute(weather, air, profs) {
    state.detail = null;
    var cfg = KINDS[state.kind];
    var rows = [];

    SPOTS.forEach(function (spot, i) {
      var w = weather[i] || weather[0];
      if (!w) return;

      var dayList = w.daily && w.daily[cfg.key];
      if (!dayList) return;

      var iso = dayList[Math.min(state.day, dayList.length - 1)];
      var idx = hourIndex(w.hourly.time, iso);
      if (idx < 0) return;

      var airObj = air && air[i] ? air[i] : null;

      var m = measureAt(w, airObj, idx);
      m.time = iso.slice(11, 16);

      /* 逐时平滑：文献指出模式对“逐时变率”预报能力差，
         所以取前后各一小时加权，减少单点噪声 */
      var s1 = scoreOf(m);
      var sPrev = idx > 0 ? scoreOf(measureAt(w, airObj, idx - 1)) : s1;
      var sNext = idx < w.hourly.time.length - 1
        ? scoreOf(measureAt(w, airObj, idx + 1))
        : s1;

      var score = Math.round(0.25 * sPrev + 0.5 * s1 + 0.25 * sNext);

      /* 朝向匹配：太阳落在哪边，决定这个机位拍不拍得到 */
      var sun = null;
      var face = 1;
      var ms = Date.parse(iso + ":00+08:00");
      if (!isNaN(ms)) sun = sunPosition(ms, spot.lat, spot.lon);
      if (sun) {
        face = faceMatch(spot, sun.az);
        score = Math.round(score * face);
      }

      /* 用高空湿度剖面微调：区分「低云封挡」和「高层有云、低层干爽」 */
      var prof = profileOf(profs && profs[i], idx);
      if (prof) {
        score = clamp(Math.round(score * prof.mod), 0, 100);
      }

      /* 时效折扣：明天比今天远，按文献 48–72h 有技巧上限再降一档 */
      if (state.day === 1) {
        score = Math.round(score * 0.95);
      }

      score = clamp(score, 0, 96);

      if (spot.n === DETAIL_SPOT) {
        state.detail = buildDetail(w, air && air[i], idx, iso, spot);
      }

      rows.push({
        spot: spot,
        m: m,
        score: score,
        level: levelOf(score),
        aodName: aodBand(m.aod).name,
        profLabel: prof ? prof.label : "",
        rainbow: rainbowHint(spot, w, idx, prof),
        sunAz: sun ? Math.round(sun.az) : null,
        faceOff: face < 0.85,
        date: iso.slice(0, 10),
        ms: ms
      });
    });

    rows.sort(function (a, b) {
      if (b.score !== a.score) return b.score - a.score;
      /* 同分时把“拍不到”的机位排后面 */
      if (a.faceOff !== b.faceOff) return a.faceOff ? 1 : -1;
      return 0;
    });

    state.rows = rows;
    state.loading = false;
    state.error = null;
    state.updatedAt = CACHE ? CACHE.at : Date.now();
    render();
  }

  /* ---------- 渲染 ---------- */
  function el(tag, cls, html) {
    var d = document.createElement(tag);
    if (cls) d.className = cls;
    if (html != null) d.innerHTML = html;
    return d;
  }

  /* 距离这个时刻还有多久 / 过去多久 */
  function leadText(ms) {
    var h = (ms - Date.now()) / 3600000;
    var wd = dayWord(state.day) + KINDS[state.kind].word;
    if (h < -0.5) return wd + " · 已过去 " + Math.round(-h) + " 小时 · 仅作回顾";
    if (h < 1) return wd + " · 就在 " + Math.round(h * 60) + " 分钟内";
    if (h <= 24) return wd + " · 约 " + Math.round(h) + " 小时 · 可信度较高";
    return wd + " · 约 " + Math.round(h) + " 小时 · 时效参考";
  }

  function render() {
    var list = document.getElementById("fc-list");
    if (!list) return;

    /* 标题区 */
    var stamp = document.getElementById("fc-stamp");
    if (stamp) {
      var spanTxt = state.rows.length && state.rows[0].ms
        ? leadText(state.rows[0].ms)
        : "正在读取时间";

      stamp.textContent = state.loading
        ? "正在读取最新数据…"
        : state.rows.length
          ? spanTxt + "　｜　数据更新 " +
            new Date(state.updatedAt || Date.now()).toLocaleString("zh-CN", { hour12: false })
          : "";
    }

    list.innerHTML = "";

    /* 详细面板先渲染（加载中/出错时会自动隐藏） */
    renderDetail();

    if (state.loading) {
      list.appendChild(el("div", "fc-empty", "正在获取海南各地的云层与气溶胶数据…"));
      return;
    }

    if (state.error) {
      list.appendChild(el("div", "fc-empty", state.error + "<br /><br />请确认电脑已联网，然后刷新页面。"));
      return;
    }

    var rows = state.rows.filter(function (r) {
      return state.area === "全部" || r.spot.area === state.area;
    });

    if (!rows.length) {
      list.appendChild(el("div", "fc-empty", "这个区域暂时没有可用的预报点。"));
      return;
    }

    rows.forEach(function (r, i) {
      var col = r.level.color;
      var item = el("article", "fc-row" + (i === 0 ? " is-top" : ""));

      var score = el("div", "fc-score");
      score.style.setProperty("--p", r.score);
      score.style.setProperty("--c", col);
      score.appendChild(el("span", null, String(r.score)));

      var main = el("div", "fc-main");
      main.appendChild(el("div", "fc-name",
        "<b>" + (i + 1) + "</b> " + r.spot.n +
        ' <i class="fc-face">朝' + r.spot.face + "</i>"));

      main.appendChild(el("div", "fc-meta",
        KINDS[state.kind].word + " " + r.m.time +
        (r.sunAz != null
          ? " · 方位 " + r.sunAz + "°"
          : "") +
        " · 高云 " + Math.round(r.m.high) + "%" +
        " · 低云 " + Math.round(r.m.low) + "%" +
        " · AOD " + r.m.aod.toFixed(2) + "（" + r.aodName + "）" +
        " · 降雨 " + Math.round(r.m.pop) + "%"));

      if (r.profLabel) {
        main.appendChild(el("div", "fc-prof", "云层：" + r.profLabel));
      }

      if (r.faceOff && r.sunAz != null) {
        main.appendChild(el("div", "fc-faceoff",
          "⚠ 朝向不符：机位朝" + r.spot.face + "，太阳方位 " + r.sunAz + "°"));
      }

      if (r.rainbow) {
        main.appendChild(el("div", "fc-tag", "🌈 可能有彩虹"));
      }

      var lv = el("div", "fc-level");
      lv.style.color = col;
      lv.textContent = r.level.name;

      var sh = el("button", "fc-share", "⤴");
      sh.type = "button";
      sh.title = "复制这一条的链接";
      sh.setAttribute("aria-label", "复制这一条的链接");
      sh.addEventListener("click", function (e) {
        e.stopPropagation();
        shareRow(r);
      });

      var done = !!fbStore()[fbKeyOf(r)];
      var fb = el("button", "fc-fb" + (done ? " is-done" : ""), done ? "✓" : "✎");
      fb.type = "button";
      fb.title = done ? "你已反馈过这一条（可再次提交）" : "回填实际结果";
      fb.setAttribute("aria-label", fb.title);
      fb.addEventListener("click", function (e) {
        e.stopPropagation();
        openFeedback(r);
      });

      item.appendChild(score);
      item.appendChild(main);
      item.appendChild(lv);
      item.appendChild(fb);
      item.appendChild(sh);

      if (state.shareSpot && r.spot.n === state.shareSpot) {
        item.classList.add("is-hl");
      }

      list.appendChild(item);
    });

    if (state.shareSpot) {
      var hl = list.querySelector(".is-hl");
      if (hl) hl.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }

  /* ---------- 海口详细面板 ---------- */
  function renderDetail() {
    var box = document.getElementById("fc-detail");
    if (!box) return;

    box.innerHTML = "";

    if (state.loading || state.error || !state.detail) {
      box.style.display = "none";
      return;
    }

    box.style.display = "";
    var d = state.detail;
    var word = KINDS[state.kind].word;
    var dayTxt = dayWord(state.day);

    var head = el("div", "fcd-head");
    var left = el("div", "fcd-left");
    left.appendChild(el("p", "eyebrow", "海口 · " + dayTxt + word + "逐小时"));
    left.appendChild(el("h3", "fcd-title", DETAIL_SPOT));
    left.appendChild(el("p", "fcd-sub",
      dayTxt + word + " " + d.time + "　·　黄金时刻 " + d.golden + "　·　蓝调 " + d.blue +
      "（时刻为估算）"));
    head.appendChild(left);

    var btn = el("button", "btn btn-ghost fcd-share", "分享海口这一条");
    btn.type = "button";
    btn.addEventListener("click", function () { shareSpot(DETAIL_SPOT); });
    head.appendChild(btn);

    box.appendChild(head);

    var grid = el("div", "fcd-grid");
    var headRow = el("div", "fcd-row fcd-row-head");
    ["时间", "高云", "中云", "低云", "AOD", "降雨", "评分"].forEach(function (t) {
      headRow.appendChild(el("span", null, t));
    });
    grid.appendChild(headRow);

    d.hours.forEach(function (h) {
      var row = el("div", "fcd-row");
      var lv = levelOf(h.score);
      row.appendChild(el("span", "fcd-time", h.t));
      row.appendChild(el("span", null, Math.round(h.high) + "%"));
      row.appendChild(el("span", null, Math.round(h.mid) + "%"));
      row.appendChild(el("span", null, Math.round(h.low) + "%"));
      row.appendChild(el("span", null, h.aod.toFixed(2)));
      row.appendChild(el("span", null, Math.round(h.pop) + "%"));
      var sc = el("span", "fcd-score", String(h.score));
      sc.style.color = lv.color;
      row.appendChild(sc);
      grid.appendChild(row);
    });

    box.appendChild(grid);
    box.appendChild(el("p", "fcd-tip",
      "黄金时刻适合拍色彩，蓝调时刻适合拍城市灯光与海面的冷暖对比。" +
      "低云 20% 以下、高云 30–88% 时最值得提前到场。"));
  }

  /* ---------- 分享 ---------- */
  function shareSpot(name) {
    var row = null;
    state.rows.forEach(function (r) {
      if (r.spot.n === name) row = r;
    });
    if (row) shareRow(row);
  }

  function shareRow(r) {
    var base = location.href.split("?")[0].split("#")[0];
    var url = base + "?d=" + state.day + "&k=" + state.kind +
              "&a=" + encodeURIComponent(r.spot.area) +
              "&s=" + encodeURIComponent(r.spot.n);
    var word = dayWord(state.day) + KINDS[state.kind].word;
    var text = "【" + word + "】" + r.spot.n +
               " 霞光指数 " + r.score + "（" + r.level.name + "）" +
               " · " + r.m.time + " " + KINDS[state.kind].word +
               "\n" + url;
    copyText(text);
  }

  function toast(msg) {
    var t = document.getElementById("fc-toast");
    if (!t) {
      t = document.createElement("div");
      t.id = "fc-toast";
      t.className = "fc-toast";
      document.body.appendChild(t);
    }
    t.textContent = msg;
    t.classList.add("is-show");
    clearTimeout(toast._timer);
    toast._timer = setTimeout(function () {
      t.classList.remove("is-show");
    }, 2200);
  }

  function copyText(text) {
    function ok() { toast("已复制，去群里发吧"); }
    function fail() { toast("复制失败，请手动选中链接"); }
    function fallback() {
      var ta = document.createElement("textarea");
      ta.value = text;
      ta.style.cssText = "position:fixed;left:-9999px;top:0;opacity:0";
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand("copy"); ok(); }
      catch (e) { fail(); }
      document.body.removeChild(ta);
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(ok, fallback);
    } else {
      fallback();
    }
  }

  /* ---------- 实际结果反馈 ---------- */
  var fbState = { row: null, value: "" };

  var FB_KEY = "mspa_fb_v1";

  function fbStore() {
    try {
      return JSON.parse(localStorage.getItem(FB_KEY) || "{}") || {};
    } catch (e) {
      return {};
    }
  }

  function fbKeyOf(r) {
    return r.spot.n + "|" + r.date + "|" + state.kind;
  }

  function fbRemember(r) {
    var s = fbStore();
    s[fbKeyOf(r)] = Date.now();
    try {
      localStorage.setItem(FB_KEY, JSON.stringify(s));
    } catch (e) { /* 忽略 */ }
  }

  function openFeedback(r) {
    var modal = document.getElementById("fb-modal");
    if (!modal) return;

    fbState.row = r;
    fbState.value = "";

    document.getElementById("fb-sub").textContent =
      r.spot.n + " · " + r.date + " · 系统给出 " + r.score + " 分（" + r.level.name + "）";
    document.getElementById("fb-note").value = "";
    document.getElementById("fb-name").value = "";

    modal.querySelectorAll("#fb-options button").forEach(function (b) {
      b.classList.remove("is-on");
    });

    modal.classList.add("is-open");
    document.body.style.overflow = "hidden";
  }

  function closeFeedback() {
    var modal = document.getElementById("fb-modal");
    if (modal) modal.classList.remove("is-open");
    document.body.style.overflow = "";
  }

  function initFeedback() {
    var modal = document.getElementById("fb-modal");
    if (!modal) return;

    modal.addEventListener("click", function (e) {
      if (e.target === modal) closeFeedback();
    });

    var closeBtn = document.getElementById("fb-close");
    if (closeBtn) closeBtn.addEventListener("click", closeFeedback);

    modal.querySelectorAll("#fb-options button").forEach(function (b) {
      b.addEventListener("click", function () {
        modal.querySelectorAll("#fb-options button").forEach(function (x) {
          x.classList.remove("is-on");
        });
        b.classList.add("is-on");
        fbState.value = b.getAttribute("data-v");
      });
    });

    var submit = document.getElementById("fb-submit");
    if (submit) submit.addEventListener("click", submitFeedback);

    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape") closeFeedback();
    });
  }

  function submitFeedback() {
    if (!fbState.row) return;
    if (!fbState.value) {
      toast("请先选一个实际结果");
      return;
    }

    var r = fbState.row;
    var note = (document.getElementById("fb-note").value || "").trim();
    var nick = (document.getElementById("fb-name").value || "").trim();

    var body = new URLSearchParams();
    body.set("form-name", "sunset-feedback");
    body.set("spot", r.spot.n);
    body.set("score", String(r.score));
    body.set("level", r.level.name);
    body.set("mode", KINDS[state.kind].word);
    body.set("date", r.date || "");
    body.set("actual", fbState.value);
    body.set("note", note);
    body.set("nickname", nick);

    var btn = document.getElementById("fb-submit");
    btn.disabled = true;
    btn.textContent = "提交中…";

    var oneLine = "霞光反馈｜" + dayWord(state.day) + KINDS[state.kind].word +
                  "｜" + r.spot.n + "｜" + (r.date || "") +
                  "｜系统 " + r.score + " 分（" + r.level.name + "）" +
                  "｜实际：" + fbState.value +
                  (note ? "｜备注：" + note : "") +
                  (nick ? "｜来自：" + nick : "");

    fetch("/", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString()
    }).then(function (res) {
      if (!res.ok) throw new Error("HTTP " + res.status);
      fbRemember(r);
      closeFeedback();
      toast("已提交，谢谢反馈 🙏");
      render();
    }).catch(function () {
      /* 表单服务没开通时也别让人白填：存在本机 + 复制一段可直接发的文本 */
      fbRemember(r);
      closeFeedback();
      render();
      copySilent(oneLine);
      toast("线上表单未开通：内容已复制，粘贴给管理员即可");
    }).then(function () {
      btn.disabled = false;
      btn.textContent = "提交反馈";
    });
  }

  function copySilent(text) {
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).catch(function () {});
        return;
      }
    } catch (e) { /* 忽略 */ }
    try {
      var ta = document.createElement("textarea");
      ta.value = text;
      ta.style.cssText = "position:fixed;left:-9999px;top:0;opacity:0";
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
    } catch (e) { /* 忽略 */ }
  }

  /* ---------- 交互 ---------- */
  function nextUpcoming() {
    /* 没得选的时候，默认给“最近的一个还没到的时刻”：
       Hainan 日出大约 6:20–7:10，日落大约 18:00–19:20 */
    var h = new Date().getHours() + new Date().getMinutes() / 60;
    if (h < 7.2) return { day: 0, kind: "sunrise" };
    if (h < 18.2) return { day: 0, kind: "sunset" };
    return { day: 1, kind: "sunrise" };
  }

  function initControls() {
    var picked = false;

    /* 从分享链接还原状态；旧链接的 ?m= 也认 */
    try {
      var q = new URLSearchParams(location.search);
      var k = q.get("k") || q.get("m");
      if (k === "sunset" || k === "sunrise") { state.kind = k; picked = true; }
      var d = q.get("d");
      if (d === "0" || d === "1") { state.day = Number(d); picked = true; }
      var a = q.get("a");
      if (a && AREAS.indexOf(a) >= 0) state.area = a;
      var s = q.get("s");
      if (s) state.shareSpot = s;
    } catch (e) { /* 忽略 */ }

    if (!picked) {
      var up = nextUpcoming();
      state.day = up.day;
      state.kind = up.kind;
    }

    function paint() {
      document.querySelectorAll("[data-day]").forEach(function (b) {
        b.classList.toggle("is-on", Number(b.getAttribute("data-day")) === state.day);
      });
      document.querySelectorAll("[data-kind]").forEach(function (b) {
        b.classList.toggle("is-on", b.getAttribute("data-kind") === state.kind);
      });
    }

    document.querySelectorAll("[data-day]").forEach(function (b) {
      b.addEventListener("click", function () {
        state.day = Number(b.getAttribute("data-day"));
        paint();
        load();
      });
    });

    document.querySelectorAll("[data-kind]").forEach(function (b) {
      b.addEventListener("click", function () {
        state.kind = b.getAttribute("data-kind");
        paint();
        load();
      });
    });

    paint();

    var bar = document.getElementById("fc-areas");
    if (!bar) return;

    AREAS.forEach(function (a) {
      var b = el("button", "chip" + (a === state.area ? " is-on" : ""));
      b.textContent = a;
      b.addEventListener("click", function () {
        bar.querySelectorAll(".chip").forEach(function (x) {
          x.classList.remove("is-on");
        });
        b.classList.add("is-on");
        state.area = a;
        render();
      });
      bar.appendChild(b);
    });
  }

  document.addEventListener("DOMContentLoaded", function () {
    initControls();
    initFeedback();
    load();
  });
})();

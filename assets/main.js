/* ============================================================
   18N-MSPA 交互脚本
   ============================================================ */

(function () {
  "use strict";

  /* ---------- 1. 手机导航开关 ---------- */
  function initNav() {
    var toggle = document.querySelector(".nav-toggle");
    var list = document.querySelector(".nav ul");
    if (!toggle || !list) return;

    toggle.addEventListener("click", function () {
      list.classList.toggle("is-open");
      var open = list.classList.contains("is-open");
      toggle.setAttribute("aria-expanded", open ? "true" : "false");
      toggle.textContent = open ? "✕" : "☰";
    });

    list.addEventListener("click", function (e) {
      if (e.target.tagName === "A") {
        list.classList.remove("is-open");
        toggle.textContent = "☰";
        toggle.setAttribute("aria-expanded", "false");
      }
    });
  }

  /* ---------- 2. 当前页高亮 ---------- */
  function initActive() {
    function norm(u) {
      u = String(u || "").split("?")[0].split("#")[0];
      u = u.split("/").pop();
      u = u.replace(/\.html$/, "");
      if (u === "index") u = "";
      return u;
    }
    var here = norm(location.pathname);
    document.querySelectorAll(".nav ul a").forEach(function (a) {
      if (norm(a.getAttribute("href")) === here) {
        a.classList.add("is-active");
        a.setAttribute("aria-current", "page");
      }
    });
  }

  /* ---------- 3. 滚动淡入 ---------- */
  function initReveal() {
    var nodes = document.querySelectorAll(".reveal");
    if (!nodes.length) return;

    if (!("IntersectionObserver" in window)) {
      nodes.forEach(function (n) { n.classList.add("is-in"); });
      return;
    }

    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        if (en.isIntersecting) {
          var el = en.target;
          var delay = el.getAttribute("data-delay") || 0;
          setTimeout(function () { el.classList.add("is-in"); }, Number(delay));
          io.unobserve(el);
        }
      });
    }, { threshold: 0.12, rootMargin: "0px 0px -8% 0px" });

    nodes.forEach(function (n) { io.observe(n); });
  }

  /* ---------- 4. 首屏大图 ---------- */
  function initHero() {
    var holder = document.querySelector(".hero-media img");
    if (!holder || !window.HERO_IMAGE) return;
    holder.src = "images/" + window.HERO_IMAGE;
    holder.alt = "18N-MSPA 摄影作品";
  }

  /* ---------- 4b. logo 自动兜底 ----------
     依次尝试几个可能的文件名，都不存在才隐藏 */
  function initLogos() {
    var tries = [
      "images/mspa透明底.png",
      "images/nmspa.png",
      "images/mspa.png",
      "images/logo.png"
    ];

    document.querySelectorAll("img.logo, img.hero-logo").forEach(function (img) {
      var idx = 1;
      img.addEventListener("error", function () {
        if (idx < tries.length) {
          img.src = tries[idx];
          idx++;
        } else {
          img.style.display = "none";
        }
      });
    });
  }

  /* ---------- 5. 作品墙 ---------- */
  var CATS = ["海岸风光", "城市夜色", "民俗人文", "星空银河", "航拍视角"];

  function buildWall(filter, author) {
    var wall = document.getElementById("wall");
    if (!wall || !window.PHOTOS) return;

    var list = window.PHOTOS.filter(function (p) {
      if (author) return p.a === author;
      return !filter || p.c === filter;
    });

    wall.innerHTML = "";

    list.forEach(function (p) {
      var fig = document.createElement("figure");
      fig.setAttribute("data-src", "images/" + p.f);

      var img = document.createElement("img");
      img.loading = "lazy";
      img.decoding = "async";
      img.alt = p.t || "18N-MSPA 作品";
      img.src = "images/thumbs/" + p.f;

      img.addEventListener("load", function () {
        img.classList.add("is-loaded");
      });

      img.addEventListener("error", function () {
        /* 缩略图还没有时，直接用大图；大图也没有才显示占位 */
        if (!img.dataset.tryFull) {
          img.dataset.tryFull = "1";
          img.src = "images/" + p.f;
          return;
        }
        fig.classList.add("is-missing");
        fig.style.minHeight = "240px";
        fig.style.background =
          "linear-gradient(135deg, rgba(79,179,232,.14), rgba(53,214,192,.06))";
        img.remove();

        var note = document.createElement("div");
        note.style.cssText =
          "padding:24px;font-size:12px;color:#8f979f;letter-spacing:.1em;word-break:break-all";
        note.textContent = "图片缺失：" + p.f;
        fig.appendChild(note);
      });

      fig.appendChild(img);

      if (p.t) {
        var cap = document.createElement("figcaption");
        cap.textContent = p.t + (p.a ? " · " + p.a : "");
        fig.appendChild(cap);
      }

      wall.appendChild(fig);
    });
  }

  function initGallery() {
    var wall = document.getElementById("wall");
    if (!wall) return;

    /* 分类按钮 */
    var bar = document.getElementById("filters");
    if (bar) {
      bar.innerHTML = "";

      var all = document.createElement("button");
      all.className = "chip is-on";
      all.textContent = "全部";
      all.addEventListener("click", function () {
        selectChip(all);
        buildWall("");
      });
      bar.appendChild(all);

      CATS.forEach(function (c) {
        var has = window.PHOTOS.some(function (p) { return p.c === c; });
        if (!has) return;

        var b = document.createElement("button");
        b.className = "chip";
        b.textContent = c;
        b.addEventListener("click", function () {
          selectChip(b);
          buildWall(c);
        });
        bar.appendChild(b);
      });
    }

    function selectChip(el) {
      bar.querySelectorAll(".chip").forEach(function (c) {
        c.classList.remove("is-on");
      });
      el.classList.add("is-on");
    }

    /* 从成员页进来：gallery.html?a=作者名 */
    var startAuthor = "";
    try {
      startAuthor = (new URLSearchParams(location.search).get("a") || "").trim();
    } catch (e) {
      startAuthor = "";
    }

    if (startAuthor) {
      if (bar) {
        bar.innerHTML = "";
        var back = document.createElement("a");
        back.className = "chip is-on";
        back.href = "gallery.html";
        back.textContent = "← 全部作品";
        bar.appendChild(back);

        var tip = document.createElement("span");
        tip.className = "filter-note";
        tip.textContent = "只看 " + startAuthor + " 的作品";
        bar.appendChild(tip);
      }
      buildWall("", startAuthor);
      if (!document.querySelector("#wall figure")) {
        var wallEl = document.getElementById("wall");
        if (wallEl) {
          var empty = document.createElement("p");
          empty.className = "muted";
          empty.style.cssText = "grid-column:1/-1;padding:40px 0";
          empty.textContent = "这位成员的作品还没署名归档，暂时看不到。";
          wallEl.appendChild(empty);
        }
      }
      return;
    }

    /* 支持从首页带分类进入：gallery.html?cat=海岸风光 */
    var startCat = "";
    try {
      startCat = new URLSearchParams(location.search).get("cat") || "";
    } catch (e) {
      startCat = "";
    }

    var hasCat = startCat && CATS.indexOf(startCat) >= 0 &&
      window.PHOTOS.some(function (p) { return p.c === startCat; });

    if (hasCat) {
      var target = null;
      bar.querySelectorAll(".chip").forEach(function (c) {
        if (c.textContent === startCat) target = c;
      });
      if (target) {
        selectChip(target);
        buildWall(startCat);
      } else {
        buildWall("");
      }
    } else {
      buildWall("");
    }
  }

  /* ---------- 5b. 灯箱：所有 .wall 通用 ---------- */
  function initLightbox() {
    var lb = document.getElementById("lightbox");
    var lbImg = document.getElementById("lightbox-img");
    if (!lb || !lbImg) return;

    document.addEventListener("click", function (e) {
      var fig = e.target.closest ? e.target.closest(".wall figure") : null;
      if (!fig) return;
      var src = fig.getAttribute("data-src");
      if (!src) return;
      e.preventDefault();
      lbImg.src = src;
      var capEl = document.getElementById("lightbox-cap");
      if (capEl) {
        var cap = fig.querySelector("figcaption");
        capEl.textContent = cap ? cap.textContent : "";
      }
      lb.classList.add("is-open");
      document.body.style.overflow = "hidden";
    });

    function close() {
      lb.classList.remove("is-open");
      lbImg.src = "";
      document.body.style.overflow = "";
    }

    lb.addEventListener("click", function (e) {
      if (e.target === lb || e.target.id === "lightbox-close") close();
    });

    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape") close();
    });
  }

  /* ---------- 5c. 首页作品墙 ---------- */
  function initHomeWall() {
    var wall = document.getElementById("home-wall");
    if (!wall || !window.PHOTOS) return;

    var picks = window.PHOTOS.filter(function (p) { return p.c !== ""; }).slice(0, 9);
    wall.innerHTML = "";

    picks.forEach(function (p) {
      var fig = document.createElement("figure");
      fig.setAttribute("data-src", "images/" + p.f);

      var img = document.createElement("img");
      img.loading = "lazy";
      img.decoding = "async";
      img.alt = p.t || "18N-MSPA 作品";
      img.src = "images/thumbs/" + p.f;
      img.addEventListener("load", function () { img.classList.add("is-loaded"); });
      img.addEventListener("error", function () {
        if (!img.dataset.tryFull) {
          img.dataset.tryFull = "1";
          img.src = "images/" + p.f;
          return;
        }
        img.remove();
        fig.style.minHeight = "220px";
        fig.style.background = "linear-gradient(135deg, rgba(79,179,232,.14), rgba(53,214,192,.06))";
      });

      fig.appendChild(img);
      if (p.t) {
        var cap = document.createElement("figcaption");
        cap.textContent = p.t;
        fig.appendChild(cap);
      }
      wall.appendChild(fig);
    });
  }

  /* ---------- 6. 成员页 ---------- */
  function siteBase() {
    var u = location.href.split("?")[0].split("#")[0];
    if (/^https?:/.test(u)) return u.replace(/members(\.html)?$/, "");
    return "https://hainan-n-mspa.pages.dev/";
  }

  function worksOf(name) {
    if (!window.PHOTOS || !name) return [];
    return window.PHOTOS.filter(function (p) { return p.a === name; });
  }

  function memberCard(m) {
    var works = worksOf(m.name);
    var el = document.createElement("article");
    el.className = "member glass reveal";
    el.id = "m-" + m.id;

    var head = document.createElement("div");
    head.className = "member-head";

    var name = document.createElement("div");
    name.className = "name silver";
    name.textContent = m.name;
    head.appendChild(name);

    if (m.titles && m.titles.length) {
      var tags = document.createElement("div");
      tags.className = "tags";
      m.titles.forEach(function (t) {
        var sp = document.createElement("span");
        sp.textContent = t;
        tags.appendChild(sp);
      });
      head.appendChild(tags);
    }
    el.appendChild(head);

    var strip = document.createElement("div");
    strip.className = "member-works";
    if (works.length) {
      works.slice(0, 4).forEach(function (w) {
        var fig = document.createElement("figure");
        var img = document.createElement("img");
        img.loading = "lazy";
        img.alt = w.t || "作品";
        img.src = "images/thumbs/" + w.f;
        img.addEventListener("error", function () {
          if (!img.dataset.tryFull) {
            img.dataset.tryFull = "1";
            img.src = "images/" + w.f;
            return;
          }
          img.remove();
        });
        fig.appendChild(img);
        strip.appendChild(fig);
      });
    } else {
      var ph = document.createElement("p");
      ph.className = "member-empty-works";
      ph.textContent = "作品待署名";
      strip.appendChild(ph);
    }
    el.appendChild(strip);

    var meta = document.createElement("div");
    meta.className = "member-meta";
    meta.textContent = works.length ? "已收录 " + works.length + " 张" : "暂无收录作品";
    el.appendChild(meta);

    var actions = document.createElement("div");
    actions.className = "member-actions";

    var link = document.createElement("a");
    link.className = "member-link";
    link.href = works.length
      ? "gallery.html?a=" + encodeURIComponent(m.name)
      : "gallery.html";
    link.textContent = works.length ? "看作品" : "去作品集";
    actions.appendChild(link);

    var btnCard = document.createElement("button");
    btnCard.type = "button";
    btnCard.className = "member-btn";
    btnCard.textContent = "名片";
    btnCard.addEventListener("click", function () { openCard(m); });
    actions.appendChild(btnCard);

    var btnTitle = document.createElement("button");
    btnTitle.type = "button";
    btnTitle.className = "member-btn";
    btnTitle.textContent = "＋头衔";
    btnTitle.addEventListener("click", function () { openTitle(m); });
    actions.appendChild(btnTitle);

    el.appendChild(actions);
    return el;
  }

  function initMembers() {
    var core = document.getElementById("grid-core");
    if (!core || !window.MEMBERS) return;

    window.MEMBERS.forEach(function (m) {
      var grid = document.getElementById("grid-" + (m.group === "community" ? "community" : "core"));
      if (grid) grid.appendChild(memberCard(m));
    });

    ["core", "community"].forEach(function (g) {
      var grid = document.getElementById("grid-" + g);
      if (grid && !grid.querySelector(".member")) {
        var p = document.createElement("p");
        p.className = "muted member-empty";
        p.textContent = "名单整理中，欢迎在群里认领。";
        grid.appendChild(p);
      }
    });

    /* 卡片是后插入的，要重新挂一次滚动淡入，否则一直是透明的 */
    initReveal();

    /* 从分享链接直接定位到某个人 */
    if (location.hash.indexOf("#m-") === 0) {
      var target = document.getElementById(location.hash.slice(1));
      if (target) setTimeout(function () {
        target.scrollIntoView({ behavior: "smooth", block: "center" });
        target.classList.add("is-hl");
      }, 500);
    }
  }

  /* ---------- 6b. 名片生成 ---------- */
  var cardFont = '"PingFang SC", "HarmonyOS Sans SC", "Microsoft YaHei", "Source Han Sans SC", sans-serif';

  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function drawQR(ctx, text, x, y, size) {
    var qr = qrcode(0, "M");
    qr.addData(text, "Byte");
    qr.make();
    var n = qr.getModuleCount();
    var quiet = 4;
    var cell = size / (n + quiet * 2);

    ctx.fillStyle = "#ffffff";
    roundRect(ctx, x, y, size, size, 18);
    ctx.fill();

    ctx.fillStyle = "#0f1114";
    for (var r = 0; r < n; r++) {
      for (var c = 0; c < n; c++) {
        if (qr.isDark(r, c)) {
          ctx.fillRect(
            x + (c + quiet) * cell,
            y + (r + quiet) * cell,
            Math.ceil(cell) + 0.4,
            Math.ceil(cell) + 0.4
          );
        }
      }
    }
  }

  function drawCard(m, shotImgs) {
    var cv = document.getElementById("card-canvas");
    if (!cv) return;
    var ctx = cv.getContext("2d");
    var W = cv.width, H = cv.height;
    var works = worksOf(m.name);
    var url = siteBase() + "members.html#m-" + m.id;

    ctx.clearRect(0, 0, W, H);

    var bg = ctx.createLinearGradient(0, 0, W, H);
    bg.addColorStop(0, "#0c0e11");
    bg.addColorStop(0.55, "#13161a");
    bg.addColorStop(1, "#0a0c0f");
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, W, H);

    var glow = ctx.createRadialGradient(W * 0.18, H * 0.12, 0, W * 0.18, H * 0.12, W * 0.85);
    glow.addColorStop(0, "rgba(79,179,232,0.20)");
    glow.addColorStop(1, "rgba(79,179,232,0)");
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, W, H);

    var glow2 = ctx.createRadialGradient(W * 0.92, H * 0.05, 0, W * 0.92, H * 0.05, W * 0.6);
    glow2.addColorStop(0, "rgba(53,214,192,0.14)");
    glow2.addColorStop(1, "rgba(53,214,192,0)");
    ctx.fillStyle = glow2;
    ctx.fillRect(0, 0, W, H);

    var pad = 84;

    ctx.textAlign = "left";
    ctx.fillStyle = "#8f979f";
    ctx.font = "600 26px " + cardFont;
    ctx.letterSpacing = "10px";
    ctx.fillText("18N-MSPA", pad, 132);
    ctx.letterSpacing = "0px";

    ctx.fillStyle = "#6d757c";
    ctx.font = "22px " + cardFont;
    ctx.fillText("北纬18度椰青摄联 · 海南", pad, 174);

    /* 名字 */
    ctx.fillStyle = "#ffffff";
    ctx.font = "700 82px " + cardFont;
    var nameY = 330;
    ctx.fillText(m.name, pad, nameY);

    /* 头衔 */
    var chipX = pad;
    var chipY = nameY + 42;
    var titles = (m.titles && m.titles.length) ? m.titles : [];
    if (titles.length) {
      ctx.font = "28px " + cardFont;
      titles.forEach(function (t) {
        var tw = ctx.measureText(t).width + 44;
        ctx.fillStyle = "rgba(79,179,232,0.16)";
        roundRect(ctx, chipX, chipY, tw, 54, 27);
        ctx.fill();
        ctx.strokeStyle = "rgba(79,179,232,0.45)";
        ctx.lineWidth = 1.5;
        roundRect(ctx, chipX, chipY, tw, 54, 27);
        ctx.stroke();
        ctx.fillStyle = "#a8d8f4";
        ctx.fillText(t, chipX + 22, chipY + 38);
        chipX += tw + 16;
      });
    } else {
      ctx.fillStyle = "#6d757c";
      ctx.font = "26px " + cardFont;
      ctx.fillText("摄影爱好者", chipX, chipY + 38);
    }

    /* 作品数 */
    ctx.fillStyle = "#c2c9cf";
    ctx.font = "28px " + cardFont;
    ctx.fillText(works.length ? "已收录作品 " + works.length + " 张" : "作品陆续收录中", pad, chipY + 102);

    /* 作品条：最多 3 张 */
    var stripY = 512;
    var stripH = 290;
    var gap = 16;
    var full = W - pad * 2;
    var shots = shotImgs || [];

    if (shots.length) {
      var n = Math.min(shots.length, 3);
      var sw = (full - gap * (n - 1)) / n;
      for (var i = 0; i < n; i++) {
        var sx = pad + i * (sw + gap);
        ctx.save();
        roundRect(ctx, sx, stripY, sw, stripH, 14);
        ctx.clip();
        ctx.drawImage(shots[i], sx, stripY, sw, stripH);
        ctx.restore();
      }
    } else if (window.__logo) {
      var lw = 240;
      ctx.save();
      ctx.globalAlpha = 0.22;
      ctx.drawImage(window.__logo, (W - lw) / 2, stripY + 30, lw, lw);
      ctx.restore();
    }

    /* 分隔线 */
    var lineY = 856;
    var line = ctx.createLinearGradient(pad, 0, W - pad, 0);
    line.addColorStop(0, "rgba(79,179,232,0.55)");
    line.addColorStop(1, "rgba(53,214,192,0.06)");
    ctx.fillStyle = line;
    ctx.fillRect(pad, lineY, W - pad * 2, 1.5);

    /* 两个二维码 */
    var qrSize = 250;
    var qrY = 900;
    var leftX = pad;
    var rightX = W - pad - qrSize;

    drawQR(ctx, url, leftX, qrY, qrSize);

    if (window.__wxQR) {
      ctx.save();
      roundRect(ctx, rightX, qrY, qrSize, qrSize, 18);
      ctx.clip();
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(rightX, qrY, qrSize, qrSize);
      ctx.drawImage(window.__wxQR, rightX, qrY, qrSize, qrSize);
      ctx.restore();
    } else {
      ctx.fillStyle = "#ffffff";
      roundRect(ctx, rightX, qrY, qrSize, qrSize, 18);
      ctx.fill();
      ctx.fillStyle = "#8f979f";
      ctx.font = "24px " + cardFont;
      ctx.textAlign = "center";
      ctx.fillText("公众号二维码", rightX + qrSize / 2, qrY + qrSize / 2);
      ctx.textAlign = "left";
    }

    ctx.fillStyle = "#8f979f";
    ctx.font = "24px " + cardFont;
    ctx.fillText("扫码看我的主页", leftX, qrY + qrSize + 46);
    ctx.textAlign = "right";
    ctx.fillText("扫码关注公众号", rightX + qrSize, qrY + qrSize + 46);
    ctx.textAlign = "left";

    /* 底部 */
    ctx.strokeStyle = "rgba(255,255,255,0.10)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(pad, H - 128);
    ctx.lineTo(W - pad, H - 128);
    ctx.stroke();

    ctx.fillStyle = "#6d757c";
    ctx.font = "22px " + cardFont;
    ctx.fillText("hainan-n-mspa.pages.dev", pad, H - 78);

    ctx.textAlign = "right";
    ctx.fillText("18°N · HAINAN", W - pad, H - 78);
    ctx.textAlign = "left";
  }

  function openCard(m) {
    var modal = document.getElementById("card-modal");
    if (!modal) return;

    var cv = document.getElementById("card-canvas");
    modal.classList.add("is-open");
    document.body.style.overflow = "hidden";

    var works = worksOf(m.name).slice(0, 3);
    var shots = [];
    var pending = 0;
    var ready = false;

    var finish = function () {
      if (ready) return;
      ready = true;
      drawCard(m, shots);
      modal.dataset.member = m.id;
      modal.dataset.url = siteBase() + "members.html#m-" + m.id;
    };

    function track() {
      pending++;
      return function () {
        pending--;
        if (pending === 0) finish();
      };
    }

    /* 公众号二维码 */
    if (!window.__wxQR) {
      var d1 = track();
      var wx = new Image();
      wx.onload = function () { window.__wxQR = wx; d1(); };
      wx.onerror = function () { d1(); };
      wx.src = "images/二维码.jpg";
    }

    /* logo 水印 */
    if (!window.__logo) {
      var d2 = track();
      var lg = new Image();
      lg.onload = function () { window.__logo = lg; d2(); };
      lg.onerror = function () { d2(); };
      lg.src = "images/mspa透明底.png";
    }

    /* 作品缩略图 */
    if (works.length) {
      works.forEach(function (w) {
        var d = track();
        var im = new Image();
        im.onload = function () { shots.push(im); d(); };
        im.onerror = function () { d(); };
        im.src = "images/thumbs/" + w.f;
      });
    }

    if (pending === 0) finish();

    var dl = document.getElementById("card-download");
    dl.onclick = function () {
      cv.toBlob(function (blob) {
        if (!blob) return;
        var a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = m.name + "-18N-MSPA名片.png";
        document.body.appendChild(a);
        a.click();
        setTimeout(function () {
          URL.revokeObjectURL(a.href);
          a.remove();
        }, 1500);
      }, "image/png");
    };

    var sh = document.getElementById("card-share");
    sh.onclick = function () {
      copyTextToClipboard(modal.dataset.url || "");
      toastMsg("主页链接已复制");
    };
  }

  function toastMsg(text) {
    var t = document.getElementById("site-toast");
    if (!t) {
      t = document.createElement("div");
      t.id = "site-toast";
      t.className = "site-toast";
      document.body.appendChild(t);
    }
    t.textContent = text;
    t.classList.add("is-show");
    clearTimeout(t._tm);
    t._tm = setTimeout(function () { t.classList.remove("is-show"); }, 2200);
  }

  function copyTextToClipboard(text) {
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text);
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
      ta.remove();
    } catch (e) { /* 忽略 */ }
  }

  /* ---------- 6c. 申请头衔 ---------- */
  function openTitle(m) {
    var modal = document.getElementById("title-modal");
    if (!modal) return;
    modal.classList.add("is-open");
    document.body.style.overflow = "hidden";
    document.getElementById("title-sub").textContent =
      m.name + " · 现在的头衔：" + ((m.titles && m.titles.length) ? m.titles.join(" / ") : "还没有");
    document.getElementById("title-input").value = "";
    modal.dataset.member = m.id;

    document.getElementById("title-copy").onclick = function () {
      var raw = (document.getElementById("title-input").value || "").trim();
      if (!raw) { toastMsg("先写一个头衔"); return; }
      var list = raw.split(/[\/,，、\s]+/).filter(Boolean).slice(0, 4);
      var line = '{ id: "' + m.id + '", name: "' + m.name + '", group: "' + m.group +
                 '", titles: ["' + list.join('", "') + '"] },';
      copyTextToClipboard(line);
      toastMsg("已复制，发给管理员即可");
      closeModals();
    };
  }

  function closeModals() {
    document.querySelectorAll(".card-modal.is-open").forEach(function (n) {
      n.classList.remove("is-open");
    });
    document.body.style.overflow = "";
  }

  function initMemberModals() {
    var modal = document.getElementById("card-modal");
    if (!modal) return;

    document.querySelectorAll(".card-modal").forEach(function (n) {
      n.addEventListener("click", function (e) {
        if (e.target === n) closeModals();
      });
    });

    ["card-close", "title-close"].forEach(function (id) {
      var b = document.getElementById(id);
      if (b) b.addEventListener("click", closeModals);
    });

    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape") closeModals();
    });
  }

  /* ---------- 启动 ---------- */
  document.addEventListener("DOMContentLoaded", function () {
    initNav();
    initActive();
    initHero();
    initLogos();
    initReveal();
    initGallery();
    initLightbox();
    initHomeWall();
    initMembers();
    initMemberModals();
  });
})();

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

  function buildWall(filter) {
    var wall = document.getElementById("wall");
    if (!wall || !window.PHOTOS) return;

    var list = window.PHOTOS.filter(function (p) {
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
  });
})();

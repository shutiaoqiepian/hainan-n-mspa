<script setup lang="ts">
import { computed } from 'vue'
import PhotoWall from '@/components/PhotoWall.vue'
import { HERO_IMAGE, PHOTOS } from '@/data/photos'

/** 首页（对应旧版 index.html + initHomeWall） */

const heroSrc = 'images/' + HERO_IMAGE

/* 首屏大图三档尺寸，浏览器按屏幕宽度自己挑：
   手机拿 1000w（119 KB）、平板/小笔记本拿 1400w（194 KB）、大屏仍用原图（459 KB）。
   两档小图由 tools/make-hero-sizes.ps1 生成，换首屏照片后要重跑一次。 */
const heroSrcset =
  'images/hero-1000.jpg 1000w, images/hero-1400.jpg 1400w, ' + heroSrc + ' 2200w'

/** 精选作品：有分类的前 9 张 */
const picks = computed(() => PHOTOS.filter((p) => p.c !== '').slice(0, 9))

/** 首屏大图缺失时退回径向渐变底，避免露出裂图 */
function onHeroError(event: Event): void {
  const img = event.target as HTMLImageElement
  /* 小尺寸备份图可能没生成（换了首屏照片但忘了跑脚本）：
     先退回原图，原图也失败才隐藏。 */
  if (img.getAttribute('srcset')) {
    img.removeAttribute('srcset')
    img.removeAttribute('sizes')
    img.src = heroSrc
    return
  }
  img.style.display = 'none'
  const parent = img.parentNode as HTMLElement | null
  if (parent) {
    // 首屏图缺失时退回一层柔和渐变，跟着主题走（白主题别露出一块黑）
    parent.style.background =
      'radial-gradient(120% 90% at 70% 10%, var(--bg-3) 0%, var(--bg-2) 55%, var(--bg) 100%)'
  }
}
</script>

<template>
  <!-- ===== 首屏 ===== -->
  <section class="hero">
    <div class="hero-media">
      <img
        :src="heroSrc"
        :srcset="heroSrcset"
        sizes="100vw"
        alt="海口世纪大桥火烧云"
        fetchpriority="high"
        decoding="async"
        @error="onHeroError"
      />
    </div>

    <div class="wrap hero-body">
      <p class="eyebrow">18°N · HAINAN · SINCE 2024</p>
      <h1 class="silver">未来，<br />我们于此刻以影像开启</h1>
      <p class="lead">
        海南省北纬18度椰青摄影联盟，海南最大的青年摄影师交流组织。<br />
        从海岸线的第一缕晨光，到骑楼老街的最后一盏灯笼 —— 我们拍脚下的这座岛。
      </p>
      <div class="hero-actions">
        <a class="btn btn-primary" href="gallery.html">看作品</a>
        <a class="btn btn-on-photo" href="forecast.html">霞光预报</a>
        <a class="btn btn-on-photo" href="join.html">加入我们</a>
      </div>
    </div>

    <div class="hero-meta">SCROLL</div>
  </section>

  <!-- ===== 我们是谁 ===== -->
  <section class="section">
    <div class="wrap">
      <div class="section-head reveal">
        <p class="eyebrow">About Us</p>
        <h2 class="silver">一群生活在海南的人<br />拍自己脚下的地方</h2>
        <p>
          北纬18度，是海南岛南端所在的纬线；18岁稍后，正是人生最好的时候。
          青春有热爱，才更具色彩。
        </p>
      </div>

      <div class="grid-3">
        <article class="card glass reveal" data-delay="0">
          <span class="idx">01</span>
          <h3>海南最大的<br />青年摄影师交流组织</h3>
          <p>成员以海南为主，也有散落在北京、上海、广州、深圳、香港、西安、重庆、长沙的伙伴。</p>
        </article>

        <article class="card glass reveal" data-delay="90">
          <span class="idx">02</span>
          <h3>从风光到人文<br />都拍</h3>
          <p>海岸日出日落、城市夜色爬楼、公期军坡民俗、银河与流星、航拍视角 —— 什么都愿意拍。</p>
        </article>

        <article class="card glass reveal" data-delay="180">
          <span class="idx">03</span>
          <h3>不是比赛<br />是同行</h3>
          <p>一起蹲机位、一起等天气、一起翻车、一起出片。这里更像一个愿意陪你熬夜的群。</p>
        </article>
      </div>
    </div>
  </section>

  <!-- ===== 数字 ===== -->
  <section class="section" style="padding-top:0">
    <div class="wrap">
      <div class="stats reveal">
        <div><strong class="grad">2</strong><span>年</span></div>
        <div><strong class="grad">5</strong><span>大作品方向</span></div>
        <div><strong class="grad">30+</strong><span>核心成员</span></div>
        <div><strong class="grad">∞</strong><span>次按下快门</span></div>
      </div>
    </div>
  </section>

  <!-- ===== 引言 ===== -->
  <section class="section" style="padding-top:0">
    <div class="wrap">
      <div class="quote glass reveal">
        <blockquote class="silver">
          「也许有某一个时刻，为了转瞬即逝的七彩祥云，<br />
          而不停蹄地奔向机位。」
        </blockquote>
        <cite>— 18N-MSPA</cite>
      </div>
    </div>
  </section>

  <!-- ===== 精选作品 ===== -->
  <section class="section" style="padding-top:0">
    <div class="wrap">
      <div class="section-head reveal">
        <p class="eyebrow">Selected Works</p>
        <h2 class="silver">部分成员作品</h2>
        <p>更多作品在作品集里。</p>
      </div>

      <div id="home-wall" class="wall">
        <PhotoWall :photos="picks" variant="home" />
      </div>

      <div class="reveal" style="margin-top:38px;text-align:center">
        <a class="btn btn-ghost" href="gallery.html">查看全部作品 →</a>
      </div>
    </div>
  </section>

  <!-- ===== 两个入口：霞光预报 / 成员与社群 =====
       原来这里只有一块「霞光预报」和一块「加入我们」，都是全宽玻璃卡片；
       成员/社群只在导航里，首页完全没有入口。改成两张等高的入口卡并排，
       左边预报、右边成员，下面再接「加入我们」的 CTA 条。 -->
  <section class="section" style="padding-top:0">
    <div class="wrap">
      <div class="home-entries">
        <article class="home-entry glass reveal">
          <p class="eyebrow">Sunset Forecast</p>
          <h2 class="silver">这两天，哪里值得跑一趟</h2>
          <p class="home-entry-p">
            根据云层高度、气溶胶与降水，估算各机位的朝霞与晚霞条件 ——
            目前覆盖海南 25 个机位、广东 40 个机位，东岸拍日出、西岸拍日落，一处看完。
          </p>
          <a class="btn btn-primary home-entry-btn" href="forecast.html">查看霞光预报</a>
        </article>

        <article class="home-entry glass reveal" data-delay="90">
          <p class="eyebrow">Members &amp; Community</p>
          <h2 class="silver">谁在拍这座岛</h2>
          <p class="home-entry-p">
            小组成员日常一起蹲机位、一起维护这个站；交流群里还有散在北京、上海、广州、香港的伙伴。
            每张成员卡都能生成带二维码的名片。
          </p>
          <a class="btn btn-ghost home-entry-btn" href="members.html">看看成员名单</a>
        </article>
      </div>

      <div class="home-join glass reveal">
        <div>
          <p class="eyebrow">Join Us</p>
          <h2 class="silver">欢迎你认识我们，加入我们</h2>
          <p class="muted home-join-p">今天开始，我们很渴望能同你一起，分享这份热爱。</p>
        </div>
        <a class="btn btn-primary" href="join.html">了解加入方式</a>
      </div>
    </div>
  </section>
</template>

<script setup lang="ts">
import { ws } from '@/composables/useWhitespace'
/** 关于我们（对应旧版 about.html 的 <main> 内容，纯静态排版） */


</script>

<template>
<section class="page-head">
  <div class="wrap">
    <p class="eyebrow">About</p>
    <h1 class="silver">我们是谁</h1>
    <p>{{ ws(8) }}海南省北纬18度椰青摄影联盟，海南最大的青年摄影师交流组织。{{ ws(8) }}我们用影像记录此刻，开启未来。{{ ws(6) }}</p>
  </div>
</section>
<section class="section">
  <div class="wrap">
    <div class="two-col">
      <div class="prose reveal">
        <h3 class="silver" style="margin-top:0">关于取名</h3>
        <p>{{ ws(12) }}首先是<b>北纬18度</b>。海南岛最南端就在北纬18度线上。{{ ws(12) }}这条纬线穿过岛屿，也穿过这里的每一片海。{{ ws(10) }}</p>
        <p>{{ ws(12) }}其次是<b>18岁</b>。18岁稍后，正是人生最好的时候。{{ ws(12) }}青春有热爱，才更具色彩。{{ ws(10) }}</p>
        <p>{{ ws(12) }}<b>椰青</b>是海南最日常的东西 —— 不算精致，但解渴、真诚、满地都是。{{ ws(12) }}我们喜欢这个意象。{{ ws(10) }}</p>
        <h3>我们在做什么</h3>
        <p>{{ ws(12) }}一起蹲机位、一起等天气。凌晨三点起床去追一场朝霞，{{ ws(12) }}或者为了台风外围的云，跑到海边吹一整晚的风。{{ ws(10) }}</p>
        <p>{{ ws(12) }}我们拍海岸的日出日落，也拍城市的夜色与灯火；{{ ws(12) }}拍银河和流星，也拍骑楼老街上的年俗与公期的锣鼓。{{ ws(10) }}</p>
        <h3>我们的名字缩写</h3>
        <p>{{ ws(12) }}<b>18N-MSPA</b>，即 18° North — Hainan <i>M</i>ass <i>S</i>tudent / <i>S</i>enior{{ ws(12) }}<i>P</i>hotographers <i>A</i>ssociation。{{ ws(12) }}这个缩写随 logo 一起，出现在每一件作品上。{{ ws(10) }}</p>
      </div>
      <div class="reveal" data-delay="120">
        <div class="glass" style="padding:40px 32px;text-align:center">
          <img class="about-logo" src="images/mspa透明底.png" alt="18N-MSPA logo" style="aspect-ratio:1402/1402" />
          <p class="muted" style="margin:0;font-size:14px;line-height:1.9">{{ ws(14) }}相机与椰树<br />是海南与影像最直接的相遇{{ ws(12) }}</p>
        </div>
        <div class="glass" style="padding:32px;margin-top:18px">
          <p class="eyebrow" style="margin-bottom:14px">定位</p>
          <p style="margin:0;font-size:15px;line-height:1.9;color:#c2c9cf">{{ ws(14) }}成员以海南为主，覆盖中学生到大学生，同时也有散落在{{ ws(14) }}北京、上海、广州、深圳、香港、西安、重庆、长沙等地的伙伴。{{ ws(14) }}无论在哪，拍的都是同一件事 —— 此刻。{{ ws(12) }}</p>
        </div>
      </div>
    </div>
  </div>
</section>
<section class="section" style="padding-top:0">
  <div class="wrap">
    <div class="section-head reveal">
      <p class="eyebrow">Thanks</p>
      <h2 class="silver">鸣谢</h2>
      <p>一路同行，感谢这些伙伴。</p>
    </div>
    <div class="grid-3">
      <div class="card glass reveal" data-delay="0">
        <h3 style="margin-top:0">高校与联盟</h3>
        <p>海南高校摄影联盟<br />北京风光摄影联盟</p>
      </div>
      <div class="card glass reveal" data-delay="90">
        <h3 style="margin-top:0">社团与部落</h3>
        <p>寰宇追光部落<br />海口四中森蓝摄影社<br />海南侨中摄氏度摄影社</p>
      </div>
      <div class="card glass reveal" data-delay="180">
        <h3 style="margin-top:0">个人伙伴</h3>
        <p>yms<br />ted 倾斜的地平线</p>
      </div>
    </div>
  </div>
</section>
<section class="section" style="padding-top:0">
  <div class="wrap">
    <div class="quote glass reveal">
      <blockquote class="silver">{{ ws(10) }}「当按下快门的那一刻，时间就停在了这里。<br />{{ ws(10) }}影像的意义，在于把尽兴的瞬间变成一个永恒。」{{ ws(8) }}</blockquote>
      <cite>— 18N-MSPA</cite>
    </div>
  </div>
</section>
</template>

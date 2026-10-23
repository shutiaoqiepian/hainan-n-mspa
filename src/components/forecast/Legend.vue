<script setup lang="ts">
/** 等级图例：六档颜色与分数阈值，纯静态（对应旧版 .fc-legend） */
</script>

<template>
  <div class="fc-legend-wrap">
    <div class="fc-legend">
      <span><i style="background:#ff6a3d"></i>火烧云 92+</span>
      <span><i style="background:#ff9640"></i>大烧 82–91</span>
      <span><i style="background:#ffd166"></i>中烧 66–81</span>
      <span><i style="background:#9ad9b8"></i>小烧 48–65</span>
      <span><i style="background:#8f979f"></i>微烧 30–47</span>
      <span><i style="background:#5b636a"></i>不烧 &lt;30</span>
    </div>
    <p class="fc-legend-note">
      <b>本站口径</b>：上面是本站自己的 0–96 分制，不是任何一家的官方分级。
      SunsetBot 用 0–2.5 的“鲜艳度”，莉景天气、Windy 又各有阈值，
      「大烧」这个词在每家对应的数字都不一样 —— 拿去和别人对比时，先看是不是同一套口径。
    </p>
  </div>
</template>

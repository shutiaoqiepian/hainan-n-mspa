<script setup lang="ts">
import { ws } from '@/composables/useWhitespace'
/** 404（对应旧版 404.html 的 <main> 内容） */


</script>

<template>
<section class="hero" style="min-height:calc(100vh - 68px)">
  <div class="hero-media">
    <img src="images/og-cover.jpg" alt="" />
  </div>
  <div class="wrap hero-body">
    <p class="eyebrow">404 · NOT FOUND</p>
    <h1 class="silver">这个机位，<br />今天没有云</h1>
    <p class="lead">{{ ws(8) }}你要找的页面不存在，或者已经被移走了。<br />{{ ws(8) }}换个方向，说不定能等到一场火烧云。{{ ws(6) }}</p>
    <div class="hero-actions">
      <a class="btn btn-primary" href="index.html">回首页</a>
      <a class="btn btn-accent" href="forecast.html">看霞光预报</a>
      <a class="btn btn-ghost" href="gallery.html">看作品</a>
    </div>
  </div>
</section>
</template>

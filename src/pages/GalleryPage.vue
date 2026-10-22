<script setup lang="ts">
import { computed, ref } from 'vue'
import PhotoWall from '@/components/PhotoWall.vue'
import { CATEGORIES, PHOTOS, worksOf } from '@/data/photos'

/** 作品集（对应旧版 gallery.html + initGallery/buildWall） */

/** 从成员页进来：gallery.html?a=作者名 */
function readAuthor(): string {
  try {
    return (new URLSearchParams(location.search).get('a') || '').trim()
  } catch (e) {
    return ''
  }
}

/** 支持从首页带分类进入：gallery.html?cat=海岸风光 */
function readCat(): string {
  try {
    return new URLSearchParams(location.search).get('cat') || ''
  } catch (e) {
    return ''
  }
}

const startAuthor = readAuthor()

/* ?a= 优先：有作者就不再处理分类 */
const startCat = startAuthor ? '' : readCat()

const hasCat =
  startCat !== '' &&
  (CATEGORIES as readonly string[]).indexOf(startCat) >= 0 &&
  PHOTOS.some((p) => p.c === startCat)

/** 当前选中的分类，空串代表「全部」 */
const activeCat = ref<string>(hasCat ? startCat : '')

/** 分类按钮：只出现确实有作品的分类 */
const usedCategories = CATEGORIES.filter((c) => PHOTOS.some((p) => p.c === c))

const photos = computed(() => {
  if (startAuthor) return worksOf(startAuthor)
  if (!activeCat.value) return PHOTOS
  return PHOTOS.filter((p) => p.c === activeCat.value)
})
</script>

<template>
  <!-- ===== 页头 ===== -->
  <section class="page-head">
    <div class="wrap">
      <p class="eyebrow">Gallery</p>
      <h1 class="silver">作品集</h1>
      <p>部分成员作品，点击任意一张可看大图。</p>
    </div>
  </section>

  <!-- ===== 筛选 + 作品墙 ===== -->
  <section class="section" style="padding-top:56px">
    <div class="wrap">
      <div class="filter-bar" id="filters">
        <template v-if="startAuthor">
          <a class="chip is-on" href="gallery.html">← 全部作品</a>
          <span class="filter-note">只看 {{ startAuthor }} 的作品</span>
        </template>
        <template v-else>
          <button
            :class="['chip', { 'is-on': activeCat === '' }]"
            @click="activeCat = ''"
          >全部</button>
          <button
            v-for="cat in usedCategories"
            :key="cat"
            :class="['chip', { 'is-on': activeCat === cat }]"
            @click="activeCat = cat"
          >{{ cat }}</button>
        </template>
      </div>

      <div class="wall" id="wall">
        <PhotoWall :photos="photos" />
        <p
          v-if="startAuthor && !photos.length"
          class="muted"
          style="grid-column:1/-1;padding:40px 0"
        >这位成员的作品还没署名归档，暂时看不到。</p>
      </div>
    </div>
  </section>
</template>

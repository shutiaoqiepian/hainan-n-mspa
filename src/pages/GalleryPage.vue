<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import PhotoWall from '@/components/PhotoWall.vue'
import { openLightbox, useLightbox } from '@/composables/useLightbox'
import { CATEGORIES, PHOTOS, worksOf, type Photo } from '@/data/photos'

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

/** 单张深链接：gallery.html?p=文件名，打开就停在那一张上 */
function readPhoto(): string {
  try {
    return (new URLSearchParams(location.search).get('p') || '').trim()
  } catch (e) {
    return ''
  }
}

const startAuthor = readAuthor()

/* ?p= 最优先：链接指向具体一张时，先把所有作品放出来，翻页才有前后张。
   关掉灯箱后 pinned 清空，页面回到正常的分类浏览（否则筛选按钮一直是隐藏的）。 */
const pinnedKey = ref(readPhoto())
const pinned = computed(() =>
  pinnedKey.value ? PHOTOS.find((p) => p.f === pinnedKey.value) : undefined
)

/* ?a= 优先于分类：有作者就不再处理分类 */
const startCat = startAuthor && !pinned.value ? readCat() : ''

const hasCat =
  startCat !== '' &&
  (CATEGORIES as readonly string[]).indexOf(startCat) >= 0 &&
  PHOTOS.some((p) => p.c === startCat)

/** 当前选中的分类，空串代表「全部」 */
const activeCat = ref<string>(hasCat ? startCat : '')

/** 分类按钮：只出现确实有作品的分类 */
const usedCategories = CATEGORIES.filter((c) => PHOTOS.some((p) => p.c === c))

const photos = computed(() => {
  if (pinned.value) return PHOTOS
  if (startAuthor) return worksOf(startAuthor)
  if (!activeCat.value) return PHOTOS
  return PHOTOS.filter((p) => p.c === activeCat.value)
})

/** 图注口径与 PhotoFigure 一致，深链接打开时不会和缩略图上的文字对不上 */
function captionOf(photo: Photo): string {
  return photo.t + (photo.a ? ' · ' + photo.a : '')
}

function toItem(photo: Photo) {
  return { src: 'images/' + photo.f, caption: captionOf(photo), key: photo.f }
}

const { state: lightbox } = useLightbox()

/* 灯箱一关就松开「正在看某一张」，地址栏的 ?p= 由灯箱自己删 */
watch(
  () => lightbox.value.open,
  (open) => {
    if (!open) pinnedKey.value = ''
  }
)

onMounted(() => {
  const photo = pinned.value
  if (!photo) return
  /* 灯箱组件在本页之后挂载，这里只改状态；它挂载时会自己接管焦点 */
  openLightbox('images/' + photo.f, captionOf(photo), photo.f, PHOTOS.map(toItem))
})
</script>

<template>
  <!-- ===== 页头 ===== -->
  <section class="page-head">
    <div class="wrap">
      <p class="eyebrow">Gallery</p>
      <h1 class="silver">作品集</h1>
      <p>收录社内成员作品，目前以薯条切片的创作为主，点击任意一张可看大图。</p>
    </div>
  </section>

  <!-- ===== 筛选 + 作品墙 ===== -->
  <section class="section" style="padding-top:56px">
    <div class="wrap">
      <div class="filter-bar" id="filters">
        <template v-if="pinned">
          <a class="chip is-on" href="gallery.html">← 全部作品</a>
          <span class="filter-note">正在看：{{ captionOf(pinned) }}</span>
        </template>
        <template v-else-if="startAuthor">
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

      <div class="wall wall--gallery" id="wall">
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

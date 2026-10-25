<script setup lang="ts">
import { ref } from 'vue'
import type { Member } from '@/data/members'
import type { Photo } from '@/data/photos'
import { worksOf } from '@/data/photos'

/**
 * 一张成员卡（旧版 memberCard）：缩略图走 images/thumbs/，
 * 加载失败先退回原图，再失败就把 img 去掉，与旧版一致。
 */

const props = defineProps<{ member: Member }>()
const emit = defineEmits<{ card: [member: Member]; title: [member: Member] }>()

interface StripItem {
  photo: Photo
  /** thumb = 缩略图；full = 已退回原图；gone = 两次都失败，img 移除 */
  state: 'thumb' | 'full' | 'gone'
}

const works = worksOf(props.member.name)
const strip = ref<StripItem[]>(
  works.slice(0, 4).map((photo) => ({ photo, state: 'thumb' as const }))
)

function onImgError(item: StripItem): void {
  if (item.state === 'thumb') {
    item.state = 'full'
    return
  }
  item.state = 'gone'
}
</script>

<template>
  <article :id="'m-' + member.id" class="member glass reveal">
    <div class="member-head">
      <div class="name silver">{{ member.name }}</div>
      <div v-if="member.titles.length" class="tags">
        <span v-for="t in member.titles" :key="t">{{ t }}</span>
      </div>
    </div>

    <!-- 没有作品时不再画一个 62px 高的虚线空框：
         那块框会占掉整张卡最大的视觉重量，让人以为卡是空的。
         作品数和「待署名」的提示合并到下面一行 meta 里。 -->
    <div v-if="works.length" class="member-works">
      <figure v-for="item in strip" :key="item.photo.f">
        <img
          v-if="item.state !== 'gone'"
          :src="
            item.state === 'thumb' ? 'images/thumbs/' + item.photo.f : 'images/' + item.photo.f
          "
          loading="lazy"
          :alt="item.photo.t || '作品'"
          @error="onImgError(item)"
        />
      </figure>
    </div>

    <div class="member-meta" :class="{ 'is-empty': !works.length }">
      {{ works.length ? '已收录 ' + works.length + ' 张' : '作品待署名 · 暂无收录' }}
    </div>

    <div class="member-actions">
      <a
        class="member-link"
        :href="works.length ? 'gallery.html?a=' + encodeURIComponent(member.name) : 'gallery.html'"
        >{{ works.length ? '看作品' : '去作品集' }}</a
      >
      <button type="button" class="member-btn" @click="emit('card', member)">名片</button>
      <button type="button" class="member-btn" @click="emit('title', member)">＋头衔</button>
    </div>
  </article>
</template>

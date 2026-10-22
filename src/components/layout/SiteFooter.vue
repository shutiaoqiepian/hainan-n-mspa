<script setup lang="ts">
import { BRAND, COPYRIGHT, FOOTER_LINKS, FOOTER_LOCATION } from '@/data/site'

/** 全站页脚：七个页面原来各写一份，只有版权行不同 */
withDefaults(defineProps<{ copyright?: string }>(), { copyright: COPYRIGHT })

/**
 * logo 自动兜底（旧版 initLogos）：依次尝试几个可能的文件名，都不存在才隐藏
 */
const LOGO_TRIES = ['images/mspa透明底.png', 'images/nmspa.png', 'images/mspa.png', 'images/logo.png']
let logoIndex = 1

function onLogoError(event: Event): void {
  const img = event.target as HTMLImageElement
  if (logoIndex < LOGO_TRIES.length) {
    img.src = LOGO_TRIES[logoIndex]
    logoIndex++
    return
  }
  img.style.display = 'none'
}
</script>

<template>
  <footer class="footer">
    <div class="wrap">
      <div class="row">
        <div>
          <img class="logo" :src="BRAND.logo" :alt="BRAND.logoAlt" @error="onLogoError" />
        </div>
        <div class="links">
          <a v-for="link in FOOTER_LINKS" :key="link.href" :href="link.href">{{ link.label }}</a>
        </div>
      </div>
      <div class="copy">
        <span>{{ copyright }}</span>
        <span>{{ FOOTER_LOCATION }}</span>
      </div>
    </div>
  </footer>
</template>

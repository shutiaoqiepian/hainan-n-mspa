<script setup lang="ts">
import { ref } from 'vue'
import ThemeSwitch from './ThemeSwitch.vue'
import { BRAND, NAV_ITEMS, currentNavKey } from '@/data/site'

/**
 * 全站导航（旧版 initNav + initActive）
 * 手机端点 ☰ 展开、点链接收起；当前页按路径归一后高亮。
 */

const open = ref(false)
const activeKey = currentNavKey()

function toggle(): void {
  open.value = !open.value
}

function onListClick(): void {
  open.value = false
}
</script>

<template>
  <header class="nav">
    <div class="wrap">
      <a class="brand" href="index.html">
        <span class="logo-mark"><img :src="BRAND.logo" alt="" /></span>
        <span class="mark silver">{{ BRAND.latin }}</span>
        <span class="cn">{{ BRAND.cn }}</span>
      </a>
      <nav>
        <ul :class="{ 'is-open': open }" @click="onListClick">
          <li v-for="item in NAV_ITEMS" :key="item.key">
            <a
              :href="item.href"
              :class="{ 'is-active': activeKey === item.key }"
              :aria-current="activeKey === item.key ? 'page' : undefined"
            >{{ item.label }}</a>
          </li>
        </ul>
      </nav>
      <div class="nav-right">
        <ThemeSwitch />
        <button
          class="nav-toggle"
          aria-label="打开菜单"
          :aria-expanded="open ? 'true' : 'false'"
          @click="toggle"
        >{{ open ? '✕' : '☰' }}</button>
      </div>
    </div>
  </header>
</template>

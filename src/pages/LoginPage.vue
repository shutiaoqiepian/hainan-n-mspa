<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { toast } from '@/composables/useToast'
import { isLaunchEnabled } from '@/lib/auth/config'
import { signIn } from '@/lib/auth/session'

/**
 * 登录页（预留）
 * ------------------------------------------------------------
 * 现在还没有后端：账号密码不校验、不发请求，提交后直接提示
 * 「登录功能尚未开放」。等以后要做真正的登录时，只需要把
 * `signIn` 换成真实接口，页面其余部分不用动。
 */

const account = ref('')
const password = ref('')
const showPassword = ref(false)
const submitting = ref(false)
const enabled = isLaunchEnabled()

const canSubmit = computed(
  () => account.value.trim().length > 0 && password.value.length > 0 && !submitting.value
)

function onSubmit(): void {
  if (!canSubmit.value) return
  submitting.value = true

  signIn(account.value.trim(), password.value)
    .then((r) => toast(r.message, { variant: 'forecast' }))
    .finally(() => { submitting.value = false })

  /* 预留阶段不保留密码，避免留在内存里 */
  password.value = ''
}

onMounted(() => {
  document.title = '登录 · 北纬18度椰青摄联'
})
</script>

<template>
  <section class="page-head login-head">
    <div class="wrap">
      <p class="eyebrow">Account · 预留</p>
      <h1 class="silver">登录</h1>
      <p>这里是给以后用的入口，现在还没有开通账号系统。</p>
    </div>
  </section>

  <section class="section" style="padding-top:32px">
    <div class="wrap login-wrap">
      <form class="login-card glass" novalidate @submit.prevent="onSubmit">
        <p v-if="!enabled" class="login-notice">
          <b>功能尚未开放。</b>
          这个页面是为以后准备的：等社团有了自己的账号系统，成员就能在这里登录，
          自助上传照片、提交身份头衔、查看自己的作品墙。
          现在填了也不会生效，请不要输入你在别处的真实密码。
        </p>

        <label class="login-field">
          <span>账号或邮箱</span>
          <input
            v-model="account"
            type="text"
            autocomplete="username"
            inputmode="email"
            placeholder="例如 18n-mspa@example.com"
            :disabled="!enabled"
          />
        </label>

        <label class="login-field">
          <span>密码</span>
          <span class="login-pw">
            <input
              v-model="password"
              :type="showPassword ? 'text' : 'password'"
              autocomplete="current-password"
              placeholder="••••••••"
              :disabled="!enabled"
            />
            <button
              class="login-eye"
              type="button"
              :aria-label="showPassword ? '隐藏密码' : '显示密码'"
              :disabled="!enabled"
              @click="showPassword = !showPassword"
            >{{ showPassword ? '隐藏' : '显示' }}</button>
          </span>
        </label>

        <div class="login-row">
          <label class="login-remember">
            <input type="checkbox" :disabled="!enabled" />
            <span>记住我（7 天）</span>
          </label>
          <a class="login-link" href="join.html">忘了密码？先加入社团</a>
        </div>

        <button class="btn btn-primary login-submit" type="submit" :disabled="!enabled || !canSubmit">
          {{ enabled ? '登录' : '登录功能尚未开放' }}
        </button>

        <p class="login-alt">
          还不想注册？<a href="members.html">先看看成员和作品</a>，或者
          <a href="forecast.html">查一下今天的霞光预报</a>。
        </p>
      </form>

      <aside class="login-side">
        <h3>以后这里能做什么</h3>
        <ul>
          <li><b>自助上传作品</b>——不用每次都找管理员加图。</li>
          <li><b>提交身份头衔</b>——自己写一句简介，管理员审核后显示在成员卡片上。</li>
          <li><b>我的作品墙</b>——只看自己拍的那些，方便整理与分享。</li>
          <li><b>回填实拍结果</b>——登录后自动记住你反馈过的机位，帮算法校准。</li>
        </ul>
        <p class="login-side-note">
          这些功能都需要一个「后端」（能存账号、能做校验的服务器），
          本站现在还是纯静态站点，所以登录先空着占位。
          真要做时的方案对比写在 <code>交接文档.md</code> 的「登录预留」一节。
        </p>
      </aside>
    </div>
  </section>
</template>

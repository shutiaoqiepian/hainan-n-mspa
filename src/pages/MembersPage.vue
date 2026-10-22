<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import MemberCard from '@/components/members/MemberCard.vue'
import NameCardModal from '@/components/members/NameCardModal.vue'
import TitleRequestModal from '@/components/members/TitleRequestModal.vue'
import { MEMBERS, type Member } from '@/data/members'

/** 两个弹窗的当前成员；null 表示关闭（旧版 closeModals） */
const cardMember = ref<Member | null>(null)
const titleMember = ref<Member | null>(null)

/** 分组：group 为 community 的进交流群网格，其余都进小组成员网格（同旧版） */
const coreMembers = computed(() => MEMBERS.filter((m) => m.group !== 'community'))
const communityMembers = computed(() => MEMBERS.filter((m) => m.group === 'community'))

function openCard(m: Member): void {
  cardMember.value = m
  document.body.style.overflow = 'hidden'
}

function openTitle(m: Member): void {
  titleMember.value = m
  document.body.style.overflow = 'hidden'
}

function closeModals(): void {
  cardMember.value = null
  titleMember.value = null
  document.body.style.overflow = ''
}

function onKeydown(e: KeyboardEvent): void {
  if (e.key === 'Escape') closeModals()
}

onMounted(() => {
  document.addEventListener('keydown', onKeydown)

  /* 从分享链接直接定位到某个人（旧版延迟 500ms 再滚动并高亮） */
  if (location.hash.indexOf('#m-') === 0) {
    const target = document.getElementById(location.hash.slice(1))
    if (target)
      window.setTimeout(() => {
        target.scrollIntoView({ behavior: 'smooth', block: 'center' })
        target.classList.add('is-hl')
      }, 500)
  }
})

onBeforeUnmount(() => {
  document.removeEventListener('keydown', onKeydown)
})
</script>

<template>
  <section class="page-head">
    <div class="wrap">
      <p class="eyebrow">Members</p>
      <h1 class="silver">成员</h1>
      <p>小组成员与交流群成员。排名不分先后，每一位都在按下快门。</p>
    </div>
  </section>

  <section class="section" style="padding-top:56px">
    <div class="wrap">
      <div class="section-head reveal" style="margin-bottom:34px">
        <p class="eyebrow">Core Team</p>
        <h2 class="silver">小组成员</h2>
        <p id="core-note">这些是日常一起蹲机位、一起维护这个站的人。</p>
      </div>

      <div class="member-grid" id="grid-core" data-group="core">
        <MemberCard
          v-for="m in coreMembers"
          :key="m.id"
          :member="m"
          @card="openCard"
          @title="openTitle"
        />
        <p v-if="!coreMembers.length" class="muted member-empty">名单整理中，欢迎在群里认领。</p>
      </div>
    </div>
  </section>

  <section class="section" style="padding-top:0">
    <div class="wrap">
      <div class="section-head reveal" style="margin-bottom:34px">
        <p class="eyebrow">Community</p>
        <h2 class="silver">交流群成员</h2>
        <p id="community-note">名单持续补充中 · 想把自己加进来，见「加入我们」。</p>
      </div>

      <div class="member-grid" id="grid-community" data-group="community">
        <MemberCard
          v-for="m in communityMembers"
          :key="m.id"
          :member="m"
          @card="openCard"
          @title="openTitle"
        />
        <p v-if="!communityMembers.length" class="muted member-empty">名单整理中，欢迎在群里认领。</p>
      </div>
    </div>
  </section>

  <section class="section" style="padding-top:0">
    <div class="wrap">
      <div class="glass reveal" style="padding:34px 32px;text-align:center">
        <p class="eyebrow" style="margin-bottom:12px">Name Card</p>
        <p class="muted" style="margin:0 0 8px;font-size:14.5px;line-height:1.9">
          每张成员卡都能生成一张<b>名片图</b>：带你的头衔、作品数，<br />
          以及两个二维码——一个指向你的主页，一个指向公众号。
        </p>
        <p class="muted" style="margin:0;font-size:13px">
          点任意成员卡上的「名片」按钮即可生成并下载，1080×1350，适合直接发朋友圈。
        </p>
      </div>
    </div>
  </section>

  <!-- 名片预览 -->
  <NameCardModal :member="cardMember" @close="closeModals" />

  <!-- 申请头衔 -->
  <TitleRequestModal :member="titleMember" @close="closeModals" />
</template>

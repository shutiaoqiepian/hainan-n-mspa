<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { MEMBERS, MEMBER_GROUPS, type Member, type MemberGroup } from '@/data/members'
import { copyTextSilent } from '@/composables/useCopyText'
import { toast } from '@/composables/useToast'

/**
 * 成员资料弹窗（2026-11-29 新增，替代原先每张卡上的「＋头衔」）
 *
 * 一个入口干两件事：
 *   · 修改已有——成员按分组列成多选清单，勾选后编辑头衔
 *     （只勾一个人＝编辑他的完整头衔；勾多人＝给这批人统一追加）
 *   · 添加新成员——填名字、id、分组、头衔
 *
 * 站内没有后台，两条路最后都只产出可粘贴的数据行，由管理员落到 members.ts。
 * 头衔是逐条加的，不接受斜杠 / 逗号分隔的写法——分隔符解析会让「王一/王二」
 * 这种带符号的称呼被切碎，也让用户猜该用哪个符号。
 */

const props = defineProps<{ open: boolean }>()
const emit = defineEmits<{ close: [] }>()

const dialog = ref<HTMLElement | null>(null)

type Tab = 'edit' | 'add'
const tab = ref<Tab>('edit')

/* ---------- 修改已有 ---------- */

/** 勾选的成员 id，顺序即勾选顺序 */
const selected = ref<string[]>([])
/** 单选＝该成员的完整资料，可逐项改；多选＝批量设置，只能追加头衔和换分组 */
const editName = ref('')
const editGroup = ref<'keep' | MemberGroup>('keep')
const editTitles = ref<string[]>([])
const editDraft = ref('')

const picked = computed(() => MEMBERS.filter((m) => selected.value.includes(m.id)))

/** 单选时改的名字；为空字符串表示没改（用于提醒作品署名要同步改） */
const renamedTo = computed(() => {
  if (selected.value.length !== 1) return ''
  const typed = editName.value.trim()
  const now = picked.value[0]?.name ?? ''
  return typed && typed !== now ? typed : ''
})

const groups = computed(() =>
  (['core', 'community'] as MemberGroup[]).map((key) => ({
    key,
    label: MEMBER_GROUPS[key],
    list: MEMBERS.filter((m) => m.group === key)
  }))
)

function toggle(id: string): void {
  const at = selected.value.indexOf(id)
  if (at >= 0) selected.value.splice(at, 1)
  else selected.value.push(id)
  resetEditor()
}

/** 勾选组合一变，编辑区就换语义了，草稿必须清掉，否则上一轮的输入会莫名留下 */
function resetEditor(): void {
  editDraft.value = ''
  editGroup.value = 'keep'
  if (selected.value.length === 1) {
    const only = MEMBERS.find((m) => m.id === selected.value[0])
    editName.value = only ? only.name : ''
    editTitles.value = only ? [...only.titles] : []
  } else {
    /* 多选没有「统一改名」这回事，名字留空即保持原样；
       头衔是「追加」，从空开始，避免看起来像要把所有人改成同一串 */
    editName.value = ''
    editTitles.value = []
  }
}

function addEditTitle(): void {
  const text = editDraft.value.trim()
  if (!text) return
  if (!editTitles.value.includes(text)) editTitles.value.push(text)
  editDraft.value = ''
}

function dropTitle(list: string[], at: number): void {
  list.splice(at, 1)
}

/** 一名成员一行，字段顺序与 members.ts 里写得下的形式一致 */
function lineOf(id: string, name: string, group: MemberGroup, titles: string[]): string {
  const quoted = titles.map((t) => '"' + t + '"').join(', ')
  return (
    '{ id: "' +
    id +
    '", name: "' +
    name +
    '", group: "' +
    group +
    '", titles: [' +
    quoted +
    '] },'
  )
}

function editLines(): string {
  const one = selected.value.length === 1
  const typed = editName.value.trim()
  return picked.value
    .map((m) => {
      const name = one && typed ? typed : m.name
      const group = editGroup.value === 'keep' ? m.group : editGroup.value
      const titles = one ? editTitles.value.slice() : Array.from(new Set([...m.titles, ...editTitles.value]))
      return lineOf(m.id, name, group, titles)
    })
    .join('\n')
}

function copyEdited(): void {
  if (!picked.value.length) {
    toast('先勾选成员')
    return
  }
  copyTextSilent(editLines())
  toast('已复制 ' + picked.value.length + ' 行，发给管理员即可')
}

/* ---------- 添加新成员 ---------- */

const newName = ref('')
const newId = ref('')
const newGroup = ref<MemberGroup>('core')
const newTitles = ref<string[]>([])
const newDraft = ref('')

const groupOptions: { key: MemberGroup; label: string }[] = [
  { key: 'core', label: MEMBER_GROUPS.core },
  { key: 'community', label: MEMBER_GROUPS.community }
]

/** 中文名转不出拼音，非拉丁字符会被滤空，此时退回 u + 时间戳后五位，保证锚点唯一 */
function fallbackId(name: string): string {
  const latin = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '')
  return latin || 'u' + Date.now().toString(36).slice(-5)
}

function addNewTitle(): void {
  const text = newDraft.value.trim()
  if (!text) return
  if (!newTitles.value.includes(text)) newTitles.value.push(text)
  newDraft.value = ''
}

function copyNew(): void {
  const name = newName.value.trim()
  if (!name) {
    toast('先填名字')
    return
  }
  const id = (newId.value.trim() || fallbackId(name)).replace(/[^a-zA-Z0-9_-]/g, '')
  if (!id) {
    toast('id 只能用字母、数字、下划线')
    return
  }
  if (MEMBERS.some((m) => m.id === id)) {
    toast('id 已被占用，换一个')
    return
  }
  copyTextSilent(lineOf(id, name, newGroup.value, newTitles.value))
  toast('已复制，发给管理员加上')
  newName.value = ''
  newId.value = ''
  newTitles.value = []
  newDraft.value = ''
}

/* ---------- 开关与键盘 ---------- */

watch(
  () => props.open,
  async (open) => {
    if (!open) return
    selected.value = []
    editTitles.value = []
    editDraft.value = ''
    tab.value = 'edit'
    await nextTick()
    dialog.value?.querySelector<HTMLElement>('[role="tab"]')?.focus()
  }
)

function onKeydown(event: KeyboardEvent): void {
  if (!props.open) return
  if (event.key === 'Escape') {
    event.preventDefault()
    emit('close')
    return
  }
  if (event.key === 'Tab') trapFocus(event)
}

/** 面板里的可聚焦元素较多（勾选框、标签页、删除按钮、输入框），Tab 一律锁在面板内 */
function trapFocus(event: KeyboardEvent): void {
  const nodes = dialog.value?.querySelectorAll<HTMLElement>(
    'button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])'
  )
  if (!nodes || nodes.length === 0) return
  const first = nodes[0]
  const last = nodes[nodes.length - 1]
  const active = document.activeElement
  const outside = !dialog.value?.contains(active)
  if (event.shiftKey && (active === first || outside)) {
    event.preventDefault()
    last.focus()
  } else if (!event.shiftKey && (active === last || outside)) {
    event.preventDefault()
    first.focus()
  }
}

onMounted(() => document.addEventListener('keydown', onKeydown))
onBeforeUnmount(() => document.removeEventListener('keydown', onKeydown))
</script>

<template>
  <div
    id="member-edit-modal"
    ref="dialog"
    class="card-modal"
    :class="{ 'is-open': open }"
    role="dialog"
    aria-modal="true"
    aria-label="成员资料"
    @click.self="emit('close')"
  >
    <div class="fb-panel glass me-panel">
      <button class="fb-close" type="button" aria-label="关闭" @click="emit('close')">✕</button>

      <p class="eyebrow">Roster</p>
      <h3 class="fb-title">成员资料</h3>
      <p class="fb-sub">
        站内没有后台，改动会生成一份数据行，复制后发给管理员，下次更新名单时生效。
      </p>

      <div class="me-tabs" role="tablist" aria-label="成员操作">
        <button
          type="button"
          role="tab"
          class="me-tab"
          :class="{ 'is-on': tab === 'edit' }"
          :aria-selected="tab === 'edit'"
          @click="tab = 'edit'"
        >
          修改已有
        </button>
        <button
          type="button"
          role="tab"
          class="me-tab"
          :class="{ 'is-on': tab === 'add' }"
          :aria-selected="tab === 'add'"
          @click="tab = 'add'"
        >
          添加新成员
        </button>
      </div>

      <!-- 修改已有 -->
      <div v-if="tab === 'edit'" class="me-body">
        <div class="me-list">
          <div v-for="g in groups" :key="g.key" class="me-group">
            <p class="me-group-title">{{ g.label }}</p>
            <label v-for="m in g.list" :key="m.id" class="me-row">
              <input
                type="checkbox"
                class="me-check"
                :checked="selected.includes(m.id)"
                @change="toggle(m.id)"
              />
              <span class="me-row-name">{{ m.name }}</span>
              <span class="me-row-titles">{{ m.titles.length ? m.titles.join(' · ') : '无头衔' }}</span>
            </label>
          </div>
        </div>

        <div v-if="selected.length" class="me-editor">
          <p class="me-editor-head">
            <template v-if="selected.length === 1">
              编辑「{{ picked[0].name }}」的资料
            </template>
            <template v-else>
              给选中的 {{ selected.length }} 人批量设置
            </template>
          </p>

          <label v-if="selected.length === 1" class="me-field">
            <span class="me-field-label">名字</span>
            <input
              v-model="editName"
              class="fb-input me-field-input"
              maxlength="24"
              placeholder="与作品署名一致"
            />
          </label>
          <p v-if="renamedTo" class="me-warn">
            作品集里署名「{{ picked[0].name }}」的作品会挂不上这张卡，要一起改。
          </p>

          <p class="me-field-label me-field-label-block">分组</p>
          <div class="me-pick">
            <button
              type="button"
              class="me-pick-btn"
              :class="{ 'is-on': editGroup === 'keep' }"
              @click="editGroup = 'keep'"
            >
              保持原样
            </button>
            <button
              type="button"
              class="me-pick-btn"
              :class="{ 'is-on': editGroup === 'core' }"
              @click="editGroup = 'core'"
            >
              {{ MEMBER_GROUPS.core }}
            </button>
            <button
              type="button"
              class="me-pick-btn"
              :class="{ 'is-on': editGroup === 'community' }"
              @click="editGroup = 'community'"
            >
              {{ MEMBER_GROUPS.community }}
            </button>
          </div>

          <p class="me-field-label me-field-label-block">
            头衔<template v-if="selected.length > 1">（追加到每人现有头衔）</template>
          </p>
          <div class="me-chips">
            <span v-for="(t, i) in editTitles" :key="t" class="me-chip">
              {{ t }}
              <button type="button" class="me-chip-x" aria-label="删除这个头衔" @click="dropTitle(editTitles, i)">
                ✕
              </button>
            </span>
            <span v-if="!editTitles.length" class="me-chips-empty">还没有头衔</span>
          </div>

          <div class="me-add">
            <input
              v-model="editDraft"
              class="fb-input me-input"
              maxlength="24"
              placeholder="写一个头衔，回车加入"
              @keydown.enter.prevent="addEditTitle"
            />
            <button type="button" class="btn btn-ghost me-add-btn" @click="addEditTitle">加入</button>
          </div>

          <button type="button" class="btn btn-primary fb-submit" @click="copyEdited">
            生成并复制 {{ selected.length }} 行
          </button>
        </div>
        <p v-else class="me-hint">勾选一个或多个成员，这里会出现编辑区。</p>
      </div>

      <!-- 添加新成员 -->
      <div v-else class="me-body">
        <input v-model="newName" class="fb-input" maxlength="24" placeholder="名字（与作品署名一致）" />
        <input
          v-model="newId"
          class="fb-input"
          maxlength="24"
          placeholder="链接里的名字，留空自动生成"
        />
        <p class="me-note">
          这一项不显示在页面上，只决定分享链接跳到哪儿，比如 members.html#m-kelei
          打开就直接定位到柯雷那张卡。用小写字母、数字、连字符，别和已有成员重复。
        </p>

        <p class="me-field-label me-field-label-block">分组</p>
        <div class="me-pick">
          <button
            v-for="g in groupOptions"
            :key="g.key"
            type="button"
            class="me-pick-btn"
            :class="{ 'is-on': newGroup === g.key }"
            @click="newGroup = g.key"
          >
            {{ g.label }}
          </button>
        </div>

        <p class="me-field-label me-field-label-block">头衔</p>
        <div class="me-chips">
          <span v-for="(t, i) in newTitles" :key="t" class="me-chip">
            {{ t }}
            <button type="button" class="me-chip-x" aria-label="删除这个头衔" @click="dropTitle(newTitles, i)">
              ✕
            </button>
          </span>
          <span v-if="!newTitles.length" class="me-chips-empty">还没有头衔</span>
        </div>

        <div class="me-add">
          <input
            v-model="newDraft"
            class="fb-input me-input"
            maxlength="24"
            placeholder="写一个头衔，回车加入"
            @keydown.enter.prevent="addNewTitle"
          />
          <button type="button" class="btn btn-ghost me-add-btn" @click="addNewTitle">加入</button>
        </div>

        <button type="button" class="btn btn-primary fb-submit" @click="copyNew">
          生成并复制这一行
        </button>
        <p class="fb-tip">名字要和作品集里的署名完全一致，否则作品挂不到这个人的卡上。</p>
      </div>
    </div>
  </div>
</template>

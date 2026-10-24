import { onBeforeUnmount, onMounted } from 'vue'

/**
 * 滚动淡入（旧版 initReveal）
 * 同一批参数：threshold 0.12、rootMargin -8%、data-delay 毫秒延迟。
 * 动态插入的 .reveal 节点也要能被观察，所以额外挂一个 MutationObserver。
 */

const observed = new WeakSet<Element>()
let observer: IntersectionObserver | null = null
let watcher: MutationObserver | null = null

function ensureObserver(): IntersectionObserver | null {
  if (observer) return observer
  observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return
        const el = entry.target as HTMLElement
        const delay = Number(el.getAttribute('data-delay') || 0)
        window.setTimeout(() => el.classList.add('is-in'), delay)
        observer?.unobserve(el)
      })
    },
    { threshold: 0.12, rootMargin: '0px 0px -8% 0px' }
  )
  return observer
}

/** 把当前 DOM 里还没被观察过的 .reveal / .fc-reveal 都挂上去（可重复调用） */
export function scanReveal(): void {
  const nodes = document.querySelectorAll<HTMLElement>('.reveal,.fc-reveal')
  if (!nodes.length) return

  /* 没有 IntersectionObserver，或者用户要求减弱动效：
     不做「等滚到才出现」，直接点亮。
     —— 注意这里必须自己判一次 prefers-reduced-motion：
     预报页的区块是数据到位后才渲染的，onMounted 那一刻它们还不存在，
     不能指望挂载时那次扫描把它们点亮。 */
  const calm =
    typeof window !== 'undefined' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches

  if (calm || !('IntersectionObserver' in window)) {
    nodes.forEach((node) => {
      if (node.classList.contains('is-in')) return
      observed.add(node)
      node.classList.add('is-in')
    })
    return
  }

  const io = ensureObserver()
  nodes.forEach((node) => {
    if (observed.has(node)) return
    observed.add(node)
    io?.observe(node)
  })
}

export function useReveal(): void {
  onMounted(() => {
    scanReveal()

    /* 减弱动效 / 不支持 IntersectionObserver 时，scanReveal 内部会直接点亮；
       但预报页的区块是数据到位后才渲染的（onMounted 时还不存在），
       所以观察器仍然要挂着，让后插入的节点也能被点亮。 */
    if (!('IntersectionObserver' in window)) return

    watcher = new MutationObserver(() => scanReveal())
    watcher.observe(document.body, { childList: true, subtree: true })
  })

  onBeforeUnmount(() => {
    watcher?.disconnect()
    watcher = null
  })
}

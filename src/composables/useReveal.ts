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

/** 把当前 DOM 里还没被观察过的 .reveal 都挂上去（可重复调用） */
export function scanReveal(): void {
  const nodes = document.querySelectorAll<HTMLElement>('.reveal')
  if (!nodes.length) return

  if (!('IntersectionObserver' in window)) {
    nodes.forEach((node) => {
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
    if (!('IntersectionObserver' in window)) return

    watcher = new MutationObserver(() => scanReveal())
    watcher.observe(document.body, { childList: true, subtree: true })
  })

  onBeforeUnmount(() => {
    watcher?.disconnect()
    watcher = null
  })
}

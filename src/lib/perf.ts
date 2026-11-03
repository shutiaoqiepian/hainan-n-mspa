/* ============================================================
   性能模式（低配手机 / 省电）
   ------------------------------------------------------------
   和黑/灰/白是**两个独立开关**：配色选什么跟要不要省电无关，
   所以状态单独存在 <html data-perf="on">，不碰 data-theme。

   关掉的是什么（都是实测里最费 GPU/电的）：
     · 35 处 backdrop-filter 毛玻璃 → 纯色
     · 6 处无限循环动画（呼吸光、扫描光、滚动提示等）
     · 液态玻璃的指针跟随（每帧算一次 rect + 写 CSS 变量）
     · 滚动淡入（改成直接显示，省掉 IntersectionObserver 的逐帧回调）
     · 剖面页 canvas 从 devicePixelRatio 2 降到 1（像素减到 1/4）
     · 大图不再做「先模糊后清晰」的占位过渡

   刻意**不动**的：字体大小、色彩对比、明暗、布局、信息量。
   性能模式是「少动一点」，不是「少看一点」。

   约定和主题一致：
     · localStorage 键 mspa:perf
     · 首帧前由各入口 HTML 的内联脚本兜底（避免先亮后暗的闪烁）
     · ?perf=on|off 可临时预览（不写回）
   ============================================================ */

export type PerfMode = 'on' | 'off'

const KEY = 'mspa:perf'
const ATTR = 'data-perf'

/** 读当前状态（以 <html> 上的属性为准，内联脚本已经设好） */
export function currentPerf(): PerfMode {
  return document.documentElement.getAttribute(ATTR) === 'on' ? 'on' : 'off'
}

export function perfEnabled(): boolean {
  return currentPerf() === 'on'
}

export function applyPerf(mode: PerfMode, persist = true): void {
  const root = document.documentElement
  if (mode === 'on') root.setAttribute(ATTR, 'on')
  else root.removeAttribute(ATTR)

  /* 通知页面里的 canvas / 图片组件重新适配（不用刷新页面） */
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('mspa:perf', { detail: mode }))
  }

  if (!persist) return
  try {
    localStorage.setItem(KEY, mode)
  } catch {
    /* 隐私模式写不了，忽略 */
  }
}

export function initPerf(): PerfMode {
  const mode = currentPerf()
  applyPerf(mode, false)
  return mode
}

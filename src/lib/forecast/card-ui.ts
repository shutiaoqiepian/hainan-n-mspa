/**
 * 预报名片的弹窗状态：放在模块里，行组件和页面都不必各自传事件。
 */

import { reactive } from 'vue'
import type { Row } from '@/lib/forecast/types'

export interface CardUiState {
  open: boolean
  mode: 'spot' | 'list'
  row: Row | null
  top: Row[]
}

export const cardUi = reactive<CardUiState>({
  open: false,
  mode: 'spot',
  row: null,
  top: []
})

export function openSpotCard(row: Row): void {
  cardUi.mode = 'spot'
  cardUi.row = row
  cardUi.top = []
  cardUi.open = true
  lockScroll(true)
}

export function openListCard(rows: Row[]): void {
  cardUi.mode = 'list'
  cardUi.row = null
  cardUi.top = rows.slice(0, 5)
  cardUi.open = true
  lockScroll(true)
}

export function closeCard(): void {
  cardUi.open = false
  lockScroll(false)
}

function lockScroll(on: boolean): void {
  document.body.style.overflow = on ? 'hidden' : ''
}

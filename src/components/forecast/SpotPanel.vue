<script setup lang="ts">
import { computed, ref } from 'vue'
import CloudProfile from './CloudProfile.vue'
import HourTable from './HourTable.vue'
import { layerVerdict, sunPillarNote } from '@/lib/forecast/scoring'
import { state } from '@/lib/forecast/state'
import { dateText } from '@/lib/forecast/time'
import type { Row } from '@/lib/forecast/types'

/** 选中机位的气象条件分析：云层结构 / 大气与降水 / 天文与拍摄 / 模型与可信度 / 逐时。
    原来这些散在「每行展开的详情」里，一次只能看一个且要滚动很久；
    现在改成固定面板，点表格换机位。 */

const props = defineProps<{ row: Row }>()

const d = computed(() => props.row.detail)
const m = computed(() => props.row.m)
const kindWord = computed(() => (state.kind === 'sunrise' ? '日出' : '日落'))

const layers = computed(() => [...d.value.layers].reverse())
const verdicts = computed(() =>
  Object.fromEntries(d.value.layers.map((l) => [l.level, layerVerdict(l)]))
)
const pillarNote = computed(() => sunPillarNote(d.value.layers, props.row.sunAz))

/* 云层剖面里点开某一层 */
const openLayer = ref<number | null>(null)
function toggleLayer(level: number): void {
  openLayer.value = openLayer.value === level ? null : level
}

function n0(v: number | null | undefined): string {
  return v == null || !Number.isFinite(v) ? '—' : String(Math.round(v))
}
function fx(v: number | null | undefined, n = 2): string {
  return v == null || !Number.isFinite(v) ? '—' : v.toFixed(n)
}
function hm(v: number | null): string {
  if (v == null) return '—'
  return v >= 1000 ? (v / 1000).toFixed(1) + 'k' : String(v)
}

const airCells = computed(() => {
  const mm = m.value
  const r = props.row
  return [
    { k: '相对湿度', v: n0(mm.rh), u: '%' },
    { k: '露点差', v: mm.t2m != null && mm.td2m != null ? (mm.t2m - mm.td2m).toFixed(1) : '—', u: '℃' },
    { k: '能见度', v: mm.vis == null ? '—' : (mm.vis / 1000).toFixed(1), u: 'km' },
    { k: '降水概率', v: n0(mm.pop), u: '%' },
    { k: 'AOD 气溶胶', v: fx(mm.aod), u: mm.aodMissing ? '缺测' : r.aodName },
    { k: '2 m 气温', v: mm.t2m == null ? '—' : mm.t2m.toFixed(1), u: '℃' },
    { k: '低云云底', v: r.cloudBaseLow == null ? '—' : '≈' + r.cloudBaseLow, u: 'm' },
    { k: '中层云底', v: r.cloudBaseMid == null ? '—' : '≈' + r.cloudBaseMid, u: 'm' }
  ]
})

const sunRows = computed(() => {
  const x = d.value
  const r = props.row
  return [
    { k: kindWord.value + '时刻', v: x.time, n: '' },
    { k: '太阳方位', v: r.sunAz == null ? '—' : r.sunAz + '°', n: '机位朝' + r.spot.face + (r.faceOff ? '（⚠ 不符）' : '（相符）') },
    { k: '太阳高度', v: x.sunEl == null ? '—' : x.sunEl.toFixed(1) + '°', n: x.sunEl != null && x.sunEl < 0 ? '已在地平线下' : '' },
    { k: '黄金时刻', v: x.golden, n: '' },
    { k: '蓝调时刻', v: x.blue, n: '' },
    { k: '最佳时刻', v: r.peakTime + ' · ' + r.peakScore + ' 分', n: '窗口内分数最高' },
    { k: '鲜艳度峰值', v: r.vividPeakTime + ' · ' + r.vividPeakLabel + ' ' + r.vividPeak, n: '窗口内颜色最浓' }
  ]
})

const consistency = computed(() => Math.min(100, Math.max(0, 100 - props.row.spread)))
</script>

<template>
  <div class="fcd2">
    <div class="fcd2-head">
      <h2>气象条件分析</h2>
      <span class="sub">
        {{ row.spot.n }} · {{ dateText(d.date, d.weekday) }} {{ kindWord }} {{ d.time }}
        · 太阳高度 {{ d.sunEl == null ? '—' : d.sunEl.toFixed(1) + '°' }} · {{ d.genusText }}
      </span>
    </div>

    <div class="fcd2-cols">
      <!-- 左：云层结构（最详细） -->
      <div class="fcd2-col">
        <div class="fcd2-card">
          <div class="fcd2-ch">
            <h3>云层结构</h3>
            <label>8 个气压层的云量 / 云属 / 温湿 / 云底云顶</label>
            <s>ECMWF 单模式 · 点每一层看判据</s>
          </div>

          <div class="fcl">
            <div class="fcl-row fcl-hd">
              <span>高度</span><span>云量</span><span>云属 · 云种</span><span>湿度</span><span>气温</span><span class="r">底/顶</span>
            </div>
            <template v-for="l in layers" :key="l.level">
              <button
                type="button"
                class="fcl-row fcl-line"
                :class="{ open: openLayer === l.level }"
                :aria-expanded="openLayer === l.level ? 'true' : 'false'"
                @click="toggleLayer(l.level)"
              >
                <span class="h">
                  {{ l.height >= 1000 ? (l.height / 1000).toFixed(1) + ' km' : l.height + ' m' }}<i>{{ l.level }} hPa</i>
                </span>
                <span class="cb"><span class="trk"><i :style="{ width: Math.max(0, l.cover) + '%' }"></i></span><s>{{ l.cover }}%</s></span>
                <span class="cg">
                  <template v-if="l.code === '--'"><span style="color: var(--muted-2)">无云</span></template>
                  <template v-else>
                    <b>{{ l.genus }}</b>
                    <em v-if="l.species && l.species !== l.genus"> · {{ l.species }}</em>
                    <em :class="l.lit ? 'lit' : 'unlit'">{{ l.lit ? ' · 可被照亮' : ' · 照不亮' }}</em>
                  </template>
                </span>
                <span class="cw">{{ l.rh }}%</span>
                <span class="ct">{{ l.t == null ? '—' : Math.round(l.t) + '°' }}</span>
                <span class="cbt">{{ hm(l.base) }}<template v-if="l.top != null">→{{ hm(l.top) }}</template></span>
              </button>
              <div v-if="openLayer === l.level" class="fcl-note">
                <p>
                  <b>判据</b>：{{ l.level }} hPa 约 {{ l.height >= 1000 ? (l.height / 1000).toFixed(1) + ' km' : l.height + ' m' }}，
                  云量 {{ l.cover }}%、相对湿度 {{ l.rh }}%<template v-if="l.t != null">、气温 {{ Math.round(l.t) }}℃</template
                  ><template v-if="l.td != null">、露点 {{ Math.round(l.td) }}℃</template>。
                </p>
                <p><b>能不能出霞</b>：{{ verdicts[l.level] }}。</p>
                <p class="muted">{{ l.note }}</p>
              </div>
            </template>
          </div>

          <p class="fcl-legend">
            低云 &lt;2 km · 中云 2–6 km · 高云 &gt;6 km ·「可被照亮」= 薄到夕阳能从底下透过并染色。云属由「云量 + 湿度 + 温度 + 降水」推得，不是实测。
          </p>

          <div v-if="d.conflicts.length" class="fcd2-warn">
            <p v-for="c in d.conflicts" :key="c.band">
              ⚠ 模式打架 · {{ c.band }}：多模式平均 {{ c.avg }}%，ECMWF 单模式 {{ c.ecmwf }}% —— {{ c.text }}
            </p>
          </div>
        </div>

        <CloudProfile v-if="false" :layers="d.layers" />
      </div>

      <!-- 右：大气 / 天文 / 模型 -->
      <div class="fcd2-col">
        <div class="fcd2-card">
          <div class="fcd2-ch"><h3>大气与降水</h3></div>
          <div class="fcmg">
            <div v-for="c in airCells" :key="c.k" class="fcmc" :class="{ miss: c.v === '—' }">
              <span class="k">{{ c.k }}</span>
              <span class="v">{{ c.v }}<em v-if="c.v !== '—'">{{ c.u }}</em></span>
            </div>
          </div>
        </div>

        <div class="fcd2-card">
          <div class="fcd2-ch"><h3>天文与拍摄</h3></div>
          <div class="fckv">
            <div v-for="x in sunRows" :key="x.k" class="fckv-r">
              <span class="k">{{ x.k }}</span><span class="v">{{ x.v }}</span>
              <span v-if="x.n" class="n">{{ x.n }}</span>
            </div>
          </div>
        </div>

        <div class="fcd2-card">
          <div class="fcd2-ch"><h3>模型与可信度</h3></div>
          <div class="fcchain">
            <span class="st">原始分</span><b>{{ row.rawScore }}</b>
            <span class="arw">→</span><span class="st">逐时平滑</span><span class="arw">→</span>
            <span class="st">朝向 / 云层结构</span><span class="arw">→</span>
            <b :style="{ color: row.level.color }">{{ row.score }}</b><span class="st">最终分</span>
          </div>
          <div class="fcbox">
            <span class="nm">8 模式一致度</span>
            <span class="bar"><i :style="{ width: consistency + '%' }"></i></span>
            <span class="sg">{{ consistency }}%</span>
          </div>
          <div class="fcbox">
            <span class="nm">模式分歧</span>
            <span class="bar">
              <i
                :style="{ width: Math.min(100, row.spread * 2) + '%', background: row.spread >= 18 ? 'var(--warn)' : 'var(--muted)' }"
              ></i>
            </span>
            <span class="sg">±{{ row.spread }} 分{{ row.spread >= 18 ? '（已打折）' : '' }}</span>
          </div>
          <div class="fcbox">
            <span class="nm">数据完整度</span>
            <span class="bar"><i :style="{ width: row.quality.completeness + '%; background: var(--good)' }"></i></span>
            <span class="sg">{{ row.quality.completeness }}%</span>
          </div>
          <p class="fcd2-note">光柱这一路：{{ pillarNote }}</p>
        </div>
      </div>
    </div>

    <HourTable :row="row" />
  </div>
</template>

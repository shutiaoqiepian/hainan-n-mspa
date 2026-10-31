<script setup lang="ts">
/**
 * 大气水平—垂直剖面页。
 *
 * 定位：**解释层**，不是新的评分系统。
 *   · 不读 forecast 的缓存、不改 scoreOf()、不参与排名；
 *   · 主数据源是 CI 生成好的 GFS 剖面（data/cross/*.json）；
 *   · 对照数据源是 Open-Meteo 多点实时请求（只有确诊云量，没有云水云冰，图上会明说）。
 *
 * 从预报页进来时带 ?spot=&t=&az=，这样「看哪个机位、哪个时刻、哪个方向」能接上。
 */
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import CrossSectionChart from '@/components/xsec/CrossSectionChart.vue'
import { ageHours, loadXsecIndex, loadXsecSpot } from '@/lib/xsec/api'
import { Y_RANGES, beijingDateTime, beijingTime, cloudBands, expandPoints, sectionAt } from '@/lib/xsec/model'
import { fetchOpenMeteoSection } from '@/lib/xsec/openmeteo'
import { sunInPlane, sunsetMs } from '@/lib/xsec/sun'
import type { XsecIndex, XsecSpotFile } from '@/lib/xsec/types'

const index = ref<XsecIndex | null>(null)
/** GFS 缓存（主数据源，4 个时次 × 5 个方位） */
const gfsFile = ref<XsecSpotFile | null>(null)
/** Open-Meteo 实时结果（对照数据源，单个时次） */
const omFile = ref<XsecSpotFile | null>(null)
const loading = ref(true)
const error = ref('')
const omLoading = ref(false)
const omError = ref('')
const source = ref<'gfs' | 'om'>('gfs')
const spotId = ref('')
const tIdx = ref(0)
const az = ref(265)
const yMaxKm = ref(16)
const layers = ref({ rh: false, temp: false, wind: false, w: false })
const full = ref(false)
const card = ref<HTMLElement | null>(null)
/** 从预报页点进来时带的机位（可能不在 8 个代表机位里） */
const fromName = ref('')
const fromNote = ref('')

const AZ_CHOICES = [240, 255, 265, 280, 295]
const LAYER_ITEMS = [
  { key: 'rh' as const, name: '湿度等值线', hint: '50 / 70 / 85 / 95 %' },
  { key: 'temp' as const, name: '温度等值线', hint: '每 10 °C' },
  { key: 'wind' as const, name: '风矢量', hint: 'U/V 分量' },
  { key: 'w' as const, name: '垂直速度', hint: '▲上升 ▼下沉 · Pa/s' }
]

/* ---------------- 派生数据 ---------------- */

const spotMeta = computed(() => {
  const idx = index.value
  if (!idx) return null
  return idx.spots.find((s) => s.id === spotId.value) ?? idx.spots[0] ?? null
})

const isOm = computed(() => source.value === 'om')
const activeFile = computed<XsecSpotFile | null>(() => (isOm.value ? omFile.value : gfsFile.value))

const section = computed(() => {
  const f = activeFile.value
  if (!f) return null
  return sectionAt(f, isOm.value ? 0 : tIdx.value, az.value)
})

/** 时次列表始终用 GFS 缓存的（Open-Meteo 只拉当前选中的那一个时刻） */
const times = computed(() => gfsFile.value?.times ?? [])

const validIso = computed(() => {
  const f = activeFile.value
  if (!f) return ''
  const t = isOm.value ? f.times[0] : f.times.find((x) => x.t === tIdx.value) ?? f.times[0]
  return t ? t.utc : ''
})

const validMs = computed(() => new Date(validIso.value).getTime())

const sun = computed(() => {
  const f = activeFile.value
  if (!f) return null
  return sunInPlane(validMs.value, f.spot.lat, f.spot.lon, az.value)
})

const sunsetAt = computed(() => {
  const f = activeFile.value
  if (!f || !validIso.value) return NaN
  return sunsetMs(f.spot.lat, f.spot.lon, validIso.value)
})

const sunDown = computed(() => Number.isFinite(sunsetAt.value) && validMs.value >= sunsetAt.value)

const dataAge = computed(() => {
  const idx = index.value
  return idx ? ageHours(idx.generatedAt) : NaN
})

const stale = computed(() => !isOm.value && Number.isFinite(dataAge.value) && dataAge.value > 12)

/** 与日落时刻最接近的那个时次高亮 */
const nearestSunsetIdx = computed(() => {
  const f = gfsFile.value
  if (!f || !Number.isFinite(sunsetAt.value)) return -1
  let best = -1
  let bd = Infinity
  f.times.forEach((t) => {
    const diff = Math.abs(new Date(t.utc).getTime() - sunsetAt.value)
    if (diff < bd) { bd = diff; best = t.t }
  })
  return best
})

/** 中心采样点上的云层分段（右侧列表用） */
const bandList = computed(() => {
  const f = activeFile.value
  const s = section.value
  if (!f || !s) return []
  const pts = expandPoints(f, s)
  const mid = pts[Math.floor(pts.length / 2)]
  return mid ? cloudBands(mid, 10) : []
})

/** 太阳偏离剖面方向太多时，图上要明确说「不在剖面平面内」 */
const sunWarning = computed(() => {
  const s = sun.value
  if (!s) return ''
  if (Math.abs(s.deviationDeg) > 25) {
    return `太阳方位与剖面方位相差 ${Math.abs(s.deviationDeg).toFixed(0)}°，图中光线只是投影，不代表真实三维光路。`
  }
  return ''
})

/* ---------------- 从预报页跳转过来 ---------------- */

function distanceKm(aLat: number, aLon: number, bLat: number, bLon: number): number {
  const R = 6371.0
  const p1 = (aLat * Math.PI) / 180
  const p2 = (bLat * Math.PI) / 180
  const dp = p2 - p1
  const dl = ((bLon - aLon) * Math.PI) / 180
  const h = Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(h))
}

/** 预报页的机位不在 8 个代表机位里时，用最近的那个代替，并如实说明 */
function resolveIncoming(q: URLSearchParams): { id: string; note: string } {
  const idx = index.value
  if (!idx) return { id: '', note: '' }
  const name = q.get('name') ?? ''
  fromName.value = name
  const exact = idx.spots.find((s) => name && (s.name === name || s.name.includes(name) || name.includes(s.name)))
  if (exact) {
    return { id: exact.id, note: name && exact.name !== name ? `已定位到代表机位「${exact.name}」` : '' }
  }
  const lat = Number(q.get('lat'))
  const lon = Number(q.get('lon'))
  if (name && Number.isFinite(lat) && Number.isFinite(lon)) {
    let best = idx.spots[0]
    let bd = Infinity
    for (const s of idx.spots) {
      const d = distanceKm(lat, lon, s.lat, s.lon)
      if (d < bd) { bd = d; best = s }
    }
    if (best) {
      return {
        id: best.id,
        note: `「${name}」不在 8 个代表机位里，这里显示距它最近的「${best.name}」（约 ${Math.round(bd)} km）`
      }
    }
  }
  return { id: '', note: name ? `「${name}」不在 8 个代表机位里，下面显示的是默认机位` : '' }
}

/* ---------------- 加载 ---------------- */

function readUrl(): { spot: string; t: number; az: number } {
  const q = new URLSearchParams(location.search)
  const spot = q.get('spot') ?? ''
  const t = Number(q.get('t'))
  const a = Number(q.get('az'))
  return { spot, t: Number.isFinite(t) ? t : 0, az: Number.isFinite(a) && a >= 0 ? a : 265 }
}

function writeUrl(): void {
  const q = new URLSearchParams()
  q.set('spot', spotId.value)
  q.set('t', String(tIdx.value))
  q.set('az', String(az.value))
  history.replaceState(null, '', `${location.pathname}?${q.toString()}`)
}

async function pickSpot(id: string): Promise<void> {
  const idx = index.value
  if (!idx) return
  const meta = idx.spots.find((s) => s.id === id) ?? idx.spots[0]
  if (!meta) return
  spotId.value = meta.id
  loading.value = true
  error.value = ''
  try {
    const f = await loadXsecSpot(meta.file)
    gfsFile.value = f
    if (!f.azimuths.includes(az.value)) az.value = f.spot.defaultAzimuth
    if (!f.times.some((t) => t.t === tIdx.value)) {
      tIdx.value = nearestSunsetIdx.value >= 0 ? nearestSunsetIdx.value : 0
    }
    if (isOm.value) await loadOm()
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
    gfsFile.value = null
  } finally {
    loading.value = false
  }
}

async function loadOm(): Promise<void> {
  const g = gfsFile.value
  if (!g) return
  const t = g.times.find((x) => x.t === tIdx.value) ?? g.times[0]
  if (!t) return
  omLoading.value = true
  omError.value = ''
  try {
    const distances = g.sections[0]?.samples.map((s) => s.d) ?? [0, 12.5, 25, 37.5, 50]
    omFile.value = await fetchOpenMeteoSection(g.spot, {
      levelsHpa: g.levelsHpa,
      sampleKm: distances,
      az: az.value,
      validIso: t.utc
    })
  } catch (e) {
    omError.value = e instanceof Error ? e.message : String(e)
    omFile.value = null
  } finally {
    omLoading.value = false
  }
}

async function init(): Promise<void> {
  try {
    index.value = await loadXsecIndex()
    const u = readUrl()
    tIdx.value = u.t
    az.value = u.az
    const q = new URLSearchParams(location.search)
    const incoming = resolveIncoming(q)
    if (incoming.note) fromNote.value = incoming.note
    await pickSpot(u.spot || incoming.id || (index.value.spots[0]?.id ?? ''))
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
    loading.value = false
  }
}

onMounted(() => {
  void init()
  document.addEventListener('fullscreenchange', onFsChange)
})

onBeforeUnmount(() => {
  document.removeEventListener('fullscreenchange', onFsChange)
})

watch([spotId, tIdx, az], () => {
  if (spotId.value) writeUrl()
  if (isOm.value) void loadOm()
})

watch(source, (v) => {
  if (v === 'om' && !omFile.value) void loadOm()
})

/* ---------------- 交互 ---------------- */

function selectSpot(id: string): void {
  if (id === spotId.value) return
  void pickSpot(id)
}

function selectTime(t: number): void {
  tIdx.value = t
}

function selectAz(a: number): void {
  az.value = a
}

function selectSource(s: 'gfs' | 'om'): void {
  source.value = s
}

function toggleLayer(key: 'rh' | 'temp' | 'wind' | 'w'): void {
  layers.value = { ...layers.value, [key]: !layers.value[key] }
}

function onFsChange(): void {
  full.value = document.fullscreenElement === card.value
}

async function toggleFull(): Promise<void> {
  const el = card.value
  if (!el) return
  if (document.fullscreenElement) {
    await document.exitFullscreen()
    return
  }
  try {
    await el.requestFullscreen()
  } catch {
    full.value = !full.value
  }
}

/* ---------------- 文案工具 ---------------- */

const SUNSET_TEXT = computed(() => {
  const t = sunsetAt.value
  if (!Number.isFinite(t)) return '—'
  return beijingTime(new Date(t).toISOString())
})
</script>

<template>
  <section class="page-head xsec-head">
    <div class="wrap">
      <p class="eyebrow">Cross Section · 大气剖面</p>
      <h1 class="xsec-h1">云在哪一层，<b>光从哪里来</b></h1>
      <p class="xsec-lede">
        沿你镜头朝向切开 50 km 的空气：横轴是距离，纵轴是海拔，颜色是模式算出来的云水与云冰。
        这张图解释的是「云层结构」，不参与霞光评分的计算，也不比评分更准。
      </p>
    </div>
  </section>

  <section class="section xsec-section">
    <div class="wrap">
      <div v-if="loading" class="fc-empty">正在读取剖面数据…</div>
      <div v-else-if="error" class="fc-empty">
        {{ error }}<br /><br />剖面缓存由 GitHub Actions 定时生成，可能需要等下一次更新。
      </div>

      <template v-else-if="index && gfsFile">
        <p v-if="fromNote" class="xsec-from-note">{{ fromNote }}</p>

        <!-- 机位切换 -->
        <div class="xsec-spots" role="tablist" aria-label="代表机位">
          <button
            v-for="s in index.spots"
            :key="s.id"
            type="button"
            class="xsec-spot"
            :class="{ 'is-on': s.id === spotId }"
            role="tab"
            :aria-selected="s.id === spotId"
            @click="selectSpot(s.id)"
          >
            <span class="xsec-spot-name">{{ s.name }}</span>
            <span class="xsec-spot-tag">{{ s.tag }}</span>
          </button>
        </div>

        <!-- 工具条 -->
        <div class="xsec-toolbar">
          <div class="xsec-group">
            <span class="xsec-group-label">数据源</span>
            <div class="xsec-seg">
              <button
                type="button"
                class="xsec-seg-btn"
                :class="{ 'is-on': !isOm }"
                @click="selectSource('gfs')"
              >
                GFS 模式云水
              </button>
              <button
                type="button"
                class="xsec-seg-btn"
                :class="{ 'is-on': isOm }"
                @click="selectSource('om')"
              >
                Open-Meteo 估算
              </button>
            </div>
          </div>

          <div class="xsec-group">
            <span class="xsec-group-label">时刻</span>
            <div class="xsec-seg">
              <button
                v-for="t in times"
                :key="t.t"
                type="button"
                class="xsec-seg-btn"
                :class="{ 'is-on': t.t === tIdx, 'is-sunset': t.t === nearestSunsetIdx }"
                @click="selectTime(t.t)"
              >
                {{ beijingTime(t.utc) }}
              </button>
            </div>
            <span class="xsec-hint">日落约 {{ SUNSET_TEXT }}</span>
          </div>

          <div class="xsec-group">
            <span class="xsec-group-label">方位</span>
            <div class="xsec-seg">
              <button
                v-for="a in AZ_CHOICES"
                :key="a"
                type="button"
                class="xsec-seg-btn"
                :class="{ 'is-on': a === az }"
                @click="selectAz(a)"
              >
                {{ a }}°
              </button>
            </div>
            <span v-if="sun" class="xsec-hint">太阳方位 {{ sun.az.toFixed(0) }}°</span>
          </div>

          <div class="xsec-group">
            <span class="xsec-group-label">高度</span>
            <div class="xsec-seg">
              <button
                v-for="r in Y_RANGES"
                :key="r"
                type="button"
                class="xsec-seg-btn"
                :class="{ 'is-on': r === yMaxKm }"
                @click="yMaxKm = r"
              >
                0–{{ r }} km
              </button>
            </div>
          </div>

          <div class="xsec-group xsec-group-layers">
            <span class="xsec-group-label">图层</span>
            <button
              v-for="l in LAYER_ITEMS"
              :key="l.key"
              type="button"
              class="xsec-chip"
              :class="{ 'is-on': layers[l.key] }"
              :title="l.hint"
              @click="toggleLayer(l.key)"
            >
              {{ l.name }}
            </button>
          </div>

          <button type="button" class="xsec-full" @click="toggleFull">
            {{ full ? '退出全屏' : '全屏' }}
          </button>
        </div>

        <div v-if="isOm && omLoading" class="fc-empty">正在向 Open-Meteo 请求 5 个点的气压层数据…</div>
        <div v-else-if="isOm && omError" class="fc-empty">
          Open-Meteo 请求失败：{{ omError }}<br /><br />可以切回 GFS 模式云水查看缓存数据。
        </div>

        <template v-else-if="activeFile && section && sun">
          <!-- 图表卡片 -->
          <div ref="card" class="card xsec-card" :class="{ 'is-full': full }">
            <div class="xsec-card-head">
              <div>
                <strong>{{ activeFile.spot.name }}</strong>
                <span class="xsec-sep">·</span>
                <span>{{ activeFile.spot.area }} / 朝 {{ activeFile.spot.face }}</span>
                <span class="xsec-sep">·</span>
                <span>{{ beijingDateTime(validIso) }}（北京）</span>
              </div>
              <div class="xsec-card-meta">
                <span>方位 {{ az }}°</span>
                <span>太阳 {{ sun.el.toFixed(0) }}° / {{ sun.az.toFixed(0) }}°</span>
                <span v-if="!isOm">起报 {{ beijingDateTime(index.cycle) }}</span>
                <span v-else>Open-Meteo 实时请求</span>
              </div>
            </div>

            <div class="xsec-scroll">
              <CrossSectionChart
                :file="activeFile"
                :section="section"
                :y-max-km="yMaxKm"
                :layers="layers"
                :sun="sun"
                :sun-down="sunDown"
              />
            </div>

            <div class="xsec-legend">
              <template v-if="!isOm">
                <span class="xsec-lg"><i class="xsec-sw xsec-sw-liquid" />云水（液）</span>
                <span class="xsec-lg"><i class="xsec-sw xsec-sw-ice" />云冰</span>
              </template>
              <span v-else class="xsec-lg">
                <i class="xsec-sw xsec-sw-est" />RH 诊断云量（非模式云水，不能区分液/冰）
              </span>
              <span class="xsec-lg"><i class="xsec-sw xsec-sw-terrain" />模式地形</span>
              <span class="xsec-lg"><i class="xsec-sw xsec-sw-grid" />真实格点</span>
              <span class="xsec-lg"><i class="xsec-sw xsec-sw-sun" />太阳投影</span>
              <span class="xsec-lg xsec-lg-note">
                {{ isOm ? 'Open-Meteo 气压层 · ECMWF IFS 0.25°' : `GFS 0.25°` }} ·
                水平网格约 {{ index.gridApproxKm }} km · 采样 {{ index.sampleIntervalKm }} km ·
                虚线处是模式原始格点，格点之间为双线性插值
              </span>
            </div>

            <p class="xsec-disclaimer">
              本图展示太阳几何关系与模式云场，<b>未进行完整辐射传输计算</b>。
              <template v-if="isOm">
                Open-Meteo 的云量由相对湿度诊断估算，<b>不是模式原生云水/云冰</b>，
                高湿无云时可能误判，不能用来证明真实云体微物理结构。
              </template>
              <template v-else>
                云水/云冰是 GFS 预报变量而非观测。
              </template>
              地形使用模式地形（非真实 DEM），地形以下的层已遮罩。
            </p>
            <p v-if="sunWarning" class="xsec-warn">⚠ {{ sunWarning }}</p>
            <p v-if="stale" class="xsec-warn">
              ⚠ 这份剖面数据已经 {{ Math.round(dataAge) }} 小时没有更新，可能不是最新起报。
            </p>
          </div>

          <!-- 云层清单 + 数据说明 -->
          <div class="xsec-panels">
            <div class="card xsec-panel">
              <h2 class="xsec-panel-title">这条路径上有几层云</h2>
              <p class="xsec-panel-sub">
                取路径中点那一个格点，
                <template v-if="isOm">按「云量 ≥ 50%」判为有云（RH 诊断，估算）。</template>
                <template v-else>按「总凝结水 ≥ 10 mg/kg」判为有云。</template>
                <span v-if="!bandList.length">这一时刻路径中段没有达到该阈值的云。</span>
              </p>
              <ul v-if="bandList.length" class="xsec-bands">
                <li v-for="(b, i) in bandList" :key="i">
                  <span
                    class="xsec-band-dot"
                    :class="b.estimated ? 'is-est' : (b.liquid ? 'is-liquid' : 'is-ice')"
                  />
                  {{ b.toHpa }}–{{ b.fromHpa }} hPa
                  <span class="xsec-band-h">（{{ b.toKm.toFixed(1) }}–{{ b.fromKm.toFixed(1) }} km）</span>
                  <span class="xsec-band-kind">
                    {{ b.estimated ? '湿度诊断云量' : (b.liquid ? '含液水' : '冰云为主') }}
                  </span>
                  <span v-if="!b.estimated" class="xsec-band-peak">
                    峰值 {{ Math.round(b.peakMgKg) }} mg/kg
                  </span>
                </li>
              </ul>
            </div>

            <div class="card xsec-panel xsec-panel-data">
              <h2 class="xsec-panel-title">数据来源与已知误差</h2>
              <dl class="xsec-dl">
                <dt>数据源</dt>
                <dd>{{ activeFile.model }}</dd>
                <template v-if="!isOm">
                  <dt>起报 / 更新</dt>
                  <dd>{{ beijingDateTime(index.cycle) }} → {{ beijingDateTime(index.generatedAt) }}（北京）</dd>
                  <dt>有效时刻</dt>
                  <dd>
                    {{ times.map((t) => beijingTime(t.utc)).join(' / ') }}
                    （预报时效 {{ times[0]?.leadHours }}–{{ times[times.length - 1]?.leadHours }} h）
                  </dd>
                  <dt>云判据</dt>
                  <dd>{{ index.thresholds.variable }}，{{ index.thresholds.reference }}</dd>
                </template>
                <template v-else>
                  <dt>数据来源</dt>
                  <dd>Open-Meteo 气压层接口（模型 {{ activeFile.model }}），浏览器实时请求，未缓存</dd>
                  <dt>云量性质</dt>
                  <dd>由相对湿度诊断估算，无云水/云冰字段；不能与 GFS 云水直接比较数值</dd>
                </template>
                <dt>水平分辨率</dt><dd>{{ activeFile.gridKm }} km（0.25°，50 km 内只有 2–4 个真实格点）</dd>
                <dt>垂直坐标</dt><dd>逐格点逐层位势高度（不是固定压高表换算）</dd>
                <dt>垂直速度</dt>
                <dd>
                  <template v-if="isOm">Open-Meteo 原生 m/s，已按 ω = −ρg·w 换算为 Pa/s（保留换算说明）</template>
                  <template v-else>GFS 原生 Pa/s，未换算成 m/s</template>
                </dd>
                <dt>缺测</dt><dd>显示为缺测 / 遮罩，绝不按 0 处理</dd>
              </dl>
              <ul class="xsec-known">
                <li>模式预报有不确定性；插值不会提高原始分辨率。</li>
                <li>云是「模式认为云在哪」，不是卫星或雷达实测。</li>
                <li>太阳光线只是二维投影，不是三维光路，也不是辐射传输。</li>
              </ul>
            </div>
          </div>
        </template>
      </template>
    </div>
  </section>
</template>

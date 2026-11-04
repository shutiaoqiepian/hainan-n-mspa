/* ============================================================
   剖面云属识别（给 /cross 大气截面图用）
   ------------------------------------------------------------
   为什么单独一份、不改用 src/lib/forecast/clouds.ts：
     那份吃的是 Open-Meteo 的气压层「诊断量」（云量 + 湿度 + 降水概率 + CAPE），
     因为 Open-Meteo 没有云水/云冰，只能靠这些间接量猜云属。
     而剖面页手里有 **GFS 的真三维云水/云冰（CLWMR / ICMR）**，
     液/冰比例可以直接量出来 —— 这是判云属更硬的证据：
       冰晶为主 + 高空 → 卷云族
       液态为主 + 低空 → 层积云 / 层云
       混合相 + 中空   → 高积云 / 高层云

   覆盖 **WMO 国际云图十大云属**（一个都不漏）：
     高云族  Cirrus 卷云（Ci）/ Cirrostratus 卷层云（Cs）/ Cirrocumulus 卷积云（Cc）
     中云族  Altocumulus 高积云（Ac）/ Altostratus 高层云（As）/ Nimbostratus 雨层云（Ns）
     低云族  Stratocumulus 层积云（Sc）/ Stratus 层云（St）/ Cumulus 积云（Cu）/
             Cumulonimbus 积雨云（Cb）
   能再细分的给到**云种**（species）：钩卷云、密卷云、透光高积云、堡状高积云、
   浓积云、秃积雨云……判不出云种就不写，不硬凑。

   分族用气压而不是高度：剖面文件里 hM 可能缺测，而气压层是固定的
   （1000/925/850/700/600/500/400/300/200 hPa）。
     低云族：> 700 hPa（约 < 3 km）
     中云族：700–500 hPa（约 3–5.9 km）
     高云族：< 500 hPa（约 > 5.9 km）

   统一显示格式：**学名（英文缩写）**，如「卷云（Ci）」。

   ★ 这是「解释层」，不参与 scoreOf()、不影响排名（与剖面系统同一条硬约束）。
   ============================================================ */

export type CloudFamily = 'low' | 'mid' | 'high'

export interface CloudGenusInfo {
  /** WMO 英文缩写：Ci / Cs / Cc / Ac / As / Ns / Sc / St / Cu / Cb */
  code: string
  /** WMO 英文全名：Cirrus / Cirrostratus / …（放在 title 里） */
  codeEn: string
  /** 中文云属名 */
  genus: string
  /** 云种（species），如「钩卷云」；判不出为 null */
  species: string | null
  /** 云种英文，如「Cirrus uncinus」；判不出为 null */
  speciesEn: string | null
  family: CloudFamily
  /** 族名：高云族 / 中云族 / 低云族 */
  familyName: string
  /** 对拍霞意味着什么（摄影师向的一句话） */
  note: string
  /** 判据是否可靠：'solid' = 有云水数据；'guess' = 只能靠云量/湿度推断 */
  evidence: 'solid' | 'guess'
}

const FAMILY_NAME: Record<CloudFamily, string> = {
  low: '低云族',
  mid: '中云族',
  high: '高云族'
}

/** 判云属所需的单层数据（全部允许 null = 缺测） */
export interface GenusInput {
  hPa: number
  tC: number | null
  rhPct: number | null
  clwMgKg: number | null
  iciMgKg: number | null
  cfPct: number | null
  wPaS: number | null
  rainMmH: number | null
}

function familyOf(hPa: number): CloudFamily {
  if (hPa > 700) return 'low'
  if (hPa > 500) return 'mid'
  return 'high'
}

/** 「学名（缩写）」——全站统一的云属写法 */
export function genusLabel(g: Pick<CloudGenusInfo, 'genus' | 'code'>): string {
  return `${g.genus}（${g.code}）`
}

/**
 * 判一层的云属。返回 null = 这一层没云（或数据不足以下结论）。
 *
 * 「有云」的门槛：
 *   · 有云水数据时看真实凝结水 q = clw + ici：≥ 5 mg/kg 就算这一层有云
 *     （1 mg/kg 是薄纱，10 mg/kg 才是图上能辨识的云体，取 5 作为「有」的门槛）
 *   · 云水缺测时退回「云量 ≥ 30% 且湿度 ≥ 70%」，并标记 evidence = 'guess'
 */
export function genusOfLevel(lv: GenusInput): CloudGenusInfo | null {
  const { hPa, clwMgKg, iciMgKg, cfPct, rhPct, tC, wPaS, rainMmH } = lv

  const hasQ = clwMgKg !== null || iciMgKg !== null
  const q = (clwMgKg ?? 0) + (iciMgKg ?? 0)
  const cf = cfPct

  let cloud = false
  let evidence: 'solid' | 'guess' = 'solid'
  if (hasQ) {
    cloud = q >= 5
    /* 凝结水很少但云量很大：仍在云里（模式把云摊薄了），算有云 */
    if (!cloud && cf !== null && cf >= 30 && (rhPct ?? 0) >= 70) {
      cloud = true
      evidence = 'guess'
    }
  } else if (cf !== null) {
    cloud = cf >= 30 && (rhPct ?? 0) >= 70
    evidence = 'guess'
  }
  if (!cloud) return null

  const family = familyOf(hPa)
  const familyName = FAMILY_NAME[family]
  const iceFrac = q > 0 ? (iciMgKg ?? 0) / q : null
  /* 温度也能佐证：低于 −25 ℃ 基本不可能有液态水（过冷水也有，但少） */
  const cold = tC !== null && tC <= -25
  const icy = iceFrac === null ? cold : iceFrac >= 0.8 || (cold && iceFrac >= 0.5)
  /** 纯冰：冰占比 ≥ 95%，用来区分「冰晶云」和「混合相」 */
  const solidIce = iceFrac !== null && iceFrac >= 0.95

  const cover = cf ?? 0
  const rh = rhPct ?? 0
  const rising = wPaS !== null && wPaS < -0.3 /* GFS 的 ω：负 = 上升 */
  const strongRise = wPaS !== null && wPaS < -1.0
  const raining = rainMmH !== null && rainMmH > 0.1

  const mk = (
    code: string, codeEn: string, genus: string,
    species: string | null, speciesEn: string | null, note: string
  ): CloudGenusInfo => ({
    code, codeEn, genus, species, speciesEn, family, familyName, note, evidence
  })

  /* ---------------- 高云族（> 5.9 km） ---------------- */
  if (family === 'high') {
    /* ★ 先分「冰晶云」和「混合相」，不能只按温度判：
       卷积云（Cc）恰恰是高空小云块、边缘带过冷水（液占比可以到 15–40%），
       如果因为「-50 ℃ 一定纯冰」就一律判成卷云，卷积云永远判不出来。
       实测构造 iceFrac=0.75 的层，旧逻辑判成了「卷云（Ci） · 密卷云」。*/
    const mixedPhase = iceFrac !== null && iceFrac < 0.85
    if (!mixedPhase && (icy || iceFrac !== null)) {
      if (cover >= 60) {
        /* 卷层云：成片薄幕。很薄且高湿 → 毛卷层云 */
        return rh >= 70
          ? mk('Cs', 'Cirrostratus', '卷层云', '毛卷层云', 'Cirrostratus fibratus',
            '成片的薄幕，能把整片天染成一层色——火烧云最理想的画布')
          : mk('Cs', 'Cirrostratus', '卷层云', '薄幕卷层云', 'Cirrostratus nebulosus',
            '薄幕状铺满天空，整片点亮，颜色均匀')
      }
      if (solidIce && cover < 25) {
        return mk('Ci', 'Cirrus', '卷云', '毛卷云', 'Cirrus fibratus',
          '丝缕状薄云，日落后十几分钟仍被照亮，偏粉紫')
      }
      if (cover >= 40) {
        return mk('Ci', 'Cirrus', '卷云', '密卷云', 'Cirrus spissatus',
          '较厚的卷云块，能接住夕阳的橙色，但不会整片烧起来')
      }
      return rh < 32
        ? mk('Ci', 'Cirrus', '卷云', '钩卷云', 'Cirrus uncinus',
          '带钩的丝缕，是高空风的指示牌；厚度薄，容易被点成粉紫')
        : mk('Ci', 'Cirrus', '卷云', '絮状卷云', 'Cirrus floccus',
          '小团絮状冰晶云，容易被夕阳点成亮橙色')
    }
    /* 高空出现明显液态/混合相 —— 这类小云块是卷积云 */
    return mk('Cc', 'Cirrocumulus', '卷积云',
      cover > 55 ? '鱼鳞状卷积云' : '絮状卷积云',
      cover > 55 ? 'Cirrocumulus stratiformis' : 'Cirrocumulus floccus',
      cover > 55
        ? '鱼鳞/排骨状排列，夕阳斜照时像撒了一把碎金'
        : '成团的小云块，容易被夕阳点成亮橙色')
  }

  /* ---------------- 中云族（3–5.9 km） ---------------- */
  if (family === 'mid') {
    if (raining && cover >= 60) {
      return mk('Ns', 'Nimbostratus', '雨层云', null, null,
        '厚而均匀、正在下雨——通常把太阳整片挡掉，不利出片')
    }
    if (cover >= 60) {
      return rh >= 85
        ? mk('As', 'Altostratus', '高层云', '蔽光高层云', 'Altostratus opacus',
          '灰白厚幕、几乎不透光，日落往往被压成一片暗灰')
        : mk('As', 'Altostratus', '高层云', '透光高层云', 'Altostratus translucidus',
          '薄处能透出暗橙的光，厚处一片灰——出片要看缝')
    }
    /* 堡状高积云：中层有对流泡，摄影上很值得等 */
    if (strongRise && cover >= 25 && cover < 60) {
      return mk('Ac', 'Altocumulus', '高积云', '堡状高积云', 'Altocumulus castellanus',
        '像一排城垛的中云，说明中层不稳定；容易被夕阳点成橘红')
    }
    return cover >= 40
      ? mk('Ac', 'Altocumulus', '高积云', '透光高积云（俗称鱼鳞云）', 'Altocumulus translucidus',
        '成片的中云，日落时常常整片变成橘红——最出片的一类')
      : mk('Ac', 'Altocumulus', '高积云', '絮状高积云', 'Altocumulus floccus',
        '零散的中云块，容易被点亮')
  }

  /* ---------------- 低云族（< 3 km） ---------------- */
  if (strongRise && raining) {
    return mk('Cb', 'Cumulonimbus', '积雨云', '秃积雨云', 'Cumulonimbus calvus',
      '强对流云塔、伴随阵雨——云体高耸，一般把西边挡死')
  }
  if (rising && cover <= 60) {
    if (strongRise) {
      return mk('Cu', 'Cumulus', '积云', '浓积云', 'Cumulus congestus',
        '高耸的积云，云底低且厚——西边有它就直接挡掉低角度阳光')
    }
    return cover >= 30
      ? mk('Cu', 'Cumulus', '积云', '中积云', 'Cumulus mediocris',
        '一团团鼓起来的云，中等厚度；西边成排出现会挡住地平线那束光')
      : mk('Cu', 'Cumulus', '积云', '淡积云', 'Cumulus humilis',
        '扁平的小积云，一般不挡光，天气好的标志')
  }
  if (raining && cover >= 75) {
    return mk('Ns', 'Nimbostratus', '雨层云', null, null,
      '正在下雨的低厚云，把太阳压进云里——基本不用去了')
  }
  if (cover >= 50) {
    return cover >= 85
      ? mk('Sc', 'Stratocumulus', '层积云', '蔽光层积云', 'Stratocumulus opacus',
        '铺满低空的厚层积云，会把太阳提前压进云里')
      : mk('Sc', 'Stratocumulus', '层积云', '透光层积云（俗称排骨云）', 'Stratocumulus translucidus',
        '成片/波状的低云，西边少的话反而能透出光缝')
  }
  return rh >= 96
    ? mk('St', 'Stratus', '层云', '碎层云', 'Stratus fractus',
      '被风撕开的低碎云，能见度差、易挡地平线')
    : mk('St', 'Stratus', '层云', '薄幕层云', 'Stratus nebulosus',
      '低而均匀的灰层，能见度差；西边有它就会挡住地平线那束光')
}

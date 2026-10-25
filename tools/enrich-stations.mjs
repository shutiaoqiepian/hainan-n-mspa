import { readFile, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'

/**
 * 给机场站点表补「中文城市名 + 机位库省份」
 *
 *   node tools/enrich-stations.mjs            # 只看，不写
 *   node tools/enrich-stations.mjs --write
 *
 * 为什么：OurAirports 只有英文机场名，要做「<城市>机场观测点」
 * 就得知道它属于哪座城市、对应机位库里的哪个省（决定进哪张省级缓存）。
 *
 * ★ 省份必须来自人工表，不能「用最近机位推」：
 *   ICAO 前缀根本不按省分（河北的正定机场是 ZBSJ、湖南的张家界是 ZGDY），
 *   拿最近机位推会出现「北海机场 → 黔南 / 广西」这种错。
 *
 * 收站规则：只收「机位库里有这个省」的机场，且离最近机位 ≤300 km。
 * 小机场（不是主要城市）一律不收 —— 观测点太多会把预报列表淹没。
 *
 * 幂等：已有 city/prov 的条目保留，只补缺的。
 */

const ROOT = process.cwd()
const STATIONS = ROOT + '/data/obs/stations-cn.json'
const SPOTS = ROOT + '/src/data/forecast/spots.json'

/** ICAO → [城市, 省份 key]。省份 key 必须能在 spots.json 里找到。 */
const CITY = {
  /* 海南 */
  ZJHK: ['海口', 'hn'], ZJSY: ['三亚', 'hn'], ZJQH: ['琼海', 'hn'],
  /* 广东 */
  ZGGG: ['广州', 'gd'], ZGSZ: ['深圳', 'gd'], ZGSD: ['珠海', 'gd'],
  ZGOW: ['揭阳', 'gd'], ZGFS: ['佛山', 'gd'], ZGZJ: ['湛江', 'gd'],
  ZGSG: ['韶关', 'gd'], ZGHZ: ['惠州', 'gd'], ZGYY: ['岳阳', 'gd'],
  ZGKL: ['桂林', 'gx'], ZGNN: ['南宁', 'gx'], ZGBH: ['北海', 'gx'],
  ZGHA: ['长沙', 'hu'], ZGDY: ['张家界', 'hu'], ZHCC: ['郑州', 'ha'],
  ZHLY: ['洛阳', 'ha'],
  /* 华东 */
  ZSPD: ['上海', 'sh'], ZSSS: ['上海', 'sh'],
  ZSNJ: ['南京', 'js'], ZSWX: ['无锡', 'js'], ZSCG: ['常州', 'js'],
  ZSNT: ['南通', 'js'], ZSYA: ['扬州', 'js'], ZSXZ: ['徐州', 'js'],
  ZSHC: ['杭州', 'zj'], ZSNB: ['宁波', 'zj'], ZSYW: ['义乌', 'zj'],
  ZSWZ: ['温州', 'zj'], ZSZS: ['舟山', 'zj'], ZSJU: ['衢州', 'zj'],
  ZSJX: ['嘉兴', 'zj'],
  ZSOF: ['合肥', 'ah'], ZSTX: ['黄山', 'ah'], ZSAQ: ['安庆', 'ah'],
  ZSAM: ['厦门', 'fj'], ZSFZ: ['福州', 'fj'], ZSQZ: ['泉州', 'fj'],
  ZSWY: ['武夷山', 'fj'], ZSSM: ['三明', 'fj'], ZSCN: ['南昌', 'jx'],
  ZSJD: ['景德镇', 'jx'], ZSGS: ['井冈山', 'jx'], ZSSR: ['上饶', 'jx'],
  ZSYC: ['宜春', 'jx'], ZSJN: ['济南', 'sd'], ZSQD: ['青岛', 'sd'],
  ZSYT: ['烟台', 'sd'], ZSWH: ['威海', 'sd'], ZSLY: ['临沂', 'sd'],
  ZSJG: ['济宁', 'sd'], ZSDY: ['东营', 'sd'], ZSRZ: ['日照', 'sd'],
  ZSWH2: ['', ''],
  /* 华北 */
  ZBAA: ['北京', 'bj'], ZBAD: ['北京', 'bj'],
  ZBTJ: ['天津', 'tj'],
  ZBSJ: ['石家庄', 'he'], ZBCD: ['承德', 'he'], ZBDH: ['秦皇岛', 'he'],
  ZBHD: ['邯郸', 'he'], ZBZJ: ['张家口', 'he'],
  ZBYN: ['太原', 'sx'], ZBDT: ['大同', 'sx'], ZBYC: ['运城', 'sx'],
  ZBLF: ['临汾', 'sx'], ZBLL: ['吕梁', 'sx'], ZBSG: ['朔州', 'sx'],
  ZBHH: ['呼和浩特', 'nm'], ZBOW: ['包头', 'nm'], ZBLA: ['呼伦贝尔', 'nm'],
  ZBDS: ['鄂尔多斯', 'nm'], ZBCF: ['赤峰', 'nm'], ZBTL: ['通辽', 'nm'],
  ZBXH: ['锡林浩特', 'nm'], ZBUC: ['乌兰察布', 'nm'], ZBUH: ['乌海', 'nm'],
  ZBER: ['二连浩特', 'nm'], ZBHD2: ['', ''],
  /* 华中 */
  ZHHH: ['武汉', 'hb'], ZHYC: ['宜昌', 'hb'], ZHES: ['恩施', 'hb'],
  ZHXF: ['襄阳', 'hb'], ZHSY: ['十堰', 'hb'], ZHEC: ['鄂州', 'hb'],
  ZGHA2: ['', ''],
  /* 西南 */
  ZUCK: ['重庆', 'cq'], ZUGU: ['广元', 'cq'], ZUWL: ['武隆', 'cq'],
  ZUUU: ['成都', 'sc'], ZUTF: ['成都', 'sc'], ZUMY: ['绵阳', 'sc'],
  ZUDC: ['稻城', 'sc'], ZUJZ: ['九寨沟', 'sc'], ZUKD: ['康定', 'sc'],
  ZULZ: ['泸州', 'sc'], ZUYB: ['宜宾', 'sc'], ZUZH: ['攀枝花', 'sc'],
  ZUXC: ['西昌', 'sc'],
  ZUGY: ['贵阳', 'gz'], ZUAS: ['安顺', 'gz'], ZUBJ: ['毕节', 'gz'],
  ZUKJ: ['凯里', 'gz'], ZUMT: ['遵义', 'gz'], ZUPS: ['六盘水', 'gz'],
  ZUZY: ['遵义', 'gz'], ZUYI: ['兴义', 'gz'],
  ZPPP: ['昆明', 'yn'], ZPDL: ['大理', 'yn'], ZPLJ: ['丽江', 'yn'],
  ZPHS: ['西双版纳', 'yn'], ZPZT: ['昭通', 'yn'], ZPSM: ['普洱', 'yn'],
  ZPBS: ['保山', 'yn'], ZPDQ: ['迪庆', 'yn'], ZPWS: ['文山', 'yn'],
  ZPMS: ['德宏', 'yn'], ZPJH2: ['', ''],
  ZULS: ['拉萨', 'xz'], ZUNZ: ['林芝', 'xz'], ZUDR: ['日喀则', 'xz'],
  ZUAL: ['阿里', 'xz'], ZUBD: ['昌都', 'xz'],
  /* 西北 */
  ZLXY: ['西安', 'sn'], ZLYA: ['延安', 'sn'], ZLYL: ['榆林', 'sn'],
  ZLHZ: ['汉中', 'sn'], ZLTS: ['天水', 'sn'], ZLQY: ['庆阳', 'sn'],
  ZLYS2: ['', ''],
  ZLLL: ['兰州', 'gs'], ZLJQ: ['嘉峪关', 'gs'], ZLDH: ['敦煌', 'gs'],
  ZLZY: ['张掖', 'gs'], ZLIC: ['银川', 'nx'], ZLZW: ['中卫', 'nx'],
  ZLGY: ['固原', 'nx'],
  ZLXN: ['西宁', 'qh'], ZLGM: ['格尔木', 'qh'], ZLDL: ['德令哈', 'qh'],
  ZLLN2: ['', ''],
  ZWWW: ['乌鲁木齐', 'xj'], ZWYN: ['伊宁', 'xj'], ZWKN: ['喀纳斯', 'xj'],
  ZWSH: ['喀什', 'xj'], ZWHM: ['哈密', 'xj'], ZWAK: ['阿克苏', 'xj'],
  ZWTN: ['和田', 'xj'], ZWKL: ['库尔勒', 'xj'], ZWAT: ['阿勒泰', 'xj'],
  ZWBL: ['博乐', 'xj'], ZWTL: ['吐鲁番', 'xj'], ZWNL: ['新源', 'xj'],
  ZWFY2: ['', ''],
  /* 东北 */
  ZYTX: ['沈阳', 'ln'], ZYTL: ['大连', 'ln'], ZYDD: ['丹东', 'ln'],
  ZYAS: ['鞍山', 'ln'], ZYJZ: ['锦州', 'ln'], ZYYK: ['营口', 'ln'],
  ZYCC: ['长春', 'jl'], ZYJL: ['吉林', 'jl'], ZYBS: ['长白山', 'jl'],
  ZYTN: ['通化', 'jl'], ZYJX2: ['', ''],
  ZYHB: ['哈尔滨', 'hl'], ZYMH: ['漠河', 'hl'], ZYMD: ['牡丹江', 'hl'],
  ZYQQ: ['齐齐哈尔', 'hl'], ZYJM: ['佳木斯', 'hl'], ZYLD: ['伊春', 'hl'],
  ZYDQ: ['大庆', 'hl'], ZYHE: ['黑河', 'hl'], ZYJX3: ['', ''],
  /* 港澳台 */
  VHHH: ['香港', 'hk'], VMMC: ['澳门', 'mo'],
  RCTP: ['台北', 'tw'], RCSS: ['台北', 'tw'], RCKH: ['高雄', 'tw'],
  RCKU: ['嘉义', 'tw']
}

function km(aLat, aLon, bLat, bLon) {
  const R = 6371
  const dLat = (bLat - aLat) * Math.PI / 180
  const dLon = (bLon - aLon) * Math.PI / 180
  const y = Math.sin(dLat / 2) ** 2 + Math.cos(aLat * Math.PI / 180) * Math.cos(bLat * Math.PI / 180) * Math.sin(dLon / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(y))
}

const table = JSON.parse(await readFile(STATIONS, 'utf8'))
const spots = JSON.parse(await readFile(SPOTS, 'utf8'))
const list = Array.isArray(spots) ? spots : spots.spots
const realSpots = list.filter((s) => !s.n.includes('机场观测点'))
const provs = new Set(realSpots.map((s) => s.prov))

let filled = 0
const rows = []
const unknown = []
const tooFar = []

for (const st of table.stations) {
  if (st.city && st.prov) continue
  const hit = CITY[st.id]
  if (!hit || !hit[1]) { unknown.push(st.id + ' ' + st.name + '（人工表没收录）'); continue }
  const [city, prov] = hit
  if (!provs.has(prov)) { unknown.push(st.id + ' 省份 ' + prov + ' 不在机位库'); continue }

  let bestD = Infinity
  for (const s of realSpots) {
    if (s.prov !== prov) continue
    const d = km(st.lat, st.lon, s.lat, s.lon)
    if (d < bestD) bestD = d
  }
  if (bestD > 300) { tooFar.push(st.id + ' ' + city + ' 距最近机位 ' + Math.round(bestD) + 'km'); continue }

  st.city = city
  st.prov = prov
  filled++
  rows.push([st.id, city, prov, Math.round(bestD)])
}

rows.sort((a, b) => a[2].localeCompare(b[2]) || a[3] - b[3])
console.log('补齐 ' + filled + ' 个机场（人工核对过城市与省份）')
for (const r of rows) console.log('  ' + r[0] + '  ' + String(r[1]).padEnd(6, '　') + ' ' + r[2] + '  最近机位 ' + r[3] + 'km')
if (tooFar.length) { console.log('\n跳过（离同省机位 >300km）：'); for (const x of tooFar) console.log('  ' + x) }
if (unknown.length) { console.log('\n跳过（人工表未收录，或省份没有机位）：'); for (const x of unknown.slice(0, 40)) console.log('  ' + x) }

if (process.argv.includes('--write')) {
  await writeFile(STATIONS, JSON.stringify(table, null, 1), 'utf8')
  console.log('\n已写入 ' + STATIONS)
} else {
  console.log('\n（未写入。加 --write 才会改 stations-cn.json）')
}

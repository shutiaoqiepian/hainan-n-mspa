# 18N-MSPA · 北纬18度椰青摄联

![海口世纪大桥火烧云](images/readme-cover.jpg)

海南省北纬18度椰青摄影联盟（18° North – Hainan Mass Student / Senior Photographers Association）的官方网站。

**线上地址**：https://hainan-n-mspa.pages.dev

技术栈：**Vue 3 + TypeScript + Vite**（多页应用），构建产物仍是纯静态文件，没有后端、没有数据库。
七个页面各有自己的 HTML 入口，URL 与旧版完全一致（`index.html` / `about.html` / `gallery.html` /
`forecast.html` / `members.html` / `join.html` / `404.html`）。

> 接手开发请看 **[交接文档.md](交接文档.md)**：目录职责、四条不能违反的硬规矩、
> 回归比对工具、部署链路与踩坑记录都在里面。

## 本地开发

```bash
npm install
npm run dev        # http://localhost:5173，改代码即时热更新
npm run build      # 产物在 dist/
npm run preview    # 用 dist/ 起一个本地服务器，和线上一致
npm run typecheck  # vue-tsc 全量类型检查
```

> 旧版是「双击 index.html 就能看」；改成 Vite 项目后必须用上面两种方式之一，
> 直接双击 HTML 会因为浏览器对 ES Module / 跨域的限制而白屏。

## 发布流程

```
本地改代码 → push 到 GitHub → Cloudflare Pages 跑 npm run build → 发布 dist/
```

Cloudflare Pages 的构建配置需要是：

| 项 | 值 |
|---|---|
| 构建命令（Build command） | `npm run build` |
| 输出目录（Build output directory） | `dist` |

- 仓库根目录**不再**是可直接发布的目录，线上内容一律来自 `dist/`
- `images/`、`data/`、`robots.txt`、`sitemap.xml`、`_headers` 仍留在仓库根目录，
  由 `tools/plugins/root-static.ts` 在开发时直通、构建时原样拷进 `dist/`
  （这样图片压缩脚本、GitHub Action 写缓存、`.gitignore` 规则都不用改）
- `_headers` 里的 `/images/*`（7 天）、`/assets/*`（1 天）缓存规则继续生效：
  HTML 里的 `images/...` 引用不会被 Vite 改写成带哈希的资源

## 目录结构

```
.
├── index.html / about.html / gallery.html / forecast.html / members.html / join.html / 404.html
│                              # 七个入口：<head> 里保留全部 SEO / og 元信息，<body> 只有 #app 挂载点
├── src/
│   ├── entries/               # 每个 HTML 一个入口，调用 createPage(页面组件)
│   ├── app/                   # AppShell（导航+main+页脚+轻提示）与 createPage
│   ├── pages/                 # 七个页面组件
│   ├── components/            # layout / media / members / forecast / gallery …
│   ├── composables/           # useReveal（滚动淡入）、useToast、useLightbox、useCopyText
│   ├── data/                  # 站点文案、作品清单、成员名录、预报机位与模式
│   ├── lib/                   # 预报算法（scoring/sun/api…）、名片 canvas 绘制
│   ├── vendor/                # 第三方库（qrcode.js，Kazuhiko Arase, MIT）
│   └── styles/                # 由旧 style.css 按原行序切分的样式模块
├── images/                    # 压缩后的照片（长边 ≤1800px）+ thumbs/ 缩略图（800px）
├── data/forecast.json         # 预报静态缓存（GitHub Actions 每 4 小时写一次）
├── tools/                     # build-cache.mjs、图片压缩脚本、回归比对脚本
├── robots.txt / sitemap.xml / _headers
└── LICENSE
```

## 功能

- **首页 / 关于 / 成员 / 加入我们** — 社团介绍、成员名录、入群与投稿指南
- **作品集** — 瀑布流作品墙，按分类筛选，点击看大图（灯箱）；图片走缩略图，原图另开
- **霞光预报** — 25 个海南机位（海口 10 个，按朝向细分到东向朝霞 / 西向晚霞），
  覆盖 **今天·明天 × 日出·日落** 四个时段，切换不重新请求；
  评分是高云 × 低云 × 中云 × AOD × 降水 的乘法结构，再按太阳方位角与模式分歧修正；
  数据来自 [Open-Meteo](https://open-meteo.com/)（免费、无需 Key）

## 零回归约定

改成组件化之后，**页面观感与交互必须与旧版完全一致**。为此有三条硬规矩：

1. **模板里的 class 名与 DOM 结构照抄旧 HTML** —— 样式表是按旧 HTML 写的，class 一变样式就丢
2. **`src/styles/index.css` 里的 @import 顺序不能改** —— 那正是旧 `style.css` 的行序，
   层叠优先级依赖它（「移动端修补」在页面样式之后、「成员页」样式在最后）
3. **模板里的图片路径写字面量**（`src="images/x.jpg"`）—— 一旦被当模块引入就会生成带哈希的副本，
   与 `/images/*` 的缓存头、首屏 preload 都会对不上

回归比对脚本（改完跑一下，逐页比对改造前后的 DOM 结构、文本、整页截图逐像素）：

```bash
npm run build
node tools/compare-legacy.mjs            # 全部 7 页
node tools/compare-legacy.mjs gallery    # 只比某页
MASK_DIGITS=1 node tools/compare-legacy.mjs forecast   # 忽略随时间变化的数字
LEGACY_REF=<commit> node tools/compare-legacy.mjs      # 换一个基线提交
```

- 基线固定为迁移前的提交 `01d5019`（不是 HEAD，否则重构提交上去后就成了跟自己比）
- 旧站起在 4100、`dist/` 起在 4200，用本机 Chrome 无头模式比对，有任何差异都会非零退出
- 截图走 CDP：先在页面里滚到底把懒加载的图全部触发、等所有 `<img>` 解码完再整页截图。
  作品集有 40 张图，用 CLI 的 `--screenshot` 只拍视口会出现几十万像素的假差异
- 依赖本机的 `google-chrome` 与 ImageMagick 的 `compare`

## 预报数据缓存

`data/forecast.json` 由 GitHub Actions 定时生成（每 4 小时一次，见 `.github/workflows/forecast-cache.yml`），
页面优先读这个静态文件，读不到或超过 14 小时才回退到 Open-Meteo 实时请求。

手动生成：`node tools/build-cache.mjs`

## 成员页

成员数据在 `src/data/members.ts`：`group` 区分 `core`（小组成员）与 `community`（交流群成员），
`titles` 是头衔。作品通过 `src/data/photos.ts` 的 `a` 字段（作者名）自动关联到成员卡。

每个成员可以生成一张 1080×1350 的名片（名字 + 头衔 + 作品 + 个人主页二维码 + 公众号二维码），
由 `src/vendor/qrcode.ts`（Kazuhiko Arase, MIT）在浏览器本地生成，不需要后端。

## 添加作品

1. 把照片放进 `images/`，跑一次 `tools/optimize-images.ps1`（Windows 下双击 `3-压缩新图片.bat`）压缩并生成缩略图
2. 在 `src/data/photos.ts` 里加一行：

```ts
{ f: '文件名.jpg', t: '标题', c: '海岸风光', a: '作者' },
```

`c` 只能是 `海岸风光` / `城市夜色` / `民俗人文` / `星空银河` / `航拍视角`。

## 添加预报机位

改 `src/data/forecast/spots.ts` 的 `SPOTS`：

```ts
{ n: '机位名', lat: 20.026, lon: 110.285, face: '西', area: '海口' },
```

`face` 取值：`东` / `东南` / `南` / `西南` / `西` / `西北` / `北` / `山顶`。
`area` 取值：`海口` / `东岸` / `西岸` / `南部` / `中部`。

> 机位表在 `tools/build-cache.mjs` 里另有一份副本（那个脚本是纯 Node ESM，import 不了 `.ts`）。
> 两边不同步时 `node tools/build-cache.mjs` 会直接报错并列出差异，不会悄悄生成缺机位的缓存。

## 关于授权 / License

- **代码**（HTML / CSS / TypeScript / Vue 组件）采用 **GNU General Public License v2.0**，见 [LICENSE](LICENSE)。
  可以自由使用、修改、再分发；如果你对外发布修改后的版本，源码也需要以 GPL-2.0 开放。
- **照片**（`images/` 全部内容，含 `thumbs/`）、**社团标识与二维码**（`mspa*.png`、`nmspa.png`、`二维码.jpg`）
  **版权归各摄影师与 18N-MSPA 所有，保留所有权利，不在 GPL 范围内**。
  需要转载或商用请联系公众号「北纬18度椰青摄联」。

---

© 北纬18度椰青摄联 18N-MSPA · 海南省海口市

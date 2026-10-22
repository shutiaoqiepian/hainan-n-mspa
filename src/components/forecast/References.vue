<script setup lang="ts">
/** 参考文献（10 条）与免责说明，纯静态（旧版 .fc-refs） */
</script>

<template>
      <details class="fc-refs glass">
        <summary>参考文献与方法来源（10 条）</summary>
        <ol>

          <li>
            张帅, 吴捷, 陈敏, 仲跻芹, 黄向宇, 卢冰, 杨扬.
            CMA-BJ 系统总云量预报性能检验评估[J]. 气象, 2024, 50(9): 1057–1070.
            DOI: 10.7519/j.issn.1000-0526.2024.063001.
            <a href="http://qxqk.nmc.cn/qx/ch/reader/view_abstract.aspx?file_no=20240903&amp;flag=1" target="_blank" rel="noopener">查看原文</a>
            <span class="ref-note">
              用于：1 天时效真实技巧评分 TCC 仅 0.47、有技巧预报上限 48–72 h → 整体 1.8 次方压缩与时效折扣；
              模式相对湿度偏小会造成云量低估 → 湿度剖面阈值放宽至 80%。
            </span>
          </li>

          <li>
            MetCoOp (Met Norway), 2012. Verification of cloud forecasts.
            <a href="https://www.met.no/en/projects/metcoop/publications/_/attachment/inline/70164a86-e9de-4ef2-88d3-6df5ad6d9d82:3e4aabae7016e8a034ef84018938c84a9b890d48/2012-01-MetCoOp_MEMO.pdf" target="_blank" rel="noopener">报告原文</a>
            <span class="ref-note">
              用于：ECMWF、AROME 等模式会高估“无云”出现频率，报晴不代表真晴 →
              因此高云为 0 时不做硬性归零，低端保留缓坡。
            </span>
          </li>

          <li>
            SunsetBot 团队. 火烧云定量预报速成（长三角适用）· 第一章节：大气科学常识、几何知识、光谱消光.
            <a href="https://www.sunsetbot.top/halo/posts/2026/huo-shao-yun-yu-bao-jiao-cheng-zhang-jie-yi/" target="_blank" rel="noopener">原文</a>
            <span class="ref-note">
              用于：火烧云静态几何模型（阳光需从云底下方照上来）、霞光深入距离、
              瑞利散射与米散射对色彩饱和度的不同影响 → 解释为何 AOD 低才“通透”。
            </span>
          </li>

          <li>
            SunsetBot 团队. 同书 · 第二、三章节：云、气象观测知识、数据来源.
            <a href="https://www.sunsetbot.top/halo/posts/2026/huo-shao-yun-yu-bao-jiao-cheng-zhang-jie-er-san/" target="_blank" rel="noopener">原文</a>
            <span class="ref-note">
              用于：AOD 与通透度对照表（0.1 水晶天 / 0.2 湛蓝 / 0.3 较蓝 / 0.5 普通 / 0.8 有霾）；
              彩虹判据（虹总在太阳对面、太阳高度低于 42°、雨滴需大于 0.5 mm）；
              各类云对火烧云的不同贡献。
            </span>
          </li>

          <li>
            WMO. International Cloud Atlas（国际云图）, 2017 版.
            <a href="https://cloudatlas.wmo.int/" target="_blank" rel="noopener">cloudatlas.wmo.int</a>
            <span class="ref-note">
              用于：云属定义与高度分界（低云 &lt;2500 m、中云 2500–7000 m、高云 &gt;6000 m），
              对应把 850 / 700 / 500 / 400 hPa 划成低中高三层。
            </span>
          </li>

          <li>
            Open-Meteo. Weather Forecast API 文档.
            <a href="https://open-meteo.com/en/docs" target="_blank" rel="noopener">open-meteo.com/en/docs</a>
            <span class="ref-note">
              用于：全部预报变量的来源与定义（分层云量、2 m 湿度、降水概率、
              边界层高度、CAPE、各气压层相对湿度）。
            </span>
          </li>

          <li>
            Open-Meteo. Air Quality API（底层为 CAMS 再分析／预报）.
            <a href="https://open-meteo.com/en/docs/air-quality-api" target="_blank" rel="noopener">文档</a>
            <span class="ref-note">用于：气溶胶光学厚度 AOD 与 PM2.5 数据来源。</span>
          </li>

          <li>
            NOAA Global Monitoring Laboratory. Solar Calculator（太阳位置算法）.
            <a href="https://gml.noaa.gov/grad/solcalc/" target="_blank" rel="noopener">gml.noaa.gov/grad/solcalc</a>
            <span class="ref-note">
              用于：太阳高度角与方位角计算（本站用同一套低精度解析式），
              进而决定机位朝向匹配与彩虹判据。
            </span>
          </li>

          <li>
            Bohren, C. F. &amp; Huffman, D. R. <i>Absorption and Scattering of Light by Small Particles</i>.
            Wiley, 1983.
            <span class="ref-note">背景阅读：米散射与瑞利散射的经典教材，理解 AOD 为何影响色彩饱和度。</span>
          </li>

          <li>
            Petty, G. W. <i>A First Course in Atmospheric Radiation</i>. 2nd ed.
            Sundog Publishing, 2006.
            <span class="ref-note">背景阅读：大气辐射传输基础，云的光学厚度与透射率的定性关系。</span>
          </li>

        </ol>

        <p class="ref-disclaimer">
          <b>说明</b>：本站评分公式由上述材料中的结论组合而成，
          <b>并未经过同行评议或历史回测验证</b>。
          前两条文献给出的是“预报有多不准”，而不是“火烧云概率模型”——那种论文目前几乎不存在。
          真正的验证只能靠群友回填的实际结果。
        </p>
      </details>
</template>

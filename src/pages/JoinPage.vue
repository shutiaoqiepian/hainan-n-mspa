<script setup lang="ts">
import { ref } from 'vue'
import { ws } from '@/composables/useWhitespace'

/** 加入我们（对应旧版 join.html 的 <main> 内容 + 页尾内联脚本） */



/* 二维码图片还没放进来时，显示一个占位框，不出现裂图 */
const qrFailed = ref(false)

function onQrError(): void {
  qrFailed.value = true
}
</script>

<template>
<section class="page-head">
  <div class="wrap">
    <p class="eyebrow">Join Us</p>
    <h1 class="silver">入群 & 投稿全指南</h1>
    <p>{{ ws(8) }}欢迎来到海南北纬18度椰青摄影联盟。<br />{{ ws(8) }}我们是海南本土覆盖中学生至大学生的青年摄影交流创作平台，欢迎所有热爱摄影的同好加入。{{ ws(6) }}</p>
  </div>
</section>
<section class="section">
  <div class="wrap">
    <div class="section-head reveal">
      <p class="eyebrow">Benefits</p>
      <h2 class="silver">加入权益</h2>
    </div>
    <div class="grid-4">
      <div class="card glass reveal" data-delay="0">
        <h3 style="margin-top:0">线上投稿与赛事</h3>
        <p>线上主题投稿、专业摄影赛事，作品展示通道。</p>
      </div>
      <div class="card glass reveal" data-delay="60">
        <h3 style="margin-top:0">线下实拍</h3>
        <p>线下实拍采风、同好交流活动。</p>
      </div>
      <div class="card glass reveal" data-delay="120">
        <h3 style="margin-top:0">机位共享</h3>
        <p>海南本地私藏摄影机位资源共享。</p>
      </div>
      <div class="card glass reveal" data-delay="180">
        <h3 style="margin-top:0">成长空间</h3>
        <p>摄影干货、器材交流、成长进阶空间。</p>
      </div>
    </div>
  </div>
</section>
<section class="section" style="padding-top:0">
  <div class="wrap">
    <div class="two-col">
      <div class="reveal">
        <p class="eyebrow">How to join</p>
        <h2 class="silver" style="margin:0 0 26px;font-size:clamp(24px,3.2vw,34px)">如何加入我们？</h2>
        <div class="prose">
          <p>目前有两个群：</p>
          <ul>
            <li><b>交流群（大群）</b>：海南北纬18度椰青摄影联盟</li>
            <li><b>核心成员小群</b>（暂无申请渠道）</li>
          </ul>
          <p>{{ ws(14) }}仅支持通过微信审核入大群。你可以添加任意一位审核员微信，完成入群申请即可。{{ ws(12) }}</p>
          <p class="join-tip">{{ ws(14) }}<b>获取管理员微信</b>：请点开公众号私信 <b class="grad">【我要加入】</b>{{ ws(12) }}</p>
        </div>
      </div>
      <div class="reveal" data-delay="120">
        <div class="glass" style="padding:32px 30px">
          <p class="eyebrow" style="margin-bottom:18px">审核员</p>
          <div class="auditor">
            <div class="auditor-name silver">DUO</div>
            <div class="auditor-note">仅休息日在线，非工作日添加请耐心等待通过</div>
          </div>
          <div class="auditor">
            <div class="auditor-name silver">暴雪踏墨行</div>
          </div>
          <p class="muted" style="margin:20px 0 0;font-size:13.5px;line-height:1.9;border-top:1px solid var(--line);padding-top:18px">{{ ws(14) }}<b>温馨提示</b>：添加好友请备注「<span class="grad">椰青摄影入群</span>」，可更快通过审核哦。{{ ws(12) }}</p>
        </div>
        <div class="glass" style="padding:40px 32px;text-align:center;margin-top:18px">
          <p class="eyebrow" style="margin-bottom:20px">公众号</p>
          <div id="qr-wrap" style="min-height:190px;display:flex;align-items:center;justify-content:center">
            <img
              v-if="!qrFailed"
              id="qr"
              src="images/二维码.jpg"
              alt="公众号二维码"
              style="width:190px;height:190px;object-fit:contain;border-radius:12px;background:#fff;padding:8px"
              @error="onQrError"
            />
            <div
              v-if="qrFailed"
              class="qr-fallback"
            >把公众号二维码<br />命名为 二维码.jpg<br />放进 images 文件夹</div>
          </div>
          <p class="muted" style="margin:22px 0 0;font-size:14px;line-height:1.9">{{ ws(14) }}扫码关注，私信 <b>我要加入</b><br />{{ ws(14) }}<span style="font-size:13px;opacity:.75">北纬18度椰青摄联</span>{{ ws(12) }}</p>
        </div>
      </div>
    </div>
  </div>
</section>
<section class="section" style="padding-top:0">
  <div class="wrap">
    <div class="section-head reveal">
      <p class="eyebrow">Submission</p>
      <h2 class="silver">公众号投稿细则</h2>
      <p>本公众号是联盟官方发布阵地，也是你的作品展示平台——与摄影相关的内容，不限题材、不限形式。</p>
    </div>
    <div class="steps">
      <div class="step glass reveal" data-delay="0">
        <span class="step-num">01</span>
        <p>加入北纬18度椰青摄影联盟官方社群。</p>
      </div>
      <div class="step glass reveal" data-delay="60">
        <span class="step-num">02</span>
        <p>私信社群群主／管理员，说明投稿主题与内容方向；或从交流群中发布的征稿消息获取当期投稿要求。</p>
      </div>
      <div class="step glass reveal" data-delay="120">
        <span class="step-num">03</span>
        <p>提交对应作品原图、配套文案。如有特殊排版、编辑需求，可提前与管理员说明，我们可协助优化完善。</p>
      </div>
      <div class="step glass reveal" data-delay="180">
        <span class="step-num">04</span>
        <p>内容审核整理后，我们将在公众号官方账号进行推送发布。</p>
      </div>
    </div>
  </div>
</section>
<section class="section" style="padding-top:0">
  <div class="wrap">
    <div class="section-head reveal">
      <p class="eyebrow">Rules</p>
      <h2 class="silver">投稿要求</h2>
    </div>
    <div class="glass reveal" style="padding:38px 36px">
      <ol class="rules">
        <li>投稿内容需合法合规，不涉及个人及他人隐私，不包含任何违规不良内容。</li>
        <li>所有投稿内容必须为原创，严禁抄袭、盗用他人作品。合作投稿请提前说明相关情况。</li>
        <li>投稿内容方向不限，包括但不限于：个人作品合集、主题摄影专栏、器材评测、拍摄心得、后期教程、摄影故事分享、行业观点表达等。</li>
        <li>我们将在推文中为你标注专属署名，也可同步展示你的个人社交媒体账号，为你的创作引流。</li>
        <li>投稿内容一经发布，默认授权本公众号进行非商用的展示与传播，作者保留作品完整版权。</li>
      </ol>
    </div>
  </div>
</section>
<section class="section" style="padding-top:0">
  <div class="wrap">
    <div class="quote glass reveal">
      <p class="eyebrow" style="margin-bottom:22px">最后想说</p>
      <blockquote class="silver" style="font-size:clamp(20px,2.8vw,30px)">{{ ws(10) }}椰风藏山海，光影赴初心{{ ws(8) }}</blockquote>
      <p class="muted" style="max-width:44em;margin:0 auto 26px;font-size:15px;line-height:2">{{ ws(10) }}在北纬18度的海南，我们以镜头为媒介，汇聚每一份对摄影的热爱。{{ ws(10) }}从校园到山海，从日出到夜幕，我们愿意陪你一起，{{ ws(10) }}用镜头定格海岛的每一寸美好，让每一份真诚的创作，都能被看见。{{ ws(8) }}</p>
      <p class="grad" style="font-size:15.5px;letter-spacing:.05em;margin:0">{{ ws(10) }}非常欢迎大家投稿，也期待你的加入，和我们一起，做一个「椰青」{{ ws(8) }}</p>
    </div>
  </div>
</section>
</template>

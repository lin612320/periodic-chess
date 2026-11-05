/* ============================================================
 * card-test.js — 元素悬停知识卡 + 磁吸 + 光效
 *   node tools/card-test.js
 * ============================================================ */
'use strict';

const { connect, sleep } = require('./lib-cdp');

const APP = 'http://127.0.0.1:18080/';

async function main() {
  const { send, evaluate, shot, shotClip, installErrorTrap, errs } = await connect();

  await send('Runtime.enable');
  await send('Page.enable');
  await installErrorTrap();
  await send('Emulation.setDeviceMetricsOverride', {
    width: 1440, height: 900, deviceScaleFactor: 1, mobile: false
  });

  await send('Page.navigate', { url: APP });
  await sleep(2400);
  await evaluate('(()=>{const b=document.getElementById("prologueSkip");if(b)b.click();return true;})()');
  await sleep(500);

  const out = [];
  const step = (k, v) => { const s = k + '：' + JSON.stringify(v); out.push(s); console.log(s); };

  /* 开局 */
  await evaluate('document.querySelector("[data-count=\'2\']").click()');
  await sleep(200);
  await evaluate('document.getElementById("btnStart").click()');
  await sleep(2600);

  step('已进舞台', await evaluate('document.body.classList.contains("is-stage")'));
  step('元素知识层', await evaluate('typeof window.EPF.info === "object" && !!window.EPF.info.get(26)'));
  step('特效层', await evaluate('typeof window.EPF.fx === "object"'));

  /* 找一个格子并算出屏幕坐标 */
  const pos = await evaluate(`
    (() => {
      const c = document.querySelector('.cell[data-z="26"]');
      if (!c) return null;
      const r = c.getBoundingClientRect();
      return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
    })()
  `);
  step('Fe 格坐标', pos.value);
  if (!pos.value) { console.log('❌ 找不到 Fe 格'); process.exit(1); }

  /* 模拟鼠标移动过去 */
  async function moveTo(x, y) {
    await send('Input.dispatchMouseEvent', {
      type: 'mouseMoved', x, y, button: 'none', clickCount: 0, pointerType: 'mouse'
    });
  }

  await moveTo(pos.value.x - 30, pos.value.y);
  await sleep(120);
  await moveTo(pos.value.x, pos.value.y);
  await sleep(500);

  step('卡片可见', await evaluate('!document.getElementById("elemCard").hidden'));
  step('卡片显示态', await evaluate('document.getElementById("elemCard").dataset.show'));
  step('卡片符号', await evaluate('(document.querySelector(".ecard__sym")||{}).textContent'));
  step('卡片名字', await evaluate('(document.querySelector(".ecard__name")||{}).textContent'));
  step('卡片数据行', await evaluate(
    '[...document.querySelectorAll(".ecard__row")].map(r=>r.textContent.trim())'
  ));
  step('能级排布', await evaluate('(document.querySelector(".ecard__config")||{}).textContent'));
  step('考点条数', await evaluate('document.querySelectorAll(".ecard__fact").length'));
  step('考点内容', await evaluate(
    '[...document.querySelectorAll(".ecard__fact")].map(f=>f.textContent).slice(0,3)'
  ));
  step('磁吸类', await evaluate('!!document.querySelector(".cell.is-magnet")'));
  step('磁吸倾斜量', await evaluate(
    '(()=>{const c=document.querySelector(".cell.is-magnet");' +
    'return c?{x:c.style.getPropertyValue("--tilt-x"),y:c.style.getPropertyValue("--tilt-y"),mx:c.style.getPropertyValue("--mx")}:null;})()'
  ));
  await shot('30-card-hover.png');

  /* 卡片局部特写 */
  const cr = await evaluate(
    '(()=>{const r=document.getElementById("elemCard").getBoundingClientRect();' +
    'return {x:Math.round(r.x),y:Math.round(r.y),width:Math.round(r.width),height:Math.round(r.height)};})()'
  );
  if (cr.value) {
    await shotClip('31-card-2x.png', Object.assign({ scale: 2 }, cr.value));
  }

  /* 移到空白处应收回 */
  await moveTo(20, 20);
  await sleep(600);
  step('移开后隐藏', await evaluate(
    'document.getElementById("elemCard").hidden || document.getElementById("elemCard").dataset.show === "0"'
  ));

  /* 换一个生僻字元素看看退化显示 */
  const pos118 = await evaluate(`
    (() => {
      const c = document.querySelector('.cell[data-z="79"]');
      const r = c.getBoundingClientRect();
      return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
    })()
  `);
  await moveTo(pos118.value.x, pos118.value.y);
  await sleep(500);
  step('Au 卡片', await evaluate(
    '({sym:(document.querySelector(".ecard__sym")||{}).textContent,' +
    'name:(document.querySelector(".ecard__name")||{}).textContent,' +
    'facts:document.querySelectorAll(".ecard__fact").length})'
  ));
  await shot('32-card-au.png');

  /* 粒子画布是否有内容 */
  await moveTo(400, 300);
  await sleep(80);
  await moveTo(900, 500);
  await sleep(160);
  step('canvas 有绘制', await evaluate(`
    (() => {
      const c = document.getElementById('fx');
      if (!c) return 'no-canvas';
      const g = c.getContext('2d');
      const d = g.getImageData(0, 0, c.width, c.height).data;
      let n = 0;
      for (let i = 3; i < d.length; i += 4) if (d[i] > 0) n++;
      return { nonEmptyPixels: n };
    })()
  `));

  const e = await errs();
  if (e.length) {
    console.log('\n❌ 页面错误 ' + e.length + ' 条：');
    e.slice(0, 10).forEach((x) => console.log('  -', String(x).split('\n')[0].slice(0, 180)));
  } else {
    console.log('\n✅ 页面无 JS 错误');
  }
  process.exit(e.length ? 1 : 0);
}

main().catch((e) => { console.error('脚本失败：', e); process.exit(2); });

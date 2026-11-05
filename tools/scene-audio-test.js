/* ============================================================
 * scene-audio-test.js — 序章音景：开关 + 光声联动
 *   node tools/scene-audio-test.js
 * ============================================================ */
'use strict';

const { connect, sleep } = require('./lib-cdp');

const APP = 'http://127.0.0.1:18080/';

async function main() {
  const { send, evaluate, shot, installErrorTrap, errs } = await connect();

  await send('Runtime.enable');
  await send('Page.enable');
  await installErrorTrap();
  await send('Emulation.setDeviceMetricsOverride', {
    width: 1440, height: 900, deviceScaleFactor: 1, mobile: false
  });
  await send('Page.navigate', { url: APP });
  await sleep(2600);

  const out = [];
  const fails = [];
  const step = (k, v) => { const s = k + '：' + JSON.stringify(v); out.push(s); console.log(s); };
  const ok = (c, label) => { if (!c) fails.push(label); };

  async function moveTo(x, y) {
    await send('Input.dispatchMouseEvent', {
      type: 'mouseMoved', x: Math.round(x), y: Math.round(y),
      button: 'none', clickCount: 0, pointerType: 'mouse'
    });
  }

  step('音景模块', await evaluate('typeof window.EPF.scene === "object"'));
  step('初始关闭', await evaluate('window.EPF.scene.isOn()'));
  step('按钮存在', await evaluate('!!document.getElementById("prologueSnd")'));

  /* 打开 */
  await evaluate('document.getElementById("prologueSnd").click()');
  await sleep(1400);
  step('打开后', await evaluate('window.EPF.scene.isOn()'));
  step('按钮态', await evaluate('document.getElementById("prologueSnd").getAttribute("aria-pressed")'));
  step('标签', await evaluate('document.getElementById("prologueSndLabel").textContent'));
  ok((await evaluate('window.EPF.scene.isOn()')).value === true, '点了没打开');
  await shot('80-scene-audio-on.png');

  /* 幕 2：太阳左右 → 音色参数应变化 */
  await evaluate('window.EPF.prologue.goTo(1, true)');
  await sleep(1300);

  const area = await evaluate(`
    (() => {
      const r = document.getElementById('shadows').getBoundingClientRect();
      return { l: Math.round(r.left), w: Math.round(r.width), y: Math.round(r.top + r.height * 0.4) };
    })()
  `);

  /* 用探针读取 AudioParam 的当前目标值 */
  const probe = `
    (() => {
      const s = window.EPF.scene;
      if (!s || !s.__probe) return null;
      return s.__probe();
    })()
  `;

  await moveTo(area.value.l + 15, area.value.y);
  await sleep(800);
  const left = await evaluate(probe);
  await shot('81-sun-left-audio.png');

  await moveTo(area.value.l + area.value.w - 15, area.value.y);
  await sleep(800);
  const right = await evaluate(probe);
  await shot('82-sun-right-audio.png');

  step('太阳在左（探针）', left.value);
  step('太阳在右（探针）', right.value);

  if (left.value && right.value) {
    ok(left.value.windCutoff !== right.value.windCutoff, '太阳移动后风的截止频率没变');
    ok(left.value.cityCutoff !== right.value.cityCutoff, '太阳移动后远处低频没变');
    ok(left.value.windGain > right.value.windGain, '太阳越低风应该越大');
    ok(left.value.cityGain > right.value.cityGain, '太阳越低低频应该越厚');
  }

  /* 关掉 */
  await evaluate('document.getElementById("prologueSnd").click()');
  await sleep(700);
  step('关闭后', await evaluate('window.EPF.scene.isOn()'));
  ok((await evaluate('window.EPF.scene.isOn()')).value === false, '点了没关掉');

  /* 没开声音时推幕不该报错 */
  await evaluate('window.EPF.prologue.goTo(5, true)');
  await sleep(1000);
  await evaluate('document.getElementById("proRan").click()');
  await sleep(1200);
  step('静音状态下按 RAN 的 LCD', await evaluate('document.getElementById("proLcd").textContent'));

  console.log(out.join('\n'));

  const e = await errs();
  if (e.length) {
    console.log('\n❌ 页面错误 ' + e.length + ' 条：');
    e.slice(0, 8).forEach((x) => console.log('  -', String(x).split('\n')[0].slice(0, 170)));
  }
  if (fails.length) {
    console.log('\n❌ 断言失败 ' + fails.length + ' 项：');
    fails.forEach((f) => console.log('  -', f));
  }
  if (!e.length && !fails.length) console.log('\n✅ 序章音景全通');
  process.exit(e.length || fails.length ? 1 : 0);
}

main().catch((e) => { console.error('脚本失败：', e); process.exit(2); });

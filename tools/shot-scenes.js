/* ============================================================
 * shot-scenes.js — 逐幕截图（调试视觉用）
 *   node tools/shot-scenes.js
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

  async function moveTo(x, y) {
    await send('Input.dispatchMouseEvent', {
      type: 'mouseMoved', x: Math.round(x), y: Math.round(y),
      button: 'none', clickCount: 0, pointerType: 'mouse'
    });
  }
  async function mid(sel) {
    return (await evaluate(`
      (() => {
        const n = document.querySelector(${JSON.stringify(sel)});
        if (!n) return null;
        const r = n.getBoundingClientRect();
        return { x: r.left + r.width / 2, y: r.top + r.height / 2,
                 l: r.left, t: r.top, w: r.width, h: r.height };
      })()
    `)).value;
  }

  /* 幕 1：拨人群 */
  await evaluate('window.EPF.prologue.goTo(0, true)');
  await sleep(1400);
  let c = await mid('#crowd');
  await moveTo(c.l + c.w * 0.48, c.t + c.h * 0.7);
  await sleep(200);
  await moveTo(c.l + c.w * 0.52, c.t + c.h * 0.66);
  await sleep(700);
  await shot('70-act1.png');

  /* 幕 2：太阳偏左（影子最长） */
  await evaluate('window.EPF.prologue.goTo(1, true)');
  await sleep(1300);
  let s = await mid('#shadows');
  await moveTo(s.l + 8, s.t + s.h * 0.5);
  await sleep(700);
  await shot('71-act2-sunleft.png');

  /* 幕 2：太阳偏右（影子最短） */
  await moveTo(s.l + s.w - 8, s.t + s.h * 0.5);
  await sleep(700);
  await shot('72-act2-sunright.png');

  /* 幕 3：纸袋 hover */
  await evaluate('window.EPF.prologue.goTo(2, true)');
  await sleep(1200);
  const bags = await evaluate(`
    [...document.querySelectorAll('.bag')].map(n => {
      const r = n.getBoundingClientRect();
      return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
    })
  `);
  await moveTo(bags.value[1].x, bags.value[1].y);
  await sleep(700);
  await shot('73-act3-bags.png');

  /* 幕 4：座位划亮 */
  await evaluate('window.EPF.prologue.goTo(3, true)');
  await sleep(1200);
  const seats = await evaluate(`
    [...document.querySelectorAll('#classroom i')].slice(0, 14).map(n => {
      const r = n.getBoundingClientRect();
      return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
    })
  `);
  for (const p of seats.value) {
    await moveTo(p.x, p.y);
    await sleep(90);
  }
  await sleep(500);
  await shot('74-act4-seats.png');

  /* 幕 5：门推到一半 */
  await evaluate('window.EPF.prologue.goTo(4, true)');
  await sleep(1200);
  const d = await mid('#door');
  await moveTo(d.x, d.y);
  await sleep(150);
  await send('Input.dispatchMouseEvent', {
    type: 'mousePressed', x: Math.round(d.x), y: Math.round(d.y),
    button: 'left', clickCount: 1, pointerType: 'mouse'
  });
  for (let i = 1; i <= 4; i++) {
    await send('Input.dispatchMouseEvent', {
      type: 'mouseMoved', x: Math.round(d.x + i * 11), y: Math.round(d.y),
      button: 'left', pointerType: 'mouse'
    });
    await sleep(70);
  }
  await send('Input.dispatchMouseEvent', {
    type: 'mouseReleased', x: Math.round(d.x + 44), y: Math.round(d.y),
    button: 'left', clickCount: 1, pointerType: 'mouse'
  });
  await sleep(600);
  await shot('75-act5-door.png');

  /* 幕 6：按下 RAN 之后 */
  await evaluate('window.EPF.prologue.goTo(5, true)');
  await sleep(1200);
  const k = await mid('#proRan');
  await moveTo(k.x, k.y);
  await sleep(400);
  await send('Input.dispatchMouseEvent', {
    type: 'mousePressed', x: Math.round(k.x), y: Math.round(k.y),
    button: 'left', clickCount: 1, pointerType: 'mouse'
  });
  await sleep(70);
  await send('Input.dispatchMouseEvent', {
    type: 'mouseReleased', x: Math.round(k.x), y: Math.round(k.y),
    button: 'left', clickCount: 1, pointerType: 'mouse'
  });
  await sleep(1550);
  await shot('76-act6-calc.png');

  const e = await errs();
  console.log(e.length ? '❌ ' + e.length + ' 条错误' : '✅ 逐幕截图完成，无错误');
  if (e.length) e.slice(0, 6).forEach((x) => console.log('  -', String(x).split('\n')[0]));
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(2); });

/* ============================================================
 * prologue-test.js — 序章六幕的交互与衔接
 *   node tools/prologue-test.js
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
  const ok = (cond, label) => { if (!cond) fails.push(label); };

  async function moveTo(x, y) {
    await send('Input.dispatchMouseEvent', {
      type: 'mouseMoved', x: Math.round(x), y: Math.round(y),
      button: 'none', clickCount: 0, pointerType: 'mouse'
    });
  }
  async function clickAt(x, y) {
    await send('Input.dispatchMouseEvent', {
      type: 'mousePressed', x: Math.round(x), y: Math.round(y),
      button: 'left', clickCount: 1, pointerType: 'mouse'
    });
    await sleep(70);
    await send('Input.dispatchMouseEvent', {
      type: 'mouseReleased', x: Math.round(x), y: Math.round(y),
      button: 'left', clickCount: 1, pointerType: 'mouse'
    });
  }

  /** 等当前幕号变成 n（自动推进会抢跑，不能靠固定 sleep） */
  async function waitAct(n, timeout = 22000) {
    const t0 = Date.now();
    while (Date.now() - t0 < timeout) {
      const v = await evaluate(
        '(()=>{const a=document.querySelector(".act.is-live");return a?a.dataset.act:"-1";})()'
      );
      if (String(v.value) === String(n)) return true;
      await sleep(180);
    }
    return false;
  }

  async function actNow() {
    return (await evaluate(
      '(()=>{const a=document.querySelector(".act.is-live");return a?a.dataset.act:"-1";})()'
    )).value;
  }

  async function center(sel) {
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

  /* ================= 幕 1：把人群拨开 ================= */
  step('幕数', await evaluate('document.querySelectorAll("#prologueStage .act").length'));
  step('初始幕', await actNow());
  step('人群点数', await evaluate('document.querySelectorAll("#crowd i").length'));

  await sleep(1200);
  const crowd = await center('#crowd');
  await moveTo(crowd.l + crowd.w * 0.5, crowd.t + crowd.h * 0.72);
  await sleep(140);
  await moveTo(crowd.l + crowd.w * 0.52, crowd.t + crowd.h * 0.68);
  await sleep(420);

  const pushed = await evaluate(`
    [...document.querySelectorAll('#crowd i')].filter(n => {
      const t = n.style.translate || '';
      const m = t.match(/-?[\\d.]+px/g) || [];
      return m.some(v => Math.abs(parseFloat(v)) > 0.5);
    }).length
  `);
  step('被推开的人数', pushed.value);
  ok(pushed.value > 0 && pushed.value < 28, '人群应该只推开一部分，实际 ' + pushed.value);
  await shot('60-act1-crowd.png');

  /* ================= 幕 2：鼠标就是太阳 ================= */
  /* 幕 1 会自己走完，别手动点，否则等于连点两次跳过去 */
  ok(await waitAct(1), '没进到幕 2');
  await sleep(700);
  step('当前幕', await actNow());
  step('影子条数', await evaluate('document.querySelectorAll("#shadows i").length'));

  const shArea = await center('#shadows');
  await moveTo(shArea.l + 20, shArea.t + shArea.h * 0.4);
  await sleep(420);
  const sunLeft = await evaluate(
    '({left:document.getElementById("sunball").style.left,' +
    'top:document.getElementById("sunball").style.top,' +
    'h:document.querySelector("#shadows i").style.height})'
  );
  await moveTo(shArea.l + shArea.w - 20, shArea.t + shArea.h * 0.4);
  await sleep(420);
  const sunRight = await evaluate(
    '({left:document.getElementById("sunball").style.left,' +
    'top:document.getElementById("sunball").style.top,' +
    'h:document.querySelector("#shadows i").style.height})'
  );
  step('太阳在左', sunLeft.value);
  step('太阳在右', sunRight.value);
  ok(sunLeft.value.left !== sunRight.value.left, '太阳没跟着鼠标走');
  ok(sunLeft.value.h !== sunRight.value.h, '影子没跟着太阳变长变短');
  await shot('61-act2-shadow.png');

  /* ================= 幕 3：翻纸袋 ================= */
  ok(await waitAct(2), '没进到幕 3');
  await sleep(600);
  step('当前幕', await actNow());
  step('纸袋数', await evaluate('document.querySelectorAll(".bag").length'));
  step('幕3 锁定', await evaluate('document.getElementById("prologueNext").classList.contains("is-locked")'));
  step('锁定提示', await evaluate('document.getElementById("prologueHint").textContent'));
  ok(await evaluate('document.getElementById("prologueNext").classList.contains("is-locked")'), '幕3 应该锁着');

  const bag = await center('.bag');
  await moveTo(bag.x, bag.y);
  await sleep(520);
  await shot('62-act3-bags.png');
  await clickAt(bag.x, bag.y);
  await sleep(500);
  step('选中纸袋', await evaluate('document.querySelectorAll(".bag.is-picked").length'));
  step('幕3 解锁', await evaluate('!document.getElementById("prologueNext").classList.contains("is-locked")'));
  ok(await evaluate('!document.getElementById("prologueNext").classList.contains("is-locked")'), '选完应该解锁');

  /* ================= 幕 4：把灯点起来 ================= */
  ok(await waitAct(3), '没进到幕 4');
  await sleep(600);
  step('当前幕', await actNow());
  step('座位数', await evaluate('document.querySelectorAll("#classroom i").length'));

  const seats = await evaluate(`
    [...document.querySelectorAll('#classroom i')].slice(0, 7).map(n => {
      const r = n.getBoundingClientRect();
      return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
    })
  `);
  for (const s of seats.value) {
    await moveTo(s.x, s.y);
    await sleep(110);
  }
  await sleep(300);
  const lit = await evaluate('document.querySelectorAll("#classroom i.is-lit").length');
  step('点亮座位数', lit.value);
  ok(lit.value > 0, '座位一盏都没点亮');
  await shot('63-act4-seats.png');

  /* ================= 幕 5：推门 ================= */
  ok(await waitAct(4), '没进到幕 5');
  await sleep(600);
  step('当前幕', await actNow());
  step('幕5 锁定', await evaluate('document.getElementById("prologueNext").classList.contains("is-locked")'));

  const door = await center('#door');
  await moveTo(door.x, door.y);
  await sleep(150);
  await send('Input.dispatchMouseEvent', {
    type: 'mousePressed', x: Math.round(door.x), y: Math.round(door.y),
    button: 'left', clickCount: 1, pointerType: 'mouse'
  });
  for (let i = 1; i <= 6; i++) {
    await send('Input.dispatchMouseEvent', {
      type: 'mouseMoved', x: Math.round(door.x + i * 16), y: Math.round(door.y),
      button: 'left', pointerType: 'mouse'
    });
    await sleep(80);
  }
  await send('Input.dispatchMouseEvent', {
    type: 'mouseReleased', x: Math.round(door.x + 96), y: Math.round(door.y),
    button: 'left', clickCount: 1, pointerType: 'mouse'
  });
  await sleep(500);
  const openVal = await evaluate('document.getElementById("door").style.getPropertyValue("--open")');
  step('门开口', openVal.value);
  step('幕5 解锁', await evaluate('!document.getElementById("prologueNext").classList.contains("is-locked")'));
  ok(parseFloat(openVal.value) > 0.6, '推门没到 0.6，实际 ' + openVal.value);
  await shot('64-act5-door.png');

  /* ================= 幕 6：真的按 RAN ================= */
  ok(await waitAct(5), '没进到幕 6');
  await sleep(600);
  step('当前幕', await actNow());
  step('幕6 锁定', await evaluate('document.getElementById("prologueNext").classList.contains("is-locked")'));
  step('LCD 初始', await evaluate('document.getElementById("proLcd").textContent'));

  const key = await center('#proRan');
  await moveTo(key.x, key.y);
  await sleep(400);
  await shot('65-act6-calc-before.png');
  await clickAt(key.x, key.y);

  await sleep(620);
  const l1 = (await evaluate('document.getElementById("proLcd").textContent')).value;
  await sleep(520);
  const l2 = (await evaluate('document.getElementById("proLcd").textContent')).value;
  await sleep(520);
  const l3 = (await evaluate('document.getElementById("proLcd").textContent')).value;
  step('LCD 演变', [l1, l2, l3]);
  ok(l3.indexOf('Rnd') === 0, 'LCD 没走到 Rnd，实际 ' + l3);
  step('按键已按', await evaluate('document.getElementById("proRan").disabled'));
  await shot('66-act6-calc-after.png');

  /* ================= 收尾 ================= */
  await sleep(3200);
  step('序章结束', await evaluate('document.getElementById("prologue").hidden'));
  step('intro 显示', await evaluate('!document.getElementById("intro").hidden'));
  ok(await evaluate('document.getElementById("prologue").hidden'), '序章没关掉');
  ok(await evaluate('!document.getElementById("intro").hidden'), 'intro 没出来');
  await shot('67-intro.png');

  await evaluate('document.querySelector("[data-count=\'2\']").click()');
  await sleep(200);
  await evaluate('document.getElementById("btnStart").click()');
  await sleep(2600);
  step('棋盘格子', await evaluate('document.querySelectorAll(".cell[data-z]").length'));

  console.log(out.join('\n'));

  const e = await errs();
  if (e.length) {
    console.log('\n❌ 页面错误 ' + e.length + ' 条：');
    e.slice(0, 10).forEach((x) => console.log('  -', String(x).split('\n')[0].slice(0, 180)));
  }
  if (fails.length) {
    console.log('\n❌ 断言失败 ' + fails.length + ' 项：');
    fails.forEach((f) => console.log('  -', f));
  }
  if (!e.length && !fails.length) console.log('\n✅ 六幕全通，无 JS 错误');

  process.exit(e.length || fails.length ? 1 : 0);
}

main().catch((e) => { console.error('脚本失败：', e); process.exit(2); });

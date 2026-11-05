/* ============================================================
 * duel-test.js — 专项：决斗格的完整交互链路
 *   node tools/duel-test.js
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
  await sleep(2200);

  const out = [];
  const step = (k, v) => out.push(k + '：' + JSON.stringify(v));

  /* 2 人局：玩家 0 是人类，1 是 AI */
  await evaluate('document.querySelector("[data-count=\'2\']").click()');
  await sleep(200);
  await evaluate('document.getElementById("btnStart").click()');
  await sleep(1800);

  step('开局完成', await evaluate('!!window.EPF.app.state'));

  /* 把 0 号挪到 13，并把第一次 RAN 钉成 0 → 骰子必出 1 → 落到 14 号决斗格 */
  await evaluate(`
    (() => {
      const s = window.EPF.app.state;
      s.players[0].pos = 13;
      window.EPF.view.setTokenPos(0, 13);
      let first = true;
      const rnd = Math.random;
      s.rng = function () { if (first) { first = false; return 0; } return rnd(); };
      return { pos: s.players[0].pos };
    })()
  `);
  await sleep(300);

  await evaluate('document.getElementById("btnRoll").click()');
  await sleep(2600);

  step('落点', await evaluate('window.EPF.app.state.players[0].pos'));
  step('决斗弹窗', await evaluate('!document.getElementById("modal").hidden'));
  step('候选人数', await evaluate('document.querySelectorAll(".duel-pick").length'));
  step('弹窗标题', await evaluate('(document.querySelector(".modal__title")||{}).textContent'));
  await shot('10-duel-picker.png');

  /* 选第一个对手 */
  await evaluate('document.querySelector(".duel-pick").click()');
  await sleep(1200);
  await shot('11-duel-rolling.png');

  await sleep(6000);
  step('决斗后 phase', await evaluate('window.EPF.app.state.phase'));
  step('谁睡着了', await evaluate('window.EPF.app.state.players.map(p=>p.sleeping)'));
  step('LCD 通道行数', await evaluate('document.querySelectorAll(".lcd__duel-row").length'));
  step('LCD 命中标记', await evaluate(
    '[...document.querySelectorAll(".lcd__duel-row")].map(r=>r.dataset.hit)'
  ));
  step('最后一条日志', await evaluate(
    'document.querySelector(".log__item:last-child").textContent'
  ));
  await shot('12-duel-done.png');

  console.log(out.join('\n'));

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

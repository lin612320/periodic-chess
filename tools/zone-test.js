/* ============================================================
 * zone-test.js — 专项：只有踩到入口格才会进镧系 / 锕系
 *   node tools/zone-test.js
 * 每个场景单独开一局，只点一次骰子，避免自动回合互相干扰。
 * ============================================================ */
'use strict';

const { connect, sleep } = require('./lib-cdp');

const APP = 'http://127.0.0.1:18080/';

const val = (r) => (r && typeof r === 'object' && 'value' in r ? r.value : r);

async function main() {
  const { send, evaluate, shot, installErrorTrap, errs } = await connect();

  await send('Runtime.enable');
  await send('Page.enable');
  await installErrorTrap();
  await send('Emulation.setDeviceMetricsOverride', {
    width: 1600, height: 1000, deviceScaleFactor: 1, mobile: false
  });

  const out = [];
  const step = (k, v) => out.push(k + '：' + JSON.stringify(v));
  const bad = [];

  async function openGame() {
    await send('Page.navigate', { url: APP });
    await sleep(1900);
    await evaluate('document.querySelector("[data-count=\'2\']").click()');
    await sleep(180);
    await evaluate('document.getElementById("btnStart").click()');
    await sleep(1500);
    /* 两位都是「人」，引擎不会替谁自动掷 */
    await evaluate('window.EPF.app.state.players.forEach(p => { p.isBot = false; })');
  }

  /* 把 0 号放在 from，钉死下一次 RAN，点一次骰子，返回落点 */
  async function scenario(from, ranValue) {
    await openGame();
    await evaluate(`
      (() => {
        const s = window.EPF.app.state;
        s.players[0].pos = ${from};
        window.EPF.view.setTokenPos(0, ${from});
        let first = true;
        const rnd = Math.random;
        s.rng = function () { if (first) { first = false; return ${ranValue}; } return rnd(); };
        return true;
      })()
    `);
    await sleep(240);
    await evaluate('document.getElementById("btnRoll").click()');
    await sleep(3000);
    return val(await evaluate('window.EPF.app.state.players[0].pos'));
  }

  /* 入口格存在且带标记 */
  await openGame();
  step('入口格', val(await evaluate(
    '[...document.querySelectorAll(".cell--gate")].map(c => c.dataset.slot + "@" + c.style.gridRow + "," + c.style.gridColumn)'
  )));

  const cases = [
    [56, 0, 2000, 'Ba 走 1 步 → 镧系首格 La'],
    [88, 0, 3000, 'Ra 走 1 步 → 锕系首格 Ac'],
    [2014, 0, 72, 'Lu 走 1 步 → 出系到 Hf'],
    [3014, 0, 104, 'Lr 走 1 步 → 出系到 Rf']
  ];

  for (const [from, ran, want, label] of cases) {
    const pos = await scenario(from, ran);
    step(label, pos);
    ok(pos === want, label + '：期望 ' + want + '，实际 ' + pos);
  }

  /* 从 Ba 走 2 步：跨过入口格后继续在系里走（落点一定还在系内） */
  const inZone = await scenario(56, 0.25);
  step('Ba 走 2 步', inZone);
  ok(inZone >= 2000 && inZone <= 2014, 'Ba 走 2 步没进镧系，实际 ' + inZone);

  /* 从主表路过：Cs(55) 走 2 步 → 先到 Ba 再被入口吸进镧系 */
  const passed = await scenario(55, 0.25);
  step('Cs 走 2 步', passed);
  ok(passed >= 2000 && passed <= 2014, 'Cs 走 2 步应被入口吸进镧系，实际 ' + passed);

  /* 系内可以继续走 */
  const inner = await scenario(2010, 0);
  step('镧系内 Er 走 1 步', inner);
  ok(inner >= 2000 && inner <= 2014 && inner !== 2010, '镧系内没走动，实际 ' + inner);

  function ok(good, extra) {
    if (!good) bad.push(extra || '落点不符');
  }

  /* 棋子必须真的压住 La 格 */
  await openGame();
  await evaluate('window.EPF.view.setTokenPos(0, 2000)');
  await sleep(1800);
  const geom = val(await evaluate(`
    (() => {
      const V = window.EPF.view;
      const t = document.querySelector('.token[data-pid="0"]');
      const c = V.cellOf(2000);
      const tb = t.getBoundingClientRect(), cb = c.getBoundingClientRect();
      return {
        dx: Math.round((tb.left + tb.width / 2) - (cb.left + cb.width / 2)),
        dy: Math.round((tb.top + tb.height / 2) - (cb.top + cb.height / 2)),
        cellZ: c.dataset.z
      };
    })()
  `));
  step('棋子相对 La 格偏移', geom);
  ok(geom.cellZ === '57', 'slot 2000 对应的格子不是 57 号，实际 ' + geom.cellZ);
  ok(Math.abs(geom.dx) <= 4 && Math.abs(geom.dy) <= 4, '棋子没压在 La 格上 dx=' + geom.dx + ' dy=' + geom.dy);
  await shot('14-lanthanide.png');

  /* 日志不能露出原始 slotId */
  const pos2 = await scenario(56, 0);
  const logs = val(await evaluate(
    '[...document.querySelectorAll(".log__item")].map(x => x.textContent).join(" | ")'
  ));
  ok(pos2 === 2000, '日志场景落点不对');
  ok(!/→ ?2\d{3}|→ ?3\d{3}|第 \d{4,} 格/.test(logs), '日志里露出了原始 slotId');
  ok(/镧系/.test(logs), '日志没有提示镧系入口');
  step('日志片段', logs.slice(-160));

  console.log(out.join('\n'));

  const e = await errs();
  if (e.length) {
    console.log('\n❌ 页面错误 ' + e.length + ' 条：');
    e.slice(0, 10).forEach((x) => console.log('  -', String(x).split('\n')[0].slice(0, 180)));
  }
  if (bad.length) {
    console.log('\n❌ 规则不符 ' + bad.length + ' 条：');
    bad.forEach((x) => console.log('  -', x));
  }
  if (!e.length && !bad.length) console.log('\n✅ 进系规则全部正确');
  process.exit(e.length || bad.length ? 1 : 0);
}

main().catch((e) => { console.error('脚本失败：', e); process.exit(2); });

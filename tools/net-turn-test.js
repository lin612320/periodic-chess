/* ============================================================
 * net-turn-test.js — 联机回合链路压测（房主视角重点）
 *   $env:EPF_CDP_PORT="9222"; node tools/net-turn-test.js
 * -----------------------------------------------------------
 * 盯的是这样一件事：轮到自己、骰子按钮是亮的、点下去
 * 必须真的动起来；点完没反应就是 bug，要抓出来。
 * ============================================================ */
'use strict';

const { connect, sleep } = require('./lib-cdp');

const APP = process.env.EPF_APP || 'http://127.0.0.1:18080/';
const out = [];
const fails = [];
const step = (k, v) => { const s = k + '：' + JSON.stringify(v); out.push(s); console.log(s); };
const ok = (c, label) => { if (!c) fails.push(label); };
const val = (r) => (r && typeof r === 'object' && 'value' in r ? r.value : r);

async function skipPrologue(page) {
  await val(await page.evaluate('(()=>{const b=document.getElementById("prologueSkip");if(b)b.click();return true;})()'));
  await sleep(600);
}

const snap = (page) => page.evaluate(`(()=>{
  const s = window.EPF.app.state;
  if (!s) return null;
  const b = document.getElementById('btnRoll');
  return {
    turn: s.turn, round: s.round, phase: s.phase,
    pos: s.players.map(p => p.pos),
    who: s.players.map(p => p.name),
    btnDisabled: !!b.disabled,
    lcd: (document.getElementById('lcdOut')||{}).textContent || ''
  };
})()`).then(val);

async function waitFor(page, pred, ms) {
  const t0 = Date.now();
  while (Date.now() - t0 < (ms || 8000)) {
    const s = await snap(page);
    if (s && pred(s)) return s;
    await sleep(250);
  }
  return await snap(page);
}

(async () => {
  const A = await connect();
  await A.send('Runtime.enable'); await A.send('Page.enable'); await A.installErrorTrap();
  await A.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
  await A.send('Page.navigate', { url: APP });
  await sleep(3000);
  await skipPrologue(A);

  const created = await A.send('Target.createTarget', { url: APP });
  const bId = created.result && created.result.targetId;
  if (!bId) { console.log('开标签页失败'); process.exit(2); }
  await sleep(2200);
  const B = await connect(bId);
  await B.send('Runtime.enable'); await B.send('Page.enable'); await B.installErrorTrap();
  await B.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
  await sleep(1500);
  await skipPrologue(B);

  /* A 开房 */
  await A.evaluate('document.getElementById("btnLan").click()');
  await sleep(600);
  await A.evaluate('document.getElementById("lanName").value = "小林"');
  await A.evaluate('document.querySelector(\'.lan-choice[data-act="host"]\').click()');

  let code = '';
  for (let i = 0; i < 30; i++) {
    await sleep(1000);
    const v = String(val(await A.evaluate('(document.getElementById("lanRoomCode")||{}).textContent || ""')) || '').trim();
    if (/^\d{6}$/.test(v)) { code = v; break; }
  }
  step('房间码', code);
  if (!code) { console.log(out.join('\n')); process.exit(1); }

  /* B 加入 */
  await B.evaluate('document.getElementById("btnLan").click()');
  await sleep(600);
  await B.evaluate('document.getElementById("lanName").value = "阿满"');
  await B.evaluate('document.querySelector(\'.lan-choice[data-act="client"]\').click()');
  await sleep(400);
  await B.evaluate(`document.getElementById('lanCodeInput').value = ${JSON.stringify(code)}`);
  await B.evaluate('document.querySelector(\'[data-act="join"]\').click()');

  let joined = false;
  for (let i = 0; i < 30; i++) {
    await sleep(800);
    if (val(await B.evaluate('window.EPF.net.mode')) === 'p2p-client') { joined = true; break; }
  }
  step('客机已连上', joined);
  ok(joined, '客机没连上');
  if (!joined) { console.log(out.join('\n')); process.exit(1); }

  await sleep(1200);
  await A.evaluate('document.querySelector(\'[data-act="go"]\').click()');
  await sleep(4500);

  step('开局状态', await snap(A));
  ok(val(await A.evaluate('window.EPF.app.mode')) === 'host', 'A 不是 host');
  ok(val(await B.evaluate('window.EPF.app.mode')) === 'client', 'B 不是 client');

  /* 谁该出手就点谁：座位 0 用 A，座位 1 用 B */
  let hostTurns = 0, clientTurns = 0, idle = 0;

  for (let i = 0; i < 60; i++) {
    const a = await snap(A);
    const b = await snap(B);
    if (!a || a.phase === 'over') break;

    const aMine = !a.btnDisabled && a.turn === 0;
    const bMine = !b.btnDisabled && b.turn === 1;

    if (aMine) {
      const before = a;
      await A.evaluate('document.getElementById("btnRoll").click()');
      hostTurns++; idle = 0;
      const after = await waitFor(A, (s) =>
        JSON.stringify(s.pos) !== JSON.stringify(before.pos) || s.turn !== before.turn ||
        s.round !== before.round || s.phase === 'over', 20000);
      if (JSON.stringify(after.pos) === JSON.stringify(before.pos) && after.turn === before.turn
        && after.round === before.round && after.phase !== 'over') {
        step('房主点了没反应', { before: before.pos, after: after.pos, lab: after.lab });
        fails.push('房主点了骰子局面没变');
        break;
      }
      await sleep(900);
      continue;
    }

    if (bMine) {
      const before = b;
      await B.evaluate('document.getElementById("btnRoll").click()');
      clientTurns++; idle = 0;
      const after = await waitFor(B, (s) =>
        JSON.stringify(s.pos) !== JSON.stringify(before.pos) || s.turn !== before.turn ||
        s.round !== before.round || s.phase === 'over', 20000);
      if (JSON.stringify(after.pos) === JSON.stringify(before.pos) && after.turn === before.turn
        && after.round === before.round && after.phase !== 'over') {
        step('客机点了没反应', { before: before.pos, after: after.pos, lab: after.lab });
        fails.push('客机点了骰子局面没变');
        break;
      }
      await sleep(900);
      continue;
    }

    idle++;
    if (idle > 25) {
      step('卡住：两边都没法出手', {
        A: { turn: a.turn, lab: a.lab, dis: a.btnDisabled, phase: a.phase },
        B: { turn: b.turn, lab: b.lab, dis: b.btnDisabled, phase: b.phase, seat: b.seat }
      });
      fails.push('20 秒内两边按钮都没亮，点也点不动');
      break;
    }
    await sleep(800);
  }

  step('出手次数', { 房主: hostTurns, 客机: clientTurns });

  const aEnd = await snap(A);
  const bEnd = await snap(B);
  step('结束位置', { A: aEnd && aEnd.pos, B: bEnd && bEnd.pos });
  ok(JSON.stringify(aEnd.pos) === JSON.stringify(bEnd.pos), '两端位置不一致');
  ok(aEnd.turn === bEnd.turn, '两端回合不一致');
  ok(hostTurns >= 3, '房主出手次数太少（' + hostTurns + '），没测到');
  ok(clientTurns >= 2, '客机出手次数太少（' + clientTurns + '），没测到');

  console.log('');
  const eA = await A.errs();
  const eB = await B.errs();
  if (eA.length) { console.log('❌ A 错误：'); eA.slice(0, 8).forEach(x => console.log('  - ' + String(x).split('\n')[0].slice(0, 170))); }
  if (eB.length) { console.log('❌ B 错误：'); eB.slice(0, 8).forEach(x => console.log('  - ' + String(x).split('\n')[0].slice(0, 170))); }
  if (fails.length) { console.log('\n❌ 断言失败 ' + fails.length + ' 项：'); fails.forEach(f => console.log('  - ' + f)); }
  if (!eA.length && !eB.length && !fails.length) console.log('\n✅ 联机回合链路正常：房主/客机轮流点骰子都能推进');
  process.exit(eA.length || eB.length || fails.length ? 1 : 0);
})().catch((e) => { console.error('脚本失败：', e); process.exit(2); });

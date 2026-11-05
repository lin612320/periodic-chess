/* ============================================================
 * p2p-test.js — 房间码直连实测
 *   $env:EPF_CDP_PORT="9224"; node tools/p2p-test.js
 * ============================================================ */
'use strict';

const { connect, sleep } = require('./lib-cdp');

const APP = process.env.EPF_APP || 'http://127.0.0.1:18080/';
const out = [];
const fails = [];
const step = (k, v) => { const s = k + '：' + JSON.stringify(v); out.push(s); console.log(s); };
const ok = (c, label) => { if (!c) fails.push(label); };

async function skipPrologue(page) {
  await page.evaluate('(()=>{const b=document.getElementById("prologueSkip");if(b)b.click();return true;})()');
  await sleep(600);
}

(async () => {
  const A = await connect();
  await A.send('Runtime.enable'); await A.send('Page.enable'); await A.installErrorTrap();
  await A.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
  await A.send('Page.navigate', { url: APP });
  await sleep(3000);
  await skipPrologue(A);

  step('PeerJS 库已加载', await A.evaluate('typeof window.Peer === "function"'));

  const created = await A.send('Target.createTarget', { url: APP });
  const bId = created.result && created.result.targetId;
  if (!bId) { console.log('开标签页失败'); process.exit(2); }
  await sleep(2000);
  const B = await connect(bId);
  await B.send('Runtime.enable'); await B.send('Page.enable'); await B.installErrorTrap();
  await B.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
  await sleep(2000);
  await skipPrologue(B);

  /* ---------- A 开房间 ---------- */
  await A.evaluate('document.getElementById("btnLan").click()');
  await sleep(600);
  await A.evaluate('document.getElementById("lanName").value = "小林"');
  await A.evaluate('document.querySelector(\'.lan-choice[data-act="host"]\').click()');

  let roomCode = '';
  for (let i = 0; i < 30; i++) {
    await sleep(1000);
    const v = (await A.evaluate('(document.getElementById("lanRoomCode")||{}).textContent || ""')).value;
    if (v && /^\d{6}$/.test(v.trim())) { roomCode = v.trim(); break; }
    const st = (await A.evaluate('(document.querySelector("#lanStatus")||{}).textContent || ""')).value;
    if (st.indexOf('失败') >= 0) { console.log('开房间失败: ' + st); break; }
  }
  step('房间码', roomCode);
  ok(/^\d{6}$/.test(roomCode), '没拿到 6 位房间码');
  if (!roomCode) { console.log(out.join('\n')); process.exit(1); }

  await A.shot('110-p2p-host-room.png');

  /* ---------- B 输入房间码加入 ---------- */
  await B.evaluate('document.getElementById("btnLan").click()');
  await sleep(600);
  await B.evaluate('document.getElementById("lanName").value = "阿满"');
  await B.evaluate('document.querySelector(\'.lan-choice[data-act="client"]\').click()');
  await sleep(500);
  await B.evaluate(`document.getElementById('lanCodeInput').value = ${JSON.stringify(roomCode)}`);
  await B.evaluate('document.querySelector(\'[data-act="join"]\').click()');

  let joined = false;
  for (let i = 0; i < 30; i++) {
    await sleep(1000);
    const m = (await B.evaluate('window.EPF.net.mode')).value;
    const st = (await B.evaluate('(document.querySelector("#lanStatus")||{}).textContent || ""')).value;
    if (m === 'p2p-client' && st.indexOf('连上了') >= 0) { joined = true; break; }
    if (st.indexOf('不存在') >= 0 || st.indexOf('连不上') >= 0 || st.indexOf('超时') >= 0) {
      console.log('加入失败: ' + st); break;
    }
  }
  step('客机已连上', joined);
  ok(joined, '客机没连上房主');

  await sleep(1500);
  const aRoom = (await A.evaluate('({mode:window.EPF.net.mode, roster:window.EPF.net.me.roster.map(r=>r.name), active:window.EPF.net.active})')).value;
  const bRoom = (await B.evaluate('({mode:window.EPF.net.mode, seat:window.EPF.net.me.seat, roster:window.EPF.net.me.roster.map(r=>r.name)})')).value;
  step('房主看到', aRoom);
  step('客机看到', bRoom);
  ok(aRoom.active === true, '房主端没有活动连接');
  ok(aRoom.roster.length === 2, '房主人数应为 2，实际 ' + aRoom.roster.length);
  ok(bRoom.seat === 1, '客机座位应为 1，实际 ' + bRoom.seat);

  await A.shot('111-p2p-host-roster.png');
  await B.shot('112-p2p-client-joined.png');

  /* ---------- 开局 ---------- */
  await A.evaluate('document.querySelector(\'[data-act="go"]\').click()');
  await sleep(5000);

  const aStage = (await A.evaluate('!document.getElementById("stage").hidden')).value;
  const bStage = (await B.evaluate('!document.getElementById("stage").hidden')).value;
  step('进舞台', { A: aStage, B: bStage });
  ok(aStage && bStage, '有人没进舞台');

  const aP = (await A.evaluate('window.EPF.app.state ? window.EPF.app.state.players.length : -1')).value;
  const bP = (await B.evaluate('window.EPF.app.state ? window.EPF.app.state.players.length : -1')).value;
  step('玩家数', { A: aP, B: bP });
  ok(aP === 2 && bP === 2, '玩家数不对');

  /* ---------- 掷骰同步 ---------- */
  let ra = 0, rb = 0;
  for (let i = 0; i < 80 && ra + rb < 4; i++) {
    const ca = (await A.evaluate('!document.getElementById("stage").hidden && !document.getElementById("btnRoll").disabled')).value;
    if (ca) { await A.evaluate('document.getElementById("btnRoll").click()'); ra++; await sleep(3200); continue; }
    const cb = (await B.evaluate('!document.getElementById("stage").hidden && !document.getElementById("btnRoll").disabled')).value;
    if (cb) { await B.evaluate('document.getElementById("btnRoll").click()'); rb++; await sleep(3200); continue; }
    await sleep(700);
  }
  step('掷骰', { A: ra, B: rb });

  const posA = (await A.evaluate('window.EPF.app.state ? window.EPF.app.state.players.map(p=>p.pos) : null')).value;
  const posB = (await B.evaluate('window.EPF.app.state ? window.EPF.app.state.players.map(p=>p.pos) : null')).value;
  step('位置', { A: posA, B: posB });
  ok(JSON.stringify(posA) === JSON.stringify(posB), '两端位置不一致：' + JSON.stringify(posA) + ' vs ' + JSON.stringify(posB));

  const tA = (await A.evaluate('window.EPF.app.state ? window.EPF.app.state.turn : -1')).value;
  const tB = (await B.evaluate('window.EPF.app.state ? window.EPF.app.state.turn : -1')).value;
  step('回合', { A: tA, B: tB });
  ok(tA === tB, '两端回合不一致');

  await A.shot('113-p2p-A-play.png');
  await B.shot('114-p2p-B-play.png');

  console.log('');
  const eA = await A.errs();
  const eB = await B.errs();
  if (eA.length) { console.log('❌ A 错误：'); eA.slice(0, 6).forEach(x => console.log('  - ' + String(x).split('\n')[0].slice(0, 170))); }
  if (eB.length) { console.log('❌ B 错误：'); eB.slice(0, 6).forEach(x => console.log('  - ' + String(x).split('\n')[0].slice(0, 170))); }
  if (fails.length) { console.log('\n❌ 断言失败 ' + fails.length + ' 项：'); fails.forEach(f => console.log('  - ' + f)); }
  if (!eA.length && !eB.length && !fails.length) console.log('\n✅ 房间码直连全通：开房 → 输码加入 → 开局 → 掷骰同步');

  process.exit(eA.length || eB.length || fails.length ? 1 : 0);
})().catch((e) => { console.error('脚本失败：', e); process.exit(2); });

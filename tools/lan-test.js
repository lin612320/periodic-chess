/* ============================================================
 * lan-test.js — 双页面联机实测（同一浏览器两个 tab = 两个座位）
 *   node tools/lan-test.js
 * ============================================================ */
'use strict';

const { connect, sleep, httpJson, CDP } = require('./lib-cdp');

const APP = 'http://127.0.0.1:18080/';
const ROOM = String(Math.floor(1000 + Math.random() * 9000));   // 随机房号，避免旧连接残留干扰

async function openNewTab() {
  const r = await httpJson(CDP + '/json/new?' + encodeURIComponent(APP));
  // 老版本 CDP 用 PUT，新版 /json/new?url 直接 GET
  return r;
}

async function main() {
  const out = [];
  const step = (k, v) => { const line = k + '：' + JSON.stringify(v); out.push(line); console.log(line); };

  /* ---- 房主 A ---- */
  const A = await connect();
  await A.send('Runtime.enable');
  await A.send('Page.enable');
  await A.installErrorTrap();
  await A.send('Emulation.setDeviceMetricsOverride', {
    width: 1280, height: 820, deviceScaleFactor: 1, mobile: false
  });
  await A.send('Page.navigate', { url: APP });
  await sleep(2200);

  /* ---- 另开一个 tab 当客机 B ---- */
  const created = await A.send('Target.createTarget', { url: APP });
  const bId = created.result && created.result.targetId;
  if (!bId) {
    console.log('新建 tab 失败：', JSON.stringify(created).slice(0, 300));
    process.exit(2);
  }
  step('B target', bId);
  await sleep(1200);

  const B = await connect(bId);
  await B.send('Runtime.enable');
  await B.send('Page.enable');
  await B.installErrorTrap();
  await B.send('Emulation.setDeviceMetricsOverride', {
    width: 1280, height: 820, deviceScaleFactor: 1, mobile: false
  });
  await sleep(800);

  /* ---- 两边各自进房间 ---- */
  async function joinAs(page, name) {
    await page.evaluate('(()=>{const b=document.getElementById("prologueSkip");if(b)b.click();return true;})()');
    await sleep(400);
    await page.evaluate('document.getElementById("btnLan").click()');
    await sleep(400);
    await page.evaluate(`
      (() => {
        document.getElementById('lanRoom').value = '${ROOM}';
        document.getElementById('lanName').value = '${name}';
        document.querySelector('[data-act="join"]').click();
        return true;
      })()
    `);
    await sleep(1400);
  }

  await joinAs(A, '小林');
  await joinAs(B, '阿满');

  step('A 状态', await A.evaluate(
    '({seat:window.EPF.net.me.seat,isHost:window.EPF.net.me.isHost,name:window.EPF.net.me.name,roster:window.EPF.net.me.roster.map(r=>r.name)})'
  ));
  step('B 状态', await B.evaluate(
    '({seat:window.EPF.net.me.seat,isHost:window.EPF.net.me.isHost,name:window.EPF.net.me.name,roster:window.EPF.net.me.roster.map(r=>r.name)})'
  ));
  await A.shot('20-lan-room.png');

  /* ---- 房主开局 ---- */
  const hasGo = await A.evaluate('!!document.querySelector(\'[data-act="go"]\')');
  step('房主看到开局按钮', hasGo);
  if (hasGo.value) {
    await A.evaluate('document.querySelector(\'[data-act="go"]\').click()');
  } else {
    console.log('❌ 房主没有开局按钮，中止');
    process.exit(1);
  }

  await sleep(3200);
  step('A 进入舞台', await A.evaluate('!document.getElementById("stage").hidden'));
  step('B 进入舞台', await B.evaluate('!document.getElementById("stage").hidden'));
  step('A 玩家数', await A.evaluate('window.EPF.app.state.players.length'));
  step('B 玩家数', await B.evaluate('window.EPF.app.state.players.length'));
  step('A 模式', await A.evaluate('window.EPF.app.mode'));
  step('B 模式', await B.evaluate('window.EPF.app.mode'));
  await A.shot('21-lan-A-start.png');
  await B.shot('22-lan-B-start.png');

  /* ---- 交替掷骰，检查双端同步 ---- */
  const canClick = (page) => page.evaluate(
    '!document.getElementById("stage").hidden && !document.getElementById("btnRoll").disabled'
  );
  let aRolls = 0, bRolls = 0;
  for (let i = 0; i < 90 && aRolls + bRolls < 6; i++) {
    if ((await canClick(A)).value) {
      await A.evaluate('document.getElementById("btnRoll").click()');
      aRolls++;
      await sleep(2800);
      continue;
    }
    if ((await canClick(B)).value) {
      await B.evaluate('document.getElementById("btnRoll").click()');
      bRolls++;
      await sleep(2800);
      continue;
    }
    await sleep(500);
  }
  step('A 掷骰次数', aRolls);
  step('B 掷骰次数', bRolls);

  const posA = await A.evaluate('window.EPF.app.state.players.map(p=>p.pos)');
  const posB = await B.evaluate('window.EPF.app.state.players.map(p=>p.pos)');
  step('A 位置', posA.value);
  step('B 位置', posB.value);
  step('位置一致', JSON.stringify(posA.value) === JSON.stringify(posB.value));

  const turnA = await A.evaluate('window.EPF.app.state.turn');
  const turnB = await B.evaluate('window.EPF.app.state.turn');
  step('A 当前回合', turnA.value);
  step('B 当前回合', turnB.value);
  step('回合一致', turnA.value === turnB.value);

  await A.shot('23-lan-A-after.png');
  await B.shot('24-lan-B-after.png');

  console.log(out.join('\n'));

  const eA = await A.errs();
  const eB = await B.errs();
  if (eA.length) {
    console.log('\n❌ A 页面错误 ' + eA.length + ' 条：');
    eA.slice(0, 8).forEach((x) => console.log('  -', String(x).split('\n')[0].slice(0, 170)));
  }
  if (eB.length) {
    console.log('\n❌ B 页面错误 ' + eB.length + ' 条：');
    eB.slice(0, 8).forEach((x) => console.log('  -', String(x).split('\n')[0].slice(0, 170)));
  }
  if (!eA.length && !eB.length) console.log('\n✅ 两端均无 JS 错误');

  process.exit(eA.length || eB.length ? 1 : 0);
}

main().catch((e) => { console.error('脚本失败：', e); process.exit(2); });

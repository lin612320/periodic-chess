/* ============================================================
 * verify-live.js — 在公网页面上跑一遍真实渲染检查
 *   node tools/verify-live.js
 * ============================================================ */
'use strict';

const fs = require('fs');
const path = require('path');
const http = require('http');

const APP = 'https://lin612320.github.io/periodic-chess/';
const CDP = 'http://127.0.0.1:9224';
const SHOT_DIR = path.join(__dirname, 'shots');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function httpJson(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
      let b = '';
      res.on('data', (c) => (b += c));
      res.on('end', () => { try { resolve(JSON.parse(b)); } catch (e) { reject(e); } });
    }).on('error', reject);
  });
}

(async () => {
  const list = await httpJson(CDP + '/json');
  const page = list.find((t) => t.type === 'page');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });

  let seq = 0;
  const pending = new Map();
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
  };
  const send = (method, params) => new Promise((resolve) => {
    const id = ++seq;
    pending.set(id, resolve);
    ws.send(JSON.stringify({ id, method, params }));
  });

  const evaluate = async (expr) => {
    const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true, userGesture: true });
    if (r.result?.exceptionDetails) return { error: r.result.exceptionDetails.exception?.description };
    return { value: r.result?.result?.value };
  };

  await send('Runtime.enable');
  await send('Page.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });

  await send('Page.addScriptToEvaluateOnNewDocument', {
    source: `
      window.__errs = [];
      window.addEventListener('error', e => window.__errs.push('error: ' + e.message + ' @' + (e.filename||'') + ':' + (e.lineno||0)));
      window.addEventListener('unhandledrejection', e => window.__errs.push('rejection: ' + String(e.reason && e.reason.stack || e.reason)));
    `
  });

  console.log('打开: ' + APP);
  await send('Page.navigate', { url: APP });
  await sleep(4500);

  const out = [];
  const step = (k, v) => { const s = k + '：' + JSON.stringify(v); out.push(s); console.log(s); };

  step('页面标题', await evaluate('document.title'));
  step('序章出现', await evaluate('!!document.getElementById("prologue") && !document.getElementById("prologue").hidden'));
  step('幕数', await evaluate('document.querySelectorAll("#prologueStage .act").length'));
  step('人群点数', await evaluate('document.querySelectorAll("#crowd i").length'));

  // 截图（序章）
  const shot1 = await send('Page.captureScreenshot', { format: 'png' });
  if (shot1.result?.data) {
    fs.mkdirSync(SHOT_DIR, { recursive: true });
    fs.writeFileSync(path.join(SHOT_DIR, '90-live-prologue.png'), Buffer.from(shot1.result.data, 'base64'));
    console.log('截图: 90-live-prologue.png');
  }

  // 跳过序章 → 开局
  await evaluate('document.getElementById("prologueSkip").click()');
  await sleep(900);
  step('intro 显示', await evaluate('!document.getElementById("intro").hidden'));
  step('封面卡片', await evaluate('document.querySelectorAll(".cover").length'));

  await evaluate('document.querySelector("[data-count=\'2\']").click()');
  await sleep(300);
  await evaluate('document.getElementById("btnStart").click()');
  await sleep(3500);

  step('进入舞台', await evaluate('!document.getElementById("stage").hidden'));
  step('棋盘格子数', await evaluate('document.querySelectorAll(".cell[data-z]").length'));
  step('特殊格数', await evaluate('document.querySelectorAll(".cell[data-special]").length'));
  step('棋子数', await evaluate('document.querySelectorAll(".token").length'));

  // 悬停知识卡
  const pos = await evaluate(`
    (() => {
      const c = document.querySelector('.cell[data-z="26"]');
      if (!c) return null;
      const r = c.getBoundingClientRect();
      return { x: Math.round(r.left + r.width/2), y: Math.round(r.top + r.height/2) };
    })()
  `);
  if (pos.value) {
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: pos.value.x - 20, y: pos.value.y, button: 'none', pointerType: 'mouse' });
    await sleep(150);
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: pos.value.x, y: pos.value.y, button: 'none', pointerType: 'mouse' });
    await sleep(600);
    step('知识卡', await evaluate(
      '(()=>{const c=document.getElementById("elemCard");return {shown:!c.hidden, sym:(document.querySelector(".ecard__sym")||{}).textContent};})()'
    ));
  }

  // 掷一次骰子
  const canRoll = await evaluate('!document.getElementById("btnRoll").disabled');
  if (canRoll.value) {
    await evaluate('document.getElementById("btnRoll").click()');
    await sleep(3000);
    step('掷骰后 LCD', await evaluate('document.getElementById("lcdVal").textContent'));
    step('日志条数', await evaluate('document.querySelectorAll(".log__item").length'));
  }

  const shot2 = await send('Page.captureScreenshot', { format: 'png' });
  if (shot2.result?.data) {
    fs.writeFileSync(path.join(SHOT_DIR, '91-live-game.png'), Buffer.from(shot2.result.data, 'base64'));
    console.log('截图: 91-live-game.png');
  }

  console.log('');
  const errs = await evaluate('window.__errs || []');
  const list2 = errs.value || [];
  if (list2.length) {
    console.log('❌ 页面错误 ' + list2.length + ' 条：');
    list2.slice(0, 10).forEach((e) => console.log('  - ' + String(e).split('\n')[0].slice(0, 180)));
  } else {
    console.log('✅ 公网页面无 JS 错误');
  }

  process.exit(0);
})().catch((e) => { console.error('失败: ' + e.message); process.exit(1); });

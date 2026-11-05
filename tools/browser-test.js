/* ============================================================
 * browser-test.js — 用 CDP 驱动 headless Edge 做端到端检查
 *   node tools/browser-test.js
 * 会输出截图到 tools/shots/ 并回报 console 报错
 * ============================================================ */
'use strict';

const fs = require('fs');
const path = require('path');
const http = require('http');

const APP = 'http://127.0.0.1:18080/';
const CDP = 'http://127.0.0.1:9222';
const SHOT_DIR = path.join(__dirname, 'shots');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function httpJson(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
      let b = '';
      res.on('data', (c) => (b += c));
      res.on('end', () => {
        try { resolve(JSON.parse(b)); } catch (e) { reject(e); }
      });
    }).on('error', reject);
  });
}

async function connect() {
  const list = await httpJson(CDP + '/json');
  const page = list.find((t) => t.type === 'page');
  if (!page) throw new Error('没有可用的 page target');

  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((res, rej) => {
    ws.onopen = res;
    ws.onerror = rej;
  });

  let seq = 0;
  const pending = new Map();
  const logs = [];
  const errors = [];

  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) {
      pending.get(m.id)(m);
      pending.delete(m.id);
      return;
    }
    if (m.method === 'Runtime.consoleAPICalled') {
      const text = (m.params.args || []).map((a) => a.value ?? a.description ?? '').join(' ');
      logs.push({ level: m.params.type, text });
    }
    if (m.method === 'Runtime.exceptionThrown') {
      const d = m.params.exceptionDetails;
      errors.push(d.exception?.description || d.text);
    }
    if (m.method === 'Log.entryAdded' && m.params.entry.level === 'error') {
      errors.push(m.params.entry.text);
    }
  };

  const send = (method, params) => new Promise((resolve) => {
    const id = ++seq;
    pending.set(id, resolve);
    ws.send(JSON.stringify({ id, method, params }));
  });

  const evaluate = async (expr, awaitPromise = false) => {
    const r = await send('Runtime.evaluate', {
      expression: expr,
      returnByValue: true,
      awaitPromise,
      userGesture: true
    });
    if (r.result?.exceptionDetails) {
      return { error: r.result.exceptionDetails.exception?.description || 'eval error' };
    }
    return { value: r.result?.result?.value };
  };

  const shot = async (name) => {
    const r = await send('Page.captureScreenshot', { format: 'png' });
    if (!r.result?.data) return null;
    fs.mkdirSync(SHOT_DIR, { recursive: true });
    const p = path.join(SHOT_DIR, name);
    fs.writeFileSync(p, Buffer.from(r.result.data, 'base64'));
    return p;
  };

  const shotClip = async (name, clip) => {
    const r = await send('Page.captureScreenshot', { format: 'png', clip });
    if (!r.result?.data) return null;
    fs.mkdirSync(SHOT_DIR, { recursive: true });
    const p = path.join(SHOT_DIR, name);
    fs.writeFileSync(p, Buffer.from(r.result.data, 'base64'));
    return p;
  };

  return { ws, send, evaluate, shot, shotClip, logs, errors };
}

async function main() {
  const { send, evaluate, shot, shotClip } = await connect();

  await send('Runtime.enable');
  await send('Page.enable');

  /* 页面级错误收集器：只抓本次加载的错误，不受 CDP log 回放干扰 */
  await send('Page.addScriptToEvaluateOnNewDocument', {
    source: `
      window.__errs = [];
      window.addEventListener('error', (e) => {
        window.__errs.push('error: ' + (e.message || '') + ' @' + (e.filename || '') + ':' + (e.lineno || 0));
      });
      window.addEventListener('unhandledrejection', (e) => {
        window.__errs.push('rejection: ' + String(e.reason && e.reason.stack || e.reason));
      });
      (function () {
        const ce = console.error;
        console.error = function (...a) {
          window.__errs.push('console.error: ' + a.map(String).join(' ').slice(0, 300));
          return ce.apply(console, a);
        };
      })();
    `
  });

  await send('Emulation.setDeviceMetricsOverride', {
    width: 1440, height: 900, deviceScaleFactor: 1, mobile: false
  });

  await send('Page.navigate', { url: APP });
  await sleep(2400);
  await evaluate('(()=>{const b=document.getElementById("prologueSkip");if(b)b.click();return true;})()');
  await sleep(500);

  const out = [];
  const step = (label, v) => out.push(label + '：' + JSON.stringify(v));

  /* ---------- 1. 开场 ---------- */
  step('页面标题', await evaluate('document.title'));
  step('intro 可见', await evaluate('!document.getElementById("intro").hidden'));
  step('stage 隐藏', await evaluate('document.getElementById("stage").hidden'));
  step('封面卡片数', await evaluate('document.querySelectorAll(".cover").length'));
  step('座位数', await evaluate('document.querySelectorAll(".seat").length'));
  await shot('01-intro.png');

  /* ---------- 2. 切主题 ---------- */
  await evaluate('document.querySelectorAll(".cover")[1].click()');
  await sleep(500);
  step('主题切换后 body', await evaluate('document.body.dataset.theme'));
  await shot('02-intro-structure.png');

  /* 切回第一套 */
  await evaluate('document.querySelectorAll(".cover")[0].click()');
  await sleep(300);

  /* ---------- 3. 改人数 ---------- */
  await evaluate('document.querySelector("[data-count=\'3\']").click()');
  await sleep(300);
  step('3 人座位数', await evaluate('document.querySelectorAll(".seat").length'));
  await shot('03-intro-3p.png');

  /* ---------- 4. 开局 ---------- */
  await evaluate('document.getElementById("btnStart").click()');
  await sleep(2600);

  step('stage 可见', await evaluate('!document.getElementById("stage").hidden'));
  step('棋盘格子数', await evaluate('document.querySelectorAll(".cell[data-z]").length'));
  step('特殊格数', await evaluate('document.querySelectorAll(".cell[data-special]").length'));
  step('进系入口格', await evaluate(
    '[...document.querySelectorAll(".cell--gate")].map(c=>({slot:c.dataset.slot,row:c.style.gridRow,col:c.style.gridColumn,txt:c.textContent}))'
  ));
  step('棋子数', await evaluate('document.querySelectorAll(".token").length'));
  step('玩家行数', await evaluate('document.querySelectorAll(".player").length'));
  step('图例项数', await evaluate('document.querySelectorAll(".legend__item").length'));
  step('app.state 存在', await evaluate('!!window.EPF.app.state'));
  step('起始位置', await evaluate('window.EPF.app.state.players.map(p=>p.pos)'));
  step('cell 实测宽度', await evaluate(
    'getComputedStyle(document.documentElement).getPropertyValue("--cell")'
  ));
  step('棋盘实际尺寸', await evaluate(
    '(()=>{const r=document.querySelector(".board").getBoundingClientRect();' +
    'return {w:Math.round(r.width),h:Math.round(r.height)};})()'
  ));
  step('滚动容器尺寸', await evaluate(
    '(()=>{const s=document.querySelector(".board-scroll");' +
    'return {cw:s.clientWidth,ch:s.clientHeight,sw:s.scrollWidth,sh:s.scrollHeight};})()'
  ));
  step('H / He 存在', await evaluate(
    '["1","2"].map(z=>{const c=document.querySelector(\'.cell[data-z="\'+z+\'"]\');' +
    'if(!c)return null;const r=c.getBoundingClientRect();' +
    'return {z,w:Math.round(r.width),h:Math.round(r.height),name:c.querySelector(".cell__name").textContent};})'
  ));
  await shot('04-stage.png');

  /* 棋盘局部特写 ×2 */
  const br = await evaluate(
    '(()=>{const r=document.querySelector(".board").getBoundingClientRect();' +
    'return {x:r.x,y:r.y,width:r.width,height:r.height};})()'
  );
  if (br.value) {
    await shotClip('04b-board-2x.png', {
      x: Math.round(br.value.x), y: Math.round(br.value.y),
      width: Math.round(br.value.width), height: Math.round(br.value.height),
      scale: 2
    });
  }

  /* ---------- 5. 掷骰若干回合 ---------- */
  let rollClicks = 0;
  let waited = 0;
  while (waited < 70000 && rollClicks < 10) {
    const st = await evaluate(
      'JSON.stringify({phase:window.EPF.app.state.phase,turn:window.EPF.app.state.turn,' +
      'canClick:!document.getElementById("btnRoll").disabled,' +
      'modal:!document.getElementById("modal").hidden})'
    );
    let s = {};
    try { s = JSON.parse(st.value); } catch (e) { /* noop */ }
    if (s.phase === 'over') break;

    if (s.modal) {
      // 决斗选人弹窗：挑第一个对手
      await evaluate('(document.querySelector(".duel-pick")||{click(){}}).click()');
      await sleep(1200);
      waited += 1200;
      continue;
    }
    if (s.canClick) {
      await evaluate('document.getElementById("btnRoll").click()');
      rollClicks++;
      await sleep(1500);
      waited += 1500;
    } else {
      await sleep(400);
      waited += 400;
    }
  }
  step('点了多少次骰子', rollClicks);
  step('当前各玩家位置', await evaluate('window.EPF.app.state.players.map(p=>p.pos)'));
  step('LCM 数值行', await evaluate('document.getElementById("lcdVal").textContent'));
  step('LCD 输出行', await evaluate('document.getElementById("lcdOut").textContent'));
  step('日志条数', await evaluate('document.querySelectorAll(".log__item").length'));
  step('回合数', await evaluate('window.EPF.app.state.round'));
  step('active 一致性', await evaluate(`
    (() => {
      const pill = document.getElementById('turnPill').textContent.trim();
      const rows = [...document.querySelectorAll('.player')].map(r => ({
        name: r.querySelector('.player__name').textContent.trim(),
        active: r.dataset.active
      }));
      const stateTurn = window.EPF.app.state.turn;
      return { pill, stateTurn, activeIdx: rows.findIndex(r => r.active === '1'), rows };
    })()
  `));
  await shot('05-midgame.png');

  /* ---------- 6. 移动端视口 ---------- */
  await send('Emulation.setDeviceMetricsOverride', {
    width: 414, height: 896, deviceScaleFactor: 2, mobile: true
  });
  await sleep(900);
  step('横滚容器有溢出', await evaluate(
    '(()=>{const s=document.querySelector(".board-scroll");return {sw:s.scrollWidth,cw:s.clientWidth};})()'
  ));
  await shot('06-mobile.png');

  /* ---------- 7. 规则弹窗 ---------- */
  await send('Emulation.setDeviceMetricsOverride', {
    width: 1440, height: 900, deviceScaleFactor: 1, mobile: false
  });
  await sleep(500);
  await evaluate('document.getElementById("btnMenu").click()');
  await sleep(500);
  await shot('07-menu.png');
  await evaluate('document.querySelector("[data-act=\\"rules\\"]").click()');
  await sleep(600);
  step('规则弹窗打开', await evaluate('!document.getElementById("modal").hidden'));
  await shot('08-rules.png');

  console.log(out.join('\n'));
  console.log('');
  console.log('截图目录：', SHOT_DIR);

  const pageErrs = await evaluate('window.__errs || []');
  const list = pageErrs.value || [];
  if (list.length) {
    console.log('\n❌ 页面错误 ' + list.length + ' 条：');
    list.slice(0, 20).forEach((e) => console.log('  -', String(e).split('\n')[0].slice(0, 200)));
  } else {
    console.log('\n✅ 页面无 JS 错误');
  }

  process.exit(list.length ? 1 : 0);
}

main().catch((e) => {
  console.error('测试脚本自身失败：', e);
  process.exit(2);
});

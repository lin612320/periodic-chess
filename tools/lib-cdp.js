/* ============================================================
 * lib-cdp.js — CDP 连接与常用操作的薄封装
 * ============================================================ */
'use strict';

const fs = require('fs');
const path = require('path');
const http = require('http');

const CDP = 'http://127.0.0.1:' + (process.env.EPF_CDP_PORT || '9222');
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

async function connect(targetId) {
  const list = await httpJson(CDP + '/json');
  const page = targetId
    ? list.find((t) => t.id === targetId && t.type === 'page')
    : list.find((t) => t.type === 'page');
  if (!page) throw new Error('没有可用的 page target: ' + (targetId || '(default)'));

  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });

  let seq = 0;
  const pending = new Map();

  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) {
      pending.get(m.id)(m);
      pending.delete(m.id);
    }
  };

  const send = (method, params) => new Promise((resolve) => {
    const id = ++seq;
    pending.set(id, resolve);
    ws.send(JSON.stringify({ id, method, params }));
  });

  /* 测试必须读最新代码，绝不能用磁盘缓存里的旧 js */
  await send('Network.enable');
  await send('Network.setCacheDisabled', { cacheDisabled: true });
  await send('Page.enable');

  const evaluate = async (expr) => {
    const r = await send('Runtime.evaluate', {
      expression: expr, returnByValue: true, awaitPromise: true, userGesture: true
    });
    if (r.result?.exceptionDetails) {
      return { error: r.result.exceptionDetails.exception?.description || 'eval error' };
    }
    return { value: r.result?.result?.value };
  };

  const save = (result, name) => {
    if (!result?.result?.data) return null;
    fs.mkdirSync(SHOT_DIR, { recursive: true });
    const p = path.join(SHOT_DIR, name);
    fs.writeFileSync(p, Buffer.from(result.result.data, 'base64'));
    return p;
  };

  const shot = async (name) => save(await send('Page.captureScreenshot', { format: 'png' }), name);

  const shotClip = async (name, clip) =>
    save(await send('Page.captureScreenshot', { format: 'png', clip }), name);

  const installErrorTrap = () => send('Page.addScriptToEvaluateOnNewDocument', {
    source: `
      window.__errs = [];
      window.addEventListener('error', (e) => window.__errs.push('error: ' + e.message + ' @' + (e.filename||'') + ':' + (e.lineno||0)));
      window.addEventListener('unhandledrejection', (e) => window.__errs.push('rejection: ' + String(e.reason && e.reason.stack || e.reason)));
      (function(){ const ce = console.error; console.error = function(...a){ window.__errs.push('console.error: ' + a.map(String).join(' ').slice(0,300)); return ce.apply(console, a); }; })();
    `
  });

  const errs = async () => (await evaluate('window.__errs || []')).value || [];

  /** 跳过序章，直接到设置面板 */
  const skipPrologue = async () => {
    await evaluate('(()=>{const b=document.getElementById("prologueSkip");if(b)b.click();return true;})()');
    await sleep(300);
  };

  return { ws, send, evaluate, shot, shotClip, installErrorTrap, errs, skipPrologue };
}

module.exports = { connect, sleep, SHOT_DIR, httpJson, CDP };

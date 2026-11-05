/* ============================================================
 * probe-turn.js — 探测哪些公开 TURN 真的能用
 *   node tools/probe-turn.js
 * 在真实浏览器里建 RTCPeerConnection，看能不能拿到 type=relay 的候选。
 * 只有拿到 relay，才说明这个 TURN 真能中继数据。
 * ============================================================ */
'use strict';

const { connect, sleep } = require('./lib-cdp');

const APP = 'http://127.0.0.1:18080/';

const CANDIDATES = [
  {
    name: 'freestun.net (free/free)',
    iceServers: [
      { urls: 'turn:freestun.net:3478', username: 'free', credential: 'free' },
      { urls: 'turn:freestun.net:3478?transport=tcp', username: 'free', credential: 'free' }
    ]
  },
  {
    name: 'freestun.net (free/freestun)',
    iceServers: [
      { urls: 'turn:freestun.net:3478', username: 'free', credential: 'freestun' }
    ]
  },
  {
    name: 'expressturn relay1 (free/free)',
    iceServers: [
      { urls: 'turn:relay1.expressturn.com:3478', username: 'free', credential: 'free' }
    ]
  },
  {
    name: 'openrelay.metered.ca (已停用?)',
    iceServers: [
      { urls: 'turn:openrelay.metered.ca:80', username: 'openrelayproject', credential: 'openrelayproject' }
    ]
  },
  {
    name: '仅 STUN（对照组）',
    iceServers: [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun.cloudflare.com:3478' }
    ]
  }
];

const PROBE = `
(async (iceServers) => {
  return new Promise((resolve) => {
    const out = { relay: null, host: null, srflx: null, total: 0, err: null };
    let pc;
    try {
      pc = new RTCPeerConnection({ iceServers: iceServers, iceTransportPolicy: 'all' });
    } catch (e) {
      resolve(Object.assign(out, { err: '构造失败: ' + e.message }));
      return;
    }
    let done = false;
    function finish() {
      if (done) return;
      done = true;
      try { pc.close(); } catch (e) {}
      resolve(out);
    }
    const timer = setTimeout(finish, 9000);
    pc.onicecandidate = (e) => {
      if (!e.candidate) { clearTimeout(timer); finish(); return; }
      out.total++;
      const c = e.candidate;
      const t = c.type || (/ typ (\\w+)/.exec(c.candidate || '') || [])[1];
      if (t === 'relay' && !out.relay) out.relay = c.candidate;
      if (t === 'host' && !out.host) out.host = c.candidate;
      if (t === 'srflx' && !out.srflx) out.srflx = c.candidate;
    };
    pc.createDataChannel('probe');
    pc.createOffer().then(o => pc.setLocalDescription(o)).catch(e => {
      out.err = 'createOffer: ' + e.message;
      clearTimeout(timer);
      finish();
    });
  });
})`;

(async () => {
  const P = await connect();
  await P.send('Runtime.enable');
  await P.send('Page.enable');
  await P.send('Page.navigate', { url: APP });
  await sleep(3000);

  console.log('候选 TURN 探测（拿到 relay 才算可用）\n');

  for (const c of CANDIDATES) {
    const expr = PROBE + '(' + JSON.stringify(c.iceServers) + ')';
    let r;
    try {
      r = (await P.evaluate(expr)).value;
    } catch (e) {
      r = { err: e.message };
    }
    if (!r) { console.log(c.name + ' → 无返回'); continue; }

    const relayed = !!r.relay;
    console.log(
      (relayed ? '✅' : '❌') + '  ' + c.name
      + '\n     候选 ' + (r.total || 0)
      + '  host=' + (r.host ? '有' : '无')
      + '  srflx=' + (r.srflx ? '有' : '无')
      + '  relay=' + (relayed ? '有 ✔' : '无')
      + (r.err ? '\n     错误: ' + r.err : '')
    );
    if (relayed) console.log('     ' + r.relay.slice(0, 120));
    console.log('');
  }

  process.exit(0);
})().catch((e) => { console.error('失败:', e.message); process.exit(1); });

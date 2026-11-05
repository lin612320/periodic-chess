#!/usr/bin/env node
/* ============================================================
 * server.js — 元素周期表飞行棋 · 局域网中转
 * -----------------------------------------------------------
 * 零依赖：只用 Node 内置模块，自带静态服务 + 最小 WebSocket。
 *
 *   node server.js            默认 18080
 *   node server.js 3000       指定端口
 *
 * 同一 WiFi 下，其他设备访问终端打印的内网地址即可。
 * 服务器只做「转发」，不跑规则：主机算随机数，客户端只发意图，
 * 这样天然防作弊、防不同步。
 * ============================================================ */
'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const os = require('os');

const ROOT = __dirname;
const PORT = Number(process.argv[2] || process.env.PORT || 18080);

/* ------------------------------------------------------------
 * 静态文件
 * ---------------------------------------------------------- */
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.mp3': 'audio/mpeg',
  '.ogg': 'audio/ogg',
  '.md': 'text/markdown; charset=utf-8'
};

function safeResolve(urlPath) {
  let p = decodeURIComponent(urlPath.split('?')[0].split('#')[0]);
  if (p === '/' || p === '') p = '/index.html';
  const abs = path.normalize(path.join(ROOT, p));
  if (!abs.startsWith(ROOT)) return null;   // 防目录穿越
  return abs;
}

const server = http.createServer((req, res) => {
  const file = safeResolve(req.url || '/');
  if (!file) { res.writeHead(403); res.end('403'); return; }

  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('404 ' + req.url);
      return;
    }
    const ext = path.extname(file).toLowerCase();
    res.writeHead(200, {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Cache-Control': 'no-store, must-revalidate',
      'Content-Length': st.size
    });
    fs.createReadStream(file).pipe(res);
  });
});

/* ------------------------------------------------------------
 * 最小 WebSocket 实现（RFC 6455，只支持文本帧）
 * ---------------------------------------------------------- */
const WS_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';

function encodeFrame(opcode, payload) {
  const data = Buffer.isBuffer(payload) ? payload : Buffer.from(String(payload), 'utf8');
  const len = data.length;
  let head;
  if (len < 126) {
    head = Buffer.alloc(2);
    head[1] = len;
  } else if (len < 65536) {
    head = Buffer.alloc(4);
    head[1] = 126;
    head.writeUInt16BE(len, 2);
  } else {
    head = Buffer.alloc(10);
    head[1] = 127;
    head.writeBigUInt64BE(BigInt(len), 2);
  }
  head[0] = 0x80 | opcode;
  return Buffer.concat([head, data]);
}

/** 从缓冲区切一帧；不够长返回 null */
function readFrame(buf) {
  if (buf.length < 2) return null;
  const b0 = buf[0];
  const b1 = buf[1];
  const fin = (b0 & 0x80) !== 0;
  const opcode = b0 & 0x0f;
  const masked = (b1 & 0x80) !== 0;
  let len = b1 & 0x7f;
  let offset = 2;

  if (len === 126) {
    if (buf.length < offset + 2) return null;
    len = buf.readUInt16BE(offset);
    offset += 2;
  } else if (len === 127) {
    if (buf.length < offset + 8) return null;
    const big = buf.readBigUInt64BE(offset);
    if (big > BigInt(4 * 1024 * 1024)) return { fatal: 'frame too large' };
    len = Number(big);
    offset += 8;
  }

  let maskKey = null;
  if (masked) {
    if (buf.length < offset + 4) return null;
    maskKey = buf.slice(offset, offset + 4);
    offset += 4;
  }

  if (buf.length < offset + len) return null;

  let payload = buf.slice(offset, offset + len);
  if (masked) {
    const out = Buffer.allocUnsafe(len);
    for (let i = 0; i < len; i++) out[i] = payload[i] ^ maskKey[i & 3];
    payload = out;
  }

  return { fin, opcode, payload, total: offset + len };
}

const clients = new Set();

server.on('upgrade', (req, socket) => {
  const key = req.headers['sec-websocket-key'];
  if (!key) { socket.destroy(); return; }

  const accept = crypto
    .createHash('sha1')
    .update(key + WS_GUID)
    .digest('base64');

  socket.write(
    'HTTP/1.1 101 Switching Protocols\r\n' +
    'Upgrade: websocket\r\n' +
    'Connection: Upgrade\r\n' +
    'Sec-WebSocket-Accept: ' + accept + '\r\n\r\n'
  );

  const conn = {
    socket,
    id: crypto.randomBytes(3).toString('hex'),
    room: null,
    name: '玩家',
    alive: true,
    send(obj) {
      if (!this.alive) return;
      try { socket.write(encodeFrame(0x1, JSON.stringify(obj))); } catch (e) { this.close(); }
    },
    close() {
      if (!this.alive) return;
      this.alive = false;
      clients.delete(this);
      if (this.room) broadcastRoom(this.room);
      try { socket.end(); } catch (e) { /* noop */ }
    }
  };

  clients.add(conn);
  socket.setNoDelay(true);

  let buf = Buffer.alloc(0);
  socket.on('data', (chunk) => {
    buf = Buffer.concat([buf, chunk]);
    for (;;) {
      const f = readFrame(buf);
      if (!f) break;
      if (f.fatal) { conn.close(); return; }
      buf = buf.slice(f.total);

      if (f.opcode === 0x8) { conn.close(); return; }
      if (f.opcode === 0x9) { socket.write(encodeFrame(0xA, f.payload)); continue; }
      if (f.opcode !== 0x1) continue;

      let msg;
      try { msg = JSON.parse(f.payload.toString('utf8')); } catch (e) { continue; }
      handleMessage(conn, msg);
    }
  });

  socket.on('error', () => conn.close());
  socket.on('close', () => conn.close());

  conn.send({ t: 'hello', id: conn.id });
});

/* ------------------------------------------------------------
 * 房间逻辑：服务器只转发
 * ---------------------------------------------------------- */
function roomMembers(room) {
  const out = [];
  for (const c of clients) if (c.room === room && c.alive) out.push(c);
  return out;
}

function broadcastRoom(room, except) {
  const members = roomMembers(room);
  const roster = members.map((c, i) => ({
    connId: c.id, name: c.name, seat: i, isHost: i === 0
  }));
  members.forEach((c) => {
    if (except && c === except) return;
    c.send({ t: 'room', room, you: c.id, roster });
  });
}

function handleMessage(conn, msg) {
  if (!msg || typeof msg.t !== 'string') return;

  switch (msg.t) {
    case 'join': {
      const room = String(msg.room || '').toUpperCase().slice(0, 8) || 'DEMO';
      conn.room = room;
      conn.name = String(msg.name || '玩家').slice(0, 12);
      broadcastRoom(room);
      console.log(`[join] ${conn.name} (${conn.id}) → 房间 ${room}`);
      break;
    }
    case 'rename': {
      conn.name = String(msg.name || conn.name).slice(0, 12);
      if (conn.room) broadcastRoom(conn.room);
      break;
    }
    // 主机 → 所有人：事件流 / 状态快照 / 决斗征询 / 出手授权
    case 'events':
    case 'snapshot':
    case 'start':
    case 'grant':
    case 'duel-request': {
      if (!conn.room) return;
      const members = roomMembers(conn.room);
      if (members[0] !== conn) return;  // 只有主机能广播权威状态
      members.forEach((c) => { if (c !== conn) c.send(msg); });
      break;
    }
    // 客户端 → 主机：意图
    case 'intent': {
      if (!conn.room) return;
      const members = roomMembers(conn.room);
      const host = members[0];
      if (!host || host === conn) return;
      host.send({ t: 'intent', from: conn.id, fromName: conn.name, kind: msg.kind, payload: msg.payload });
      break;
    }
    case 'chat': {
      if (!conn.room) return;
      roomMembers(conn.room).forEach((c) => c.send({ t: 'chat', from: conn.name, text: String(msg.text || '').slice(0, 120) }));
      break;
    }
    default:
      break;
  }
}

/* ------------------------------------------------------------
 * 启动
 * ---------------------------------------------------------- */
function lanAddresses() {
  const out = [];
  const nets = os.networkInterfaces();
  for (const name of Object.keys(nets)) {
    for (const ni of nets[name] || []) {
      if (ni.family === 'IPv4' && !ni.internal) out.push({ name, address: ni.address });
    }
  }
  return out;
}

server.on('error', (err) => {
  if (err.code === 'EACCES') {
    console.error('\n  端口 ' + PORT + ' 被系统拒绝（EACCES）。换个高位端口重试：');
    console.error('    node server.js 18080\n');
  } else if (err.code === 'EADDRINUSE') {
    console.error('\n  端口 ' + PORT + ' 已被占用。换一个：');
    console.error('    node server.js ' + (PORT + 1) + '\n');
  } else {
    console.error('\n  服务启动失败：', err.message, '\n');
  }
  process.exit(1);
});

server.listen(PORT, '0.0.0.0', () => {
  const lines = [];
  lines.push('');
  lines.push('  元素周期表飞行棋 · 本地服务已启动');
  lines.push('  ────────────────────────────────────────');
  lines.push('  本机：    http://127.0.0.1:' + PORT);
  lanAddresses().forEach((a) => {
    lines.push('  局域网：  http://' + a.address + ':' + PORT + '   (' + a.name + ')');
  });
  lines.push('  ────────────────────────────────────────');
  lines.push('  同一 WiFi 下，其他设备输入上面的「局域网」地址');
  lines.push('  按 Ctrl + C 停止');
  lines.push('');
  console.log(lines.join('\n'));
});

process.on('SIGINT', () => {
  console.log('\n  已停止。');
  process.exit(0);
});

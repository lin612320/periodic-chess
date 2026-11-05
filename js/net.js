/* ============================================================
 * net.js — 联机协议层（两种传输）
 * -----------------------------------------------------------
 *   p2p-host  : 点「开房间」的设备 —— 它自己就是服务器
 *   p2p-client: 点「加入房间」的设备 —— 直连房主
 *   ws        : 本地 server.js 中转（旧方式，保留兼容）
 *
 * 上层协议完全一样（room / start / events / intent），
 * 只是把「发一条消息」换成发到 DataChannel 还是发到 WebSocket。
 *
 * 仍然是主机权威：所有判定与随机数只在房主设备上跑，
 * 客机只发意图、按事件流回放动画 —— 改不了随机数，也不会不同步。
 * ============================================================ */
(function (global) {
  'use strict';

  var mode = 'none';            // none | ws | p2p-host | p2p-client
  var ws = null;
  var handlers = Object.create(null);

  var peers = [];               // p2p-host：每个客机一条
  var hostChannel = null;       // p2p-client：到房主的通道
  var roster = [];
  var pendingReady = null;
  var p2pRoom = null;           // PeerJS 的房间句柄（房主或客机）

  var me = {
    connected: false,
    connId: null,
    room: null,
    roster: [],
    seat: -1,
    isHost: false,
    name: ''
  };

  function emit(type, payload) {
    var list = handlers[type];
    if (!list) return;
    for (var i = 0; i < list.length; i++) {
      try { list[i](payload); } catch (e) { console.error('[net] handler 出错', type, e); }
    }
  }

  function on(type, fn) {
    (handlers[type] = handlers[type] || []).push(fn);
  }

  function uid() {
    return 'p' + Math.random().toString(36).slice(2, 8);
  }

  /* =========================================================
   * 通用消息路由
   * ======================================================= */
  function route(msg) {
    switch (msg.t) {
      case 'hello':
        me.connId = msg.id;
        if (pendingReady) {
          var fn = pendingReady;
          pendingReady = null;
          fn({ connId: msg.id });
        }
        break;

      case 'room': {
        me.room = msg.room;
        roster = msg.roster || [];
        me.roster = roster;
        me.connId = msg.you || me.connId;
        me.seat = -1;
        for (var i = 0; i < roster.length; i++) {
          if (roster[i].connId === me.connId) { me.seat = i; break; }
        }
        me.isHost = me.seat === 0;
        me.connected = true;
        emit('room', {
          room: me.room, you: me.connId, roster: roster,
          seat: me.seat, isHost: me.isHost
        });
        break;
      }

      case 'start':    emit('start', msg); break;
      case 'snapshot': emit('snapshot', msg); break;
      case 'events':   emit('events', msg.events || []); break;
      case 'intent':   emit('intent', msg); break;
      case 'duel-request': emit('duel-request', msg); break;
      case 'chat':     emit('chat', msg); break;
      default: break;
    }
  }

  /* =========================================================
   * WebSocket 传输（保留给本地 server.js）
   * ======================================================= */
  function wsUrl() {
    var proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    return proto + '//' + location.host + '/';
  }

  function connect(opts) {
    return new Promise(function (resolve, reject) {
      if (ws && (ws.readyState === 0 || ws.readyState === 1)) {
        reject(new Error('已经连着了'));
        return;
      }
      var room = String(opts.room || '').toUpperCase().trim();
      var name = String(opts.name || '玩家').trim().slice(0, 12);

      try {
        ws = new WebSocket(wsUrl());
      } catch (e) { reject(e); return; }

      var settled = false;
      var timer = setTimeout(function () {
        if (settled) return;
        settled = true;
        try { ws.close(); } catch (e) { /* noop */ }
        reject(new Error('连接超时'));
      }, 7000);

      pendingReady = function (info) {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        mode = 'ws';
        resolve(info);
      };

      ws.onerror = function () {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        pendingReady = null;
        reject(new Error('这个地址没有 WebSocket 服务（纯静态托管）。用「开房间 / 加入房间」直连'));
      };

      ws.onclose = function () {
        me.connected = false;
        emit('closed');
      };

      ws.onmessage = function (ev) {
        var msg;
        try { msg = JSON.parse(ev.data); } catch (e) { return; }
        route(msg);
      };

      me.room = room;
      me.name = name;
    });
  }

  function join(room, name) {
    if (!ws || ws.readyState !== 1) return false;
    try { ws.send(JSON.stringify({ t: 'join', room: room, name: name })); return true; } catch (e) { return false; }
  }

  /* =========================================================
   * P2P 房主
   * ======================================================= */
  function publishRoom() {
    var payload = { t: 'room', room: me.room, roster: roster };
    route(Object.assign({}, payload, { you: me.connId }));
    peers.forEach(function (p) {
      if (p.channel.isOpen()) {
        p.channel.send(Object.assign({}, payload, { you: p.connId }));
      }
    });
  }

  function hostRoute(msg, peer) {
    if (!msg || typeof msg.t !== 'string') return;

    if (msg.t === 'hello') {
      peer.name = String(msg.name || '玩家').slice(0, 12);
      peer.seat = roster.length;
      roster.push({ connId: peer.connId, name: peer.name, seat: peer.seat, isHost: false });
      publishRoom();
      emit('peer-joined', { connId: peer.connId, name: peer.name });
      return;
    }

    if (msg.t === 'intent') {
      emit('intent', {
        t: 'intent',
        from: peer.connId,
        fromName: peer.name,
        kind: msg.kind,
        payload: msg.payload
      });
      return;
    }

    if (msg.t === 'chat') {
      emit('chat', { t: 'chat', from: peer.name, text: String(msg.text || '').slice(0, 120) });
    }
  }

  /** 开房间：房主身份就位，占一个房间码 */
  async function startHost(name) {
    var P = global.EPF.p2p;
    if (!P || !P.ready()) throw new Error('联机库没加载，刷新页面');

    mode = 'p2p-host';
    me.name = String(name || '房主').trim().slice(0, 12);
    me.connId = 'host';
    me.room = '';
    me.seat = 0;
    me.isHost = true;
    me.connected = true;
    roster = [{ connId: 'host', name: me.name, seat: 0, isHost: true }];
    me.roster = roster;
    peers = [];

    var room = await P.hostRoom();
    p2pRoom = room;
    me.room = room.code;

    room.onConnection(function (channel) {
      var peer = { connId: uid(), name: '玩家', seat: -1, channel: channel };
      channel.onMessage(function (msg) { hostRoute(msg, peer); });
      channel.onClose(function () {
        peers = peers.filter(function (p) { return p !== peer; });
        if (peer.seat >= 0) {
          roster = roster.filter(function (r) { return r.connId !== peer.connId; });
          roster.forEach(function (r, i) { r.seat = i; });
          publishRoom();
        }
        emit('peer-left', { connId: peer.connId, name: peer.name });
      });
      peers.push(peer);
      emit('peer-linked', { connId: peer.connId });
    });

    emit('room', { room: room.code, you: 'host', roster: roster, seat: 0, isHost: true });
    return { code: room.code };
  }

  /* =========================================================
   * P2P 客机
   * ======================================================= */
  async function joinRoom(code, name) {
    var P = global.EPF.p2p;
    if (!P || !P.ready()) throw new Error('联机库没加载，刷新页面');

    mode = 'p2p-client';
    me.name = String(name || '玩家').trim().slice(0, 12);
    me.isHost = false;

    var r = await P.joinRoom(code);
    p2pRoom = r;
    hostChannel = r.channel;
    me.room = r.code;

    hostChannel.onMessage(function (msg) { route(msg); });
    hostChannel.onClose(function () {
      me.connected = false;
      emit('closed');
    });

    /* 通道已 open，立刻自报家门 */
    var sent = hostChannel.send({ t: 'hello', name: me.name });
    if (!sent) {
      /* 极端情况下刚打开还没写入，退一帧再发 */
      setTimeout(function () { hostChannel.send({ t: 'hello', name: me.name }); }, 120);
    }

    /* 等房主把座位分配下来 */
    await new Promise(function (resolve, reject) {
      var done = false;
      var timer = setTimeout(function () {
        if (done) return;
        done = true;
        reject(new Error('房主没响应，可能已经关了房间'));
      }, 12000);

      on('room', function () {
        if (done) return;
        done = true;
        clearTimeout(timer);
        resolve();
      });
    });

    return { code: r.code, seat: me.seat };
  }

  /* =========================================================
   * 发送
   * ======================================================= */
  function raw(obj) {
    if (!ws || ws.readyState !== 1) return false;
    try { ws.send(JSON.stringify(obj)); return true; } catch (e) { return false; }
  }

  function broadcast(msg) {
    /* 兼容两种调用：传事件数组（老写法）或传完整消息对象 */
    if (Array.isArray(msg)) msg = { t: 'events', events: msg };

    if (mode === 'p2p-host') {
      var n = 0;
      peers.forEach(function (p) {
        if (p.channel.isOpen() && p.channel.send(msg)) n++;
      });
      return n > 0;
    }
    if (mode === 'ws') return raw(msg);
    return false;
  }

  function start(config, snapshot)  { return broadcast({ t: 'start', config: config, snapshot: snapshot }); }
  function events(list)             { return broadcast({ t: 'events', events: list }); }
  function snapshot(state)          { return broadcast({ t: 'snapshot', snapshot: pack(state) }); }

  function intent(kind, payload) {
    var msg = { t: 'intent', kind: kind, payload: payload || null };
    if (mode === 'p2p-client') {
      return (hostChannel && hostChannel.isOpen()) ? hostChannel.send(msg) : false;
    }
    return raw(msg);
  }

  function relayRaw(obj) {
    if (mode === 'p2p-host') return broadcast(obj);
    return raw(obj);
  }

  function chat(text) {
    var msg = { t: 'chat', text: text };
    if (mode === 'p2p-client') {
      return (hostChannel && hostChannel.isOpen()) ? hostChannel.send(msg) : false;
    }
    if (mode === 'p2p-host') return broadcast(msg);
    return raw(msg);
  }

  function disconnect() {
    if (p2pRoom) {
      try { p2pRoom.close(); } catch (e) { /* noop */ }
      p2pRoom = null;
    }
    peers.forEach(function (p) { p.channel.close(); });
    peers = [];
    if (hostChannel) {
      hostChannel.close();
      hostChannel = null;
    }
    if (ws) { try { ws.close(); } catch (e) { /* noop */ } }
    ws = null;
    mode = 'none';
    me.connected = false;
    me.roster = [];
    roster = [];
    me.seat = -1;
    me.isHost = false;
  }

  /* =========================================================
   * 状态打包 / 影子状态推进
   * ======================================================= */
  function pack(state) {
    return {
      players: state.players.map(function (p) {
        return {
          id: p.id, name: p.name, isBot: p.isBot, pos: p.pos,
          color: p.color, sleeping: p.sleeping, finished: p.finished
        };
      }),
      turn: state.turn,
      phase: state.phase,
      round: state.round
    };
  }

  function unpack(snap) {
    return {
      players: snap.players.map(function (p) {
        return {
          id: p.id, name: p.name, isBot: p.isBot, pos: p.pos,
          color: p.color, sleeping: !!p.sleeping, finished: p.finished
        };
      }),
      turn: snap.turn,
      phase: snap.phase || 'ready',
      round: snap.round || 1,
      winner: null
    };
  }

  function applyEvent(state, ev) {
    if (!state || !ev) return;
    var p = (typeof ev.player === 'number') ? state.players[ev.player] : null;

    switch (ev.type) {
      case 'move':
      case 'arrow':
      case 'tornado':
        if (p) p.pos = ev.to;
        break;
      case 'sleep':
        if (p) p.sleeping = true;
        break;
      case 'wake':
        if (p) p.sleeping = false;
        break;
      case 'duel': {
        var loser = state.players[ev.loser];
        if (loser) loser.sleeping = true;
        break;
      }
      case 'win': {
        if (p) { p.finished = true; state.winner = p; }
        state.phase = 'over';
        break;
      }
      case 'turn':
        state.turn = ev.player;
        break;
      default: break;
    }
  }

  global.EPF = global.EPF || {};
  global.EPF.net = {
    on: on,
    connect: connect,
    join: join,
    joinRoom: joinRoom,
    startHost: startHost,
    start: start,
    broadcast: broadcast,
    events: events,
    snapshot: snapshot,
    intent: intent,
    relayRaw: relayRaw,
    chat: chat,
    disconnect: disconnect,
    pack: pack,
    unpack: unpack,
    applyEvent: applyEvent,
    me: me,
    get mode() { return mode; },
    get active() {
      if (mode === 'p2p-host') return peers.some(function (p) { return p.channel.isOpen(); });
      if (mode === 'p2p-client') return !!hostChannel && hostChannel.isOpen();
      return !!ws && ws.readyState === 1;
    }
  };
})(window);

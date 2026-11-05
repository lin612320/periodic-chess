/* ============================================================
 * net.js — 局域网联机（客户端协议层）
 * -----------------------------------------------------------
 * 设计：主机权威（host-authoritative）
 *   · 所有引擎判定与随机数只在主机跑
 *   · 主机把「事件流」广播出去，客机按同一份事件流回放动画
 *   · 客机只发「意图」（我要掷骰 / 我选他决斗），不改状态
 * 好处：不会不同步，也改不了随机数。
 * ============================================================ */
(function (global) {
  'use strict';

  var url = null;
  var ws = null;
  var handlers = Object.create(null);

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

  function wsUrl() {
    var proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    return proto + '//' + location.host + '/';
  }

  /* ---------------------------------------------------------
   * 连接
   *   ws 打开后服务器先发 hello，收到 hello 即视为通道就绪；
   *   join 是之后单独发的，room 广播只更新成员表。
   * ------------------------------------------------------- */
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
      } catch (e) {
        reject(e);
        return;
      }

      var settled = false;
      var timer = setTimeout(function () {
        if (settled) return;
        settled = true;
        try { ws.close(); } catch (e) { /* noop */ }
        reject(new Error('连接超时，确认 server.js 在跑'));
      }, 7000);

      pendingReady = function (info) {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(info);
      };

      ws.onerror = function () {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        pendingReady = null;
        reject(new Error('连不上 ' + location.host + ' —— 请用 node server.js 启动，而不是直接双击打开 index.html'));
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

  var pendingReady = null;

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
        me.roster = msg.roster || [];
        me.connId = msg.you || me.connId;
        me.seat = -1;
        for (var i = 0; i < me.roster.length; i++) {
          if (me.roster[i].connId === me.connId) { me.seat = i; break; }
        }
        me.isHost = me.seat === 0;
        me.connected = true;
        emit('room', {
          room: me.room, you: me.connId, roster: me.roster,
          seat: me.seat, isHost: me.isHost
        });
        break;
      }

      case 'start':
        emit('start', msg);
        break;

      case 'snapshot':
        emit('snapshot', msg);
        break;

      case 'events':
        emit('events', msg.events || []);
        break;

      case 'intent':
        emit('intent', msg);
        break;

      case 'duel-request':
        emit('duel-request', msg);
        break;

      case 'chat':
        emit('chat', msg);
        break;

      default:
        break;
    }
  }

  /* ---------------------------------------------------------
   * 发送
   * ------------------------------------------------------- */
  function raw(obj) {
    if (!ws || ws.readyState !== 1) return false;
    try { ws.send(JSON.stringify(obj)); return true; } catch (e) { return false; }
  }

  function join(room, name) {
    return raw({ t: 'join', room: room, name: name });
  }

  function start(config, snapshot) {
    return raw({ t: 'start', config: config, snapshot: snapshot });
  }

  function broadcast(events) {
    return raw({ t: 'events', events: events });
  }

  function snapshot(state) {
    return raw({ t: 'snapshot', snapshot: pack(state) });
  }

  function intent(kind, payload) {
    return raw({ t: 'intent', kind: kind, payload: payload || null });
  }

  function chat(text) {
    return raw({ t: 'chat', text: text });
  }

  /** 底层透传：给 duel-request 这类一次性消息用 */
  function relayRaw(obj) {
    return raw(obj);
  }

  function disconnect() {
    if (ws) {
      try { ws.close(); } catch (e) { /* noop */ }
    }
    ws = null;
    me.connected = false;
    me.roster = [];
    me.seat = -1;
    me.isHost = false;
  }

  /* ---------------------------------------------------------
   * 状态打包 / 影子状态推进（客机用）
   * ------------------------------------------------------- */
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
          color: p.color, sleeping: !!p.sleeping, finished: !!p.finished
        };
      }),
      turn: snap.turn,
      phase: snap.phase || 'ready',
      round: snap.round || 1,
      winner: null
    };
  }

  /**
   * 客机影子状态推进：只按事件改状态，不做任何判定。
   * 判定永远发生在主机。
   */
  function applyEvent(state, ev) {
    if (!state || !ev) return;
    var p = (typeof ev.player === 'number') ? state.players[ev.player] : null;

    switch (ev.type) {
      case 'move':
        if (p) p.pos = ev.to;
        break;
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
      default:
        break;
    }
  }

  /* ---------------------------------------------------------
   * 导出
   * ------------------------------------------------------- */
  global.EPF = global.EPF || {};
  global.EPF.net = {
    on: on,
    connect: connect,
    join: join,
    start: start,
    broadcast: broadcast,
    snapshot: snapshot,
    intent: intent,
    chat: chat,
    relayRaw: relayRaw,
    disconnect: disconnect,
    pack: pack,
    unpack: unpack,
    applyEvent: applyEvent,
    me: me,
    get active() { return !!ws && ws.readyState === 1; }
  };
})(window);

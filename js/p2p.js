/* ============================================================
 * p2p.js — 房间码直连（PeerJS）
 * -----------------------------------------------------------
 * 用法：
 *   房主 new Peer('epf-482913')  ← 房间码就是 peer id
 *   客机 peer.connect('epf-482913')
 *
 * 握手的信令由 PeerJS 的公共云（0.peerjs.com）转达，
 * 连上之后数据全部走浏览器之间的 DataChannel —— 房主设备就是服务器。
 *
 * 之前的「手动复制邀请码/应答码」方式已废弃：那是在没有信令服务时的
 * 妥协做法，体验太差。
 * ============================================================ */
(function (global) {
  'use strict';

  var PREFIX = 'epf-';
  var CODE_LEN = 6;

  var RTC_CONFIG = {
    iceServers: [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' },
      { urls: 'stun:stun.cloudflare.com:3478' }
    ]
  };

  function randomCode() {
    var s = '';
    for (var i = 0; i < CODE_LEN; i++) s += Math.floor(Math.random() * 10);
    return s;
  }

  function ready() {
    return typeof global.Peer === 'function';
  }

  /* ---------------------------------------------------------
   * 把一个 PeerJS DataConnection 包成统一通道
   * ------------------------------------------------------- */
  function wrapConn(conn) {
    var handlers = { message: [], open: [], close: [] };

    function fire(type, arg) {
      for (var i = 0; i < handlers[type].length; i++) {
        try { handlers[type][i](arg); } catch (e) { console.error('[p2p]', e); }
      }
    }

    conn.on('data', function (data) {
      var msg = data;
      if (typeof data === 'string') {
        try { msg = JSON.parse(data); } catch (e) { return; }
      }
      fire('message', msg);
    });
    conn.on('close', function () { fire('close'); });
    conn.on('error', function () { fire('close'); });

    return {
      raw: conn,
      isOpen: function () { return conn.open === true; },
      send: function (obj) {
        if (!conn.open) return false;
        try { conn.send(obj); return true; } catch (e) { return false; }
      },
      close: function () { try { conn.close(); } catch (e) { /* noop */ } },
      onMessage: function (fn) {
        handlers.message.push(fn);
        if (conn.open) {
          /* 已经打开过，onMessage 后不需要特殊处理 */
        }
      },
      onOpen: function (fn) {
        if (conn.open) { setTimeout(fn, 0); return; }
        conn.on('open', fn);
      },
      onClose: function (fn) { handlers.close.push(fn); }
    };
  }

  /* ---------------------------------------------------------
   * 房主：占一个房间码
   * ------------------------------------------------------- */
  function hostRoom(attempt) {
    attempt = attempt || 0;

    return new Promise(function (resolve, reject) {
      if (!ready()) { reject(new Error('联机库没加载，刷新一下页面')); return; }

      var code = randomCode();
      var peer = new global.Peer(PREFIX + code, { config: RTC_CONFIG, debug: 0 });

      var settled = false;
      var timer = setTimeout(function () {
        if (settled) return;
        settled = true;
        try { peer.destroy(); } catch (e) { /* noop */ }
        reject(new Error('连不上信令服务器，检查一下网络'));
      }, 15000);

      peer.on('open', function () {
        if (settled) return;
        settled = true;
        clearTimeout(timer);

        var listeners = { connection: [] };

        peer.on('connection', function (conn) {
          var channel = wrapConn(conn);
          listeners.connection.forEach(function (fn) { fn(channel, conn); });
        });

        resolve({
          code: code,
          peer: peer,
          onConnection: function (fn) { listeners.connection.push(fn); },
          close: function () {
            try { peer.destroy(); } catch (e) { /* noop */ }
          }
        });
      });

      peer.on('error', function (err) {
        if (settled) {
          /* 已经开好房间之后的错误，交给上层 */
          return;
        }
        /* 房间码撞了，换一个再试 */
        if (err && (err.type === 'unavailable-id' || /ID is taken/i.test(err.message || ''))) {
          settled = true;
          clearTimeout(timer);
          try { peer.destroy(); } catch (e) { /* noop */ }
          if (attempt < 5) {
            hostRoom(attempt + 1).then(resolve, reject);
          } else {
            reject(new Error('抢不到房间码，再试一次'));
          }
          return;
        }
        settled = true;
        clearTimeout(timer);
        reject(new Error(err && err.message ? err.message : '开房间失败'));
      });
    });
  }

  /* ---------------------------------------------------------
   * 客机：拿房间码去连
   * ------------------------------------------------------- */
  function joinRoom(code) {
    return new Promise(function (resolve, reject) {
      if (!ready()) { reject(new Error('联机库没加载，刷新一下页面')); return; }

      var clean = String(code).replace(/\D/g, '');
      if (clean.length !== CODE_LEN) {
        reject(new Error('房间码是 ' + CODE_LEN + ' 位数字'));
        return;
      }

      var peer = new global.Peer({ config: RTC_CONFIG, debug: 0 });
      var settled = false;

      var timer = setTimeout(function () {
        if (settled) return;
        settled = true;
        try { peer.destroy(); } catch (e) { /* noop */ }
        reject(new Error('连接超时'));
      }, 20000);

      peer.on('open', function () {
        var conn = peer.connect(PREFIX + clean, { reliable: true });

        conn.on('open', function () {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          resolve({
            code: clean,
            peer: peer,
            channel: wrapConn(conn),
            close: function () { try { peer.destroy(); } catch (e) { /* noop */ } }
          });
        });

        conn.on('error', function (err) {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          try { peer.destroy(); } catch (e) { /* noop */ }
          reject(new Error('连不上房主：' + (err && err.message ? err.message : '未知错误')));
        });
      });

      peer.on('error', function (err) {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        try { peer.destroy(); } catch (e) { /* noop */ }

        var t = err && err.type;
        if (t === 'peer-unavailable') reject(new Error('房间 ' + clean + ' 不存在，或房主已经关了'));
        else reject(new Error(err && err.message ? err.message : '连接失败'));
      });
    });
  }

  global.EPF = global.EPF || {};
  global.EPF.p2p = {
    hostRoom: hostRoom,
    joinRoom: joinRoom,
    ready: ready,
    CODE_LEN: CODE_LEN
  };
})(window);

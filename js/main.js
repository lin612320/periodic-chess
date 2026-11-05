/* ============================================================
 * main.js — 控制器
 * 三种模式共用一套渲染：
 *   solo   单机/人机：本机既判定也渲染
 *   host   联机房主：本机判定，事件流广播给客机
 *   client 联机客机：只回放事件流，发意图不改状态
 * ============================================================ */
(function (global) {
  'use strict';

  var D = global.EPF.data;
  var E = global.EPF.engine;
  var V = global.EPF.view;
  var U = global.EPF.ui;
  var N = global.EPF.net;
  var Fx = global.EPF.fx;

  /* =========================================================
   * 状态
   * ======================================================= */
  var cfg = {
    themeId: 'reaction',
    count: 2,
    seats: [],
    speed: 1
  };

  var mode = 'solo';           // solo | host | client
  var state = null;
  var busy = false;
  var pendingAction = null;    // { playerId, resolve }
  var grantedSeat = -1;        // 房主当前授权哪个座位出手（客户端据此点亮按钮）
  var queuedRoll = false;      // 按钮亮着就点了，引擎还没注册等待 → 先记着
  var pendingDuel = null;      // { challengerId, candidates, resolve }
  var ambientTimer = null;
  var ambientIdx = 0;

  function isHostLike() { return mode === 'solo' || mode === 'host'; }
  function isClient() { return mode === 'client'; }

  /** 本机的座位号：房主/单机恒为 0，客机看服务端分配 */
  function localSeat() {
    if (isClient()) return (global.EPF.net && global.EPF.net.me) ? global.EPF.net.me.seat : -1;
    return 0;
  }

  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

  function seatDefaults(n) {
    var arr = [];
    for (var i = 0; i < n; i++) {
      arr.push({ name: E.PLAYER_NAMES[i], color: E.PLAYER_COLORS[i], isBot: i > 0 });
    }
    return arr;
  }

  function resizeSeats(n) {
    var cur = cfg.seats;
    var next = seatDefaults(n);
    for (var i = 0; i < n && i < cur.length; i++) {
      next[i].name = cur[i].name;
      next[i].isBot = cur[i].isBot;
      next[i].color = E.PLAYER_COLORS[i];
    }
    cfg.seats = next;
  }

  function applyTheme(id) {
    cfg.themeId = id;
    document.body.dataset.theme = id;
    var t = null;
    for (var i = 0; i < D.THEMES.length; i++) {
      if (D.THEMES[i].id === id) { t = D.THEMES[i]; break; }
    }
    if (t) U.setThemeChrome(t);
    return t;
  }

  /* =========================================================
   * 开场装配
   * ======================================================= */
  function bootIntro() {
    U.init();

    Fx.init({
      canvas: document.getElementById('fx'),
      halo: document.getElementById('halo'),
      card: document.getElementById('elemCard')
    });

    cfg.seats = seatDefaults(cfg.count);

    U.renderThemeCards(cfg.themeId, function (id) {
      applyTheme(id);
      U.markThemeCard(id);
    });

    U.markCount(cfg.count);
    U.renderSeats(cfg.seats);

    U.dom.countSeg.addEventListener('click', function (ev) {
      var b = ev.target.closest('button[data-count]');
      if (!b) return;
      var n = Number(b.dataset.count);
      if (n === cfg.count) return;
      cfg.count = n;
      resizeSeats(n);
      U.markCount(n);
      U.renderSeats(cfg.seats);
    });

    document.getElementById('btnStart').addEventListener('click', startSolo);
    document.getElementById('btnRules').addEventListener('click', U.showRules);
    document.getElementById('btnLan').addEventListener('click', openLanPanel);
    document.getElementById('btnMenu').addEventListener('click', openMenu);

    U.dom.btnRoll.addEventListener('click', function () {
      var p = state ? E.currentPlayer(state) : null;
      if (!p) return;

      if (isClient()) {
        if (p.id !== N.me.seat) { U.toast('现在是 ' + p.name + ' 的回合'); return; }
        if (grantedSeat !== p.id) { U.toast('等房主把这个回合交给你'); return; }
        grantedSeat = -1;                       // 交出去就立刻锁住，别连点
        U.setRollState('busy');
        N.intent('roll');
        return;
      }

      // 房主：只替自己掷，绝不代远程座位掷骰
      if (p.id !== localSeat()) { U.toast('现在是 ' + p.name + ' 的回合'); return; }
      if (!pendingAction || pendingAction.playerId !== p.id) {
        // 按钮亮着但引擎还没轮到等待 → 记账，等注册时立刻兑现
        queuedRoll = true;
        U.toast('正在结算上一步，稍等');
        return;
      }
      fulfillAction(p.id);
    });

    window.addEventListener('resize', debounce(function () { V.relayout(); }, 140));

    bindNet();
    bindSound();

    applyTheme(cfg.themeId);
    startAmbient();

    /* 先走一遍序章，再交出设置面板 */
    global.EPF.prologue.start({
      onDone: function () {
        U.dom.intro.hidden = false;
        U.dom.intro.style.animation = 'none';
        void U.dom.intro.offsetWidth;
        U.dom.intro.style.animation = '';
      }
    });
  }

  function debounce(fn, ms) {
    var t = null;
    return function () { clearTimeout(t); t = setTimeout(fn, ms); };
  }

  /* =========================================================
   * 环境字条
   * ======================================================= */
  function startAmbient() {
    clearInterval(ambientTimer);
    ambientTimer = setInterval(function () {
      if (U.dom.stage && !U.dom.stage.hidden) {
        ambientIdx = (ambientIdx + 1) % D.AMBIENT_LINES.length;
        U.setAmbient(D.AMBIENT_LINES[ambientIdx]);
      }
    }, 9000);
  }

  /* =========================================================
   * 局域网面板
   * ======================================================= */
  /* 有些环境（file:// / 隐私模式）会禁用 sessionStorage，读写都要兜住 */
  function storeGet(k) {
    try { return sessionStorage.getItem(k); } catch (e) { return null; }
  }
  function storeSet(k, v) {
    try { sessionStorage.setItem(k, v); } catch (e) { /* 忽略 */ }
  }

  /* ---------------------------------------------------------
   * 联机：开房间 / 加入房间（P2P 直连）
   * ------------------------------------------------------- */
  var lan = { role: 'none', invite: null, name: '' };

  function copyText(text, done) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function () { done(true); }, function () { done(false); });
    } else {
      done(false);
    }
  }

  function openLanPanel() {
    var lastName = storeGet('epf.name') || '';

    var html = ''
      + '<p class="modal__kicker">联机</p>'
      + '<h3 class="modal__title">开一间房</h3>'
      + '<div class="modal__body">'
      + '<p>点「开房间」的那台设备就是这局的服务器——判定、随机数、广播全在它上面跑。别人点「加入房间」连过来，不需要任何服务器。</p>'
      + '</div>'
      + '<div class="lan-form">'
      + '<label class="lan-field"><span>昵称</span>'
      + '<input id="lanName" maxlength="12" value="' + lastName + '" placeholder="随便取一个" autocomplete="off"></label>'
      + '</div>'
      + '<div class="lan-choices">'
      + '<button type="button" class="lan-choice" data-act="host">'
      + '<b>开房间</b><span>我来当服务器</span></button>'
      + '<button type="button" class="lan-choice" data-act="client">'
      + '<b>加入房间</b><span>我有邀请码</span></button>'
      + '</div>'
      + '<div class="lan-status" id="lanStatus"></div>'
      + '<div class="modal__actions">'
      + '<button type="button" class="btn btn--ghost" data-act="close">算了</button>'
      + '</div>';

    var box = U.showModal(html);
    var nameInput = box.querySelector('#lanName');
    var status = box.querySelector('#lanStatus');

    function readName() {
      var n = (nameInput.value || '').trim() || '玩家';
      storeSet('epf.name', n);
      lan.name = n;
      return n;
    }

    box.querySelector('[data-act="close"]').addEventListener('click', function () {
      N.disconnect();
      mode = 'solo';
      lan.role = 'none';
      U.hideModal();
    });

    box.querySelector('[data-act="host"]').addEventListener('click', function () {
      status.textContent = '正在开房间…';
      N.startHost(readName()).then(function (room) {
        lan.role = 'host';
        renderHostRoom(room.code);
      }).catch(function (err) {
        status.textContent = '开房间失败：' + (err.message || err);
      });
    });

    box.querySelector('[data-act="client"]').addEventListener('click', function () {
      renderJoinRoom(readName());
    });
  }

  /* ---------- 房主：显示房间码 ---------- */
  function renderHostRoom(code) {
    var html = ''
      + '<p class="modal__kicker">房间已开好</p>'
      + '<h3 class="modal__title">把这 6 位数字告诉他们</h3>'
      + '<div class="lan-roomcode" id="lanRoomCode">' + code + '</div>'
      + '<div class="lan-code-actions">'
      + '<button type="button" class="btn btn--tiny" data-act="copy">复制房间码</button>'
      + '</div>'
      + '<div class="modal__body"><p>他们打开同一个网址 → 联机 → 加入房间 → 输入这 6 位数字，就会自动连到你这台设备。'
      + '你这台就是这局的服务器，判定和随机数都在你这里算。</p></div>'
      + '<div class="lan-status" id="lanStatus">还没有人连进来</div>'
      + '<div class="modal__actions">'
      + '<button type="button" class="btn btn--ghost" data-act="close">关掉</button>'
      + '<button type="button" class="btn btn--primary" data-act="go" disabled>等别人进来</button>'
      + '</div>';

    var box = U.showModal(html);
    var status = box.querySelector('#lanStatus');
    var goBtn = box.querySelector('[data-act="go"]');

    box.querySelector('[data-act="copy"]').addEventListener('click', function () {
      copyText(code, function (ok) {
        U.toast(ok ? '房间码已复制：' + code : '复制失败，念给他们听：' + code);
      });
    });

    box.querySelector('[data-act="close"]').addEventListener('click', function () {
      N.disconnect();
      mode = 'solo';
      lan.role = 'none';
      U.hideModal();
    });

    goBtn.addEventListener('click', hostStartLan);
  }

  /* ---------- 客机：输入房间码 ---------- */
  function renderJoinRoom(name) {
    var html = ''
      + '<p class="modal__kicker">加入房间</p>'
      + '<h3 class="modal__title">输入房主的 6 位房间码</h3>'
      + '<input id="lanCodeInput" class="lan-codeinput" inputmode="numeric" maxlength="6"'
      + ' placeholder="000000" autocomplete="off">'
      + '<div class="lan-status" id="lanStatus"></div>'
      + '<div class="modal__actions">'
      + '<button type="button" class="btn btn--ghost" data-act="close">算了</button>'
      + '<button type="button" class="btn btn--primary" data-act="join">进去</button>'
      + '</div>';

    var box = U.showModal(html);
    var status = box.querySelector('#lanStatus');
    var input = box.querySelector('#lanCodeInput');
    setTimeout(function () { try { input.focus(); } catch (e) { /* noop */ } }, 120);

    box.querySelector('[data-act="close"]').addEventListener('click', function () {
      N.disconnect();
      mode = 'solo';
      lan.role = 'none';
      U.hideModal();
    });

    function doJoin() {
      var code = (input.value || '').replace(/\D/g, '');
      if (code.length !== 6) { status.textContent = '房间码是 6 位数字'; return; }
      status.textContent = '正在连房主…';

      N.joinRoom(code, name).then(function () {
        lan.role = 'client';
        status.textContent = '连上了，等房主开局';
        U.toast('已进房间，等房主开局');
      }).catch(function (err) {
        status.textContent = err.message || '连不上';
      });
    }

    box.querySelector('[data-act="join"]').addEventListener('click', doJoin);
    input.addEventListener('keydown', function (ev) {
      if (ev.key === 'Enter') { ev.preventDefault(); doJoin(); }
    });
  }

  /* =========================================================
   * 网络事件
   * ======================================================= */
  function bindNet() {
    N.on('room', function (info) {
      var box = U.dom.modalBox;
      if (!box) return;

      var names = (info.roster || []).map(function (r, i) {
        return (i === 0 ? '★ ' : '') + r.name;
      }).join('、');

      var status = box.querySelector('#lanStatus');
      var go = box.querySelector('[data-act="go"]');

      if (status) {
        status.textContent = '房间成员（' + info.roster.length + '）：' + names;
      }
      if (go) {
        var canStart = info.isHost && info.roster.length >= 2;
        go.disabled = !canStart;
        go.textContent = info.isHost ? (canStart ? '开局' : '等别人进来') : '等房主开局…';
      }
    });

    N.on('peer-joined', function (p) {
      U.toast(p.name + ' 连进来了');
      /* 中途进来的人先对齐一次权威状态 */
      if (mode === 'host' && state && state.players.length) N.snapshot(state);
    });

    N.on('peer-left', function (p) {
      U.toast((p.name || '有人') + ' 断开了');
    });

    N.on('start', function (msg) {
      if (mode === 'host') return;      // 房主自己发的，忽略
      mode = 'client';                  // 收到 start 才切模式，别在守卫里挡自己
      U.hideModal();
      clientJoinStage(msg);
    });

    var clientQueue = Promise.resolve();
    var clientBusy = 0;           // 正在播的批次数量
    var pendingSync = null;       // 播完再对齐的权威状态

    N.on('events', function (events) {
      if (!isClient()) return;
      clientBusy++;

      /* 兜底：某一批卡住（动画没回来）也不能把客机永久冻住 */
      var guard = setTimeout(function () {
        console.warn('[client] 这批事件播太久了，强制收尾');
        clientQueue = Promise.resolve();    // 丢掉卡住的那条链
        clientBusy = 0;
        if (pendingSync) { var m = pendingSync; pendingSync = null; applySnapshot(m); }
      }, 45000);

      /* 串行播放：两批事件叠在一起会让按钮状态错乱 */
      clientQueue = clientQueue
        .then(function () { return playEvents(events); })
        .catch(function (err) { console.error('[client] 播放失败', err); })
        .then(function () {
          clearTimeout(guard);
          clientBusy = Math.max(0, clientBusy - 1);
          if (clientBusy > 0) return;
          if (pendingSync) {
            var m2 = pendingSync;
            pendingSync = null;
            applySnapshot(m2);
          } else {
            syncClientUI();
          }
        });
    });

    N.on('snapshot', function (msg) {
      if (!isClient()) return;
      if (clientBusy > 0) { pendingSync = msg; return; }   // 别在动画中间硬拽
      applySnapshot(msg);
    });

    N.on('grant', function (msg) {
      if (!isClient()) return;
      grantedSeat = (msg && typeof msg.player === 'number') ? msg.player : -1;
      if (grantedSeat === N.me.seat) {
        U.setRollState('ready');
      } else {
        U.setRollState('wait');
      }
    });

    N.on('intent', function (msg) {
      if (!isHostLike() || mode !== 'host') return;
      var seat = -1;
      for (var i = 0; i < N.me.roster.length; i++) {
        if (N.me.roster[i].connId === msg.from) { seat = i; break; }
      }
      if (seat < 0) return;

      if (msg.kind === 'roll') {
        fulfillAction(seat);
      } else if (msg.kind === 'duel') {
        if (pendingDuel && pendingDuel.challengerId === seat) {
          var r = pendingDuel.resolve;
          pendingDuel = null;
          r(msg.payload && typeof msg.payload.target === 'number' ? msg.payload.target : null);
        }
      }
    });

    N.on('duel-request', function (msg) {
      if (!isClient()) return;
      if (msg.player !== N.me.seat) return;
      U.showDuelPicker(msg.candidates, state.players, function (targetId) {
        N.intent('duel', { target: targetId });
      });
    });

    N.on('closed', function () {
      if (isClient() || mode === 'host') {
        U.toast('连接断开了');
        mode = 'solo';
      }
    });
  }

  function hostStartLan() {
    var roster = N.me.roster || [];
    if (roster.length < 2) { U.toast('至少两个人'); return; }

    var names = roster.map(function (r) { return r.name; });
    mode = 'host';
    U.hideModal();

    buildGame({
      count: roster.length,
      bots: [],
      names: names
    }, function () {
      N.start({ themeId: cfg.themeId }, N.pack(state));
      busy = false;
      nextTick(turnLoop);
    });
  }

  function clientJoinStage(msg) {
    mode = 'client';
    if (msg.config && msg.config.themeId) {
      applyTheme(msg.config.themeId);
    }
    var snap = msg.snapshot;
    if (!snap) return;

    state = N.unpack(snap);
    U.enterStage();
    V.init({ board: U.dom.board, speed: cfg.speed });
    V.buildTokens(state.players);

    Fx.setStageMode(true);
    Fx.bindBoard(U.dom.board);
    Fx.refreshParallax();

    U.clearLog();
    U.lcdReset();
    U.renderPlayers(state.players, state.turn);

    var first = state.players[state.turn];
    U.setTurn(first);
    V.setCurrent(first.pos);
    V.markActive(first.id);
    U.log('连线成功，房间 ' + N.me.room + '，共 ' + state.players.length + ' 人。', 'turn');
    grantedSeat = -1;
    queuedRoll = false;
    syncClientUI();
  }

  /** 客机把房主的权威状态硬对齐（位置 / 回合 / 阶段） */
  function applySnapshot(msg) {
    if (!isClient() || !state || !msg || !msg.snapshot) return;
    var sn = msg.snapshot;
    state.turn = sn.turn;
    state.phase = sn.phase;
    if (typeof sn.round === 'number') state.round = sn.round;
    (sn.players || []).forEach(function (sp) {
      var p = state.players[sp.id];
      if (!p) return;
      p.pos = sp.pos;
      p.sleeping = !!sp.sleeping;
      p.finished = !!sp.finished;
      V.setTokenPos(p.id, p.pos);
      U.updatePlayer(p);
    });
    syncClientUI();
  }

  function syncClientUI() {
    if (!state) return;
    var p = state.players[state.turn];
    U.setTurn(p);
    U.setActive(state.players, p.id);
    V.markActive(p.id);
    V.setCurrent(p.pos);
    state.players.forEach(function (q) { U.updatePlayer(q); });

    if (state.phase === 'over' && state.winner) {
      U.setRollState('off');
      onWin();
      return;
    }

    /* 关键：只有「房主刚把这个回合授权给我」才点亮按钮，
     * 否则一律锁着 —— 避免按钮亮着却点不动 */
    var mine = (p.id === N.me.seat);
    if (!mine) { U.setRollState('wait'); return; }
    U.setRollState(grantedSeat === p.id ? 'ready' : 'busy');
  }

  /* =========================================================
   * 开局
   * ======================================================= */
  function startSolo() {
    var bots = [];
    var names = [];
    cfg.seats.forEach(function (s, i) {
      if (s.isBot) bots.push(i);
      names.push(s.name);
    });
    mode = 'solo';
    buildGame({ count: cfg.count, bots: bots, names: names }, function () {
      busy = false;
      nextTick(turnLoop);
    });
  }

  function buildGame(opts, done) {
    try {
      state = E.createGame(opts);
      busy = false;
      pendingAction = null;
      pendingDuel = null;
      queuedRoll = false;
      grantedSeat = -1;

      U.enterStage();
      V.init({ board: U.dom.board, speed: cfg.speed });
      V.buildTokens(state.players);

      Fx.setStageMode(true);
      Fx.bindBoard(U.dom.board);
      Fx.refreshParallax();

      U.clearLog();
      U.lcdReset();
      U.renderPlayers(state.players, state.turn);

      var first = E.currentPlayer(state);
      U.setTurn(first);
      V.setCurrent(first.pos);
      V.markActive(first.id);
      U.setAmbient(D.AMBIENT_LINES[0]);
      U.log('翻开课本，<b>1 号氢</b>出发。', 'turn');

      if (done) done();
    } catch (err) {
      console.error('[buildGame] 开局失败', err);
      U.toast('开局炸了，看控制台');
    }
  }

  function nextTick(fn) {
    setTimeout(function () {
      fn().catch(function (err) {
        console.error('[turn flow]', err);
        U.toast('流程出错，看控制台');
        busy = false;
      });
    }, 260);
  }

  /* =========================================================
   * 动作等待（本地点击 / 远程 intent 统一）
   * ======================================================= */
  function waitAction(playerId) {
    return new Promise(function (resolve) {
      pendingAction = { playerId: playerId, resolve: resolve };
      /* 手快一步点的骰子，在这儿补上 */
      if (queuedRoll && playerId === localSeat()) {
        queuedRoll = false;
        var r = pendingAction.resolve;
        pendingAction = null;
        r();
      }
    });
  }

  function fulfillAction(playerId) {
    if (!pendingAction) return;
    if (pendingAction.playerId !== playerId) return;
    var r = pendingAction.resolve;
    pendingAction = null;
    r();
  }

  /* =========================================================
   * 回合主循环（仅 solo / host）
   * ======================================================= */
  async function turnLoop() {
    if (!isHostLike()) return;
    if (!state || state.phase === 'over' || busy) return;
    busy = true;
    try {
      await runTurn();
    } catch (err) {
      /* 任何一步炸了都不能把 busy 卡死，否则按钮永远是「计算中」 */
      console.error('[turnLoop] 回合中断', err);
      pendingAction = null;
      pendingDuel = null;
      queuedRoll = false;
      grantedSeat = -1;
      busy = false;
      if (state && state.phase !== 'over') state.phase = 'ready';
      refreshPanels();
      U.toast('这一步出错了，已恢复，再按一次 RAN');
      U.setRollState('ready');
    }
  }

  async function runTurn() {
    var p = E.currentPlayer(state);
    U.setTurn(p);
    U.setActive(state.players, p.id);
    V.markActive(p.id);
    V.setCurrent(p.pos);

    var bt = E.beginTurn(state);
    await playEvents(bt.events, { relay: true });

    if (bt.skipped) {
      refreshPanels();
      return endTurnFlow();
    }

    var chain = 0;
    while (true) {
      if (state.phase === 'over') break;

      if (p.isBot) {
        U.setRollState('wait');
        await sleep(620);
      } else {
        /* 联机时只有房主本人（座位 0）用本机按钮，其余是远程人类 */
        var isLocalHuman = (mode === 'solo') || (p.id === localSeat());
        if (isLocalHuman) {
          grantedSeat = p.id;
          U.setRollState('ready');
          if (chain > 0) U.lcdMessage('再来一次', '再按 RAN');
        } else {
          /* 远程人类：先授权，对方按钮才会亮 */
          grantedSeat = p.id;
          U.setRollState('wait');
          if (mode === 'host') N.grant(p.id);
        }
        await waitAction(p.id);
      }

      grantedSeat = -1;
      U.setRollState('busy');

      var res = E.rollAndMove(state);
      await playEvents(res.events, { relay: true });

      if (state.phase === 'over') { busy = false; return onWin(); }

      if (res.needsDuel) {
        await handleDuel(p, res.candidates);
        if (state.phase === 'over') { busy = false; return onWin(); }
      }

      if (res.again && chain < 8) { chain++; continue; }
      break;
    }

    refreshPanels();
    return endTurnFlow();
  }

  function endTurnFlow() {
    queuedRoll = false;
    grantedSeat = -1;
    var evs = E.endTurn(state);
    return playEvents(evs, { relay: true }).then(function () {
      var p = E.currentPlayer(state);
      U.setTurn(p);
      U.setActive(state.players, p.id);
      V.markActive(p.id);
      V.setCurrent(p.pos);
      refreshPanels();
      busy = false;
      nextTick(turnLoop);
    });
  }

  function refreshPanels() {
    if (!state) return;
    state.players.forEach(function (p) { U.updatePlayer(p); });
  }

  /* =========================================================
   * 事件流播放
   * ======================================================= */
  async function playEvents(events, opts) {
    opts = opts || {};
    if (opts.relay && mode === 'host' && N.active) {
      N.broadcast(events);
    }
    for (var i = 0; i < events.length; i++) {
      var ev = events[i];
      if (isClient()) N.applyEvent(state, ev);   // 客机影子状态
      try {
        await playOne(ev);
      } catch (err) {
        console.error('[playEvents] 事件播放失败', ev.type, err);
      }
    }
    /* 每批结束后房主再发一次权威快照：漏包 / 动画卡住都能自动纠回来 */
    if (opts.relay && mode === 'host' && N.active) {
      N.snapshot(state);
    }
  }

  function playerOf(id) { return state.players[id]; }

  function arrowWord(dir) {
    return ({ up: '↑', down: '↓', left: '←', right: '→' })[dir] || '→';
  }

  async function playOne(ev) {
    switch (ev.type) {

      case 'roll': {
        var p0 = playerOf(ev.player);
        U.log('<b>' + p0.name + '</b> 按 RAN → <b>' + ev.value + '</b>', 'roll');
        await U.animateRoll(ev);
        break;
      }

      case 'move': {
        U.setRollState('busy');
        await V.moveAlong(ev.player, ev.path);
        V.markTarget(ev.to);
        V.landBounce(ev.player);
        V.flashCell(ev.to, 'is-impact', 520);
        U.updatePlayer(playerOf(ev.player));
        await sleep(120);
        break;
      }

      case 'enter-zone': {
        var dZ = U.posDesc(ev.slot);
        U.log('<b>' + playerOf(ev.player).name + '</b> 停在'
          + (ev.zone === 'ln' ? '镧系' : '锕系') + '入口，进了 <b>' + dZ.sym + '</b> · ' + dZ.tag, 'special');
        await sleep(320);
        break;
      }

      case 'land': {
        if (ev.special) V.flashCell(ev.z, 'is-impact', 460);
        break;
      }

      case 'special': {
        U.log(ev.text, 'special');
        await sleep(180);
        break;
      }

      case 'sleep': {
        U.log(ev.text, 'special');
        U.updatePlayer(playerOf(ev.player));
        await sleep(320);
        break;
      }

      case 'wake':
      case 'skip': {
        U.log(ev.text, 'turn');
        await sleep(300);
        break;
      }

      case 'again':
      case 'again-stop': {
        U.log(ev.text, 'special');
        await sleep(260);
        break;
      }

      case 'tornado': {
        U.log('<b>' + playerOf(ev.player).name + '</b> 被卷走了：<b>' + ev.value + '</b> 号', 'special');
        await U.animateTornado(ev);
        V.setTokenPos(ev.player, ev.from, { hop: true });
        await sleep(160);
        V.setTokenPos(ev.player, ev.to, { hop: true });
        V.followCell(ev.to);
        V.markTarget(ev.to);
        V.flashCell(ev.to, 'is-impact', 620);
        V.landBounce(ev.player);
        U.updatePlayer(playerOf(ev.player));
        await sleep(520);
        break;
      }

      case 'arrow': {
        var dA = U.posDesc(ev.to);
        U.log('<b>' + playerOf(ev.player).name + '</b> 走 ' + arrowWord(ev.dir) + ' → <b>' + dA.sym + '</b> · ' + dA.tag, 'special');
        V.setTokenPos(ev.player, ev.to, { hop: true });
        V.followCell(ev.to);
        V.markTarget(ev.to);
        V.flashCell(ev.to, 'is-impact', 520);
        V.landBounce(ev.player);
        U.updatePlayer(playerOf(ev.player));
        await sleep(480);
        break;
      }

      case 'arrow-blocked': {
        U.log(ev.text, 'special');
        V.flashCell(ev.z, 'is-impact', 380);
        await sleep(360);
        break;
      }

      case 'duel': {
        await U.animateDuel(ev.rolls, state.players, ev.threshold);
        U.log('<b>' + playerOf(ev.winner).name + '</b> 赢下决斗，<b>' + playerOf(ev.loser).name + '</b> 停一回合', 'duel');
        U.updatePlayer(playerOf(ev.loser));
        await sleep(600);
        break;
      }

      case 'duel-skip': {
        U.log(ev.text, 'special');
        await sleep(280);
        break;
      }

      case 'win': {
        U.log('<b>' + ev.text + '</b>', 'win');
        break;
      }

      case 'turn': {
        U.log(ev.text, 'turn');
        await sleep(180);
        break;
      }

      default: {
        if (ev.text) U.log(ev.text, 'turn');
        break;
      }
    }
  }

  /* =========================================================
   * 决斗
   * ======================================================= */
  function handleDuel(challenger, candidates) {
    return new Promise(function (resolve) {
      // 1) 人机：直接选领先者
      if (challenger.isBot) {
        var t = E.botPickDuelTarget(state, challenger.id);
        if (t == null) { resolve(); return; }
        var r1 = E.resolveDuel(state, challenger.id, t);
        playEvents(r1.events, { relay: true }).then(resolve);
        return;
      }

      // 2) 本地人类：弹窗
      if (mode === 'solo' || challenger.id === 0) {
        U.showDuelPicker(candidates, state.players, function (targetId) {
          var r2 = E.resolveDuel(state, challenger.id, targetId);
          playEvents(r2.events, { relay: true }).then(resolve);
        });
        return;
      }

      // 3) 联机：远程玩家自己选
      if (mode === 'host' && N.active) {
        N.relayRaw({ t: 'duel-request', player: challenger.id, candidates: candidates });
        pendingDuel = {
          challengerId: challenger.id,
          candidates: candidates,
          resolve: function (targetId) {
            var pick = (typeof targetId === 'number') ? targetId : E.botPickDuelTarget(state, challenger.id);
            if (pick == null) { resolve(); return; }
            var r3 = E.resolveDuel(state, challenger.id, pick);
            playEvents(r3.events, { relay: true }).then(resolve);
          }
        };
        return;
      }

      resolve();
    });
  }

  /* =========================================================
   * 结算
   * ======================================================= */
  function onWin() {
    if (!state || !state.winner) return;
    var w = state.winner;

    U.setRollState('off');
    U.setTurn(w);
    V.markActive(w.id);

    setTimeout(function () {
      U.showResult(w, state.players,
        function () {
          if (isClient()) { U.toast('等房主开新局'); return; }
          if (mode === 'host') { U.toast('等房主开新局'); U.hideModal(); return; }
          startSolo();
        },
        function () {
          goIntro();
          if (mode === 'host') { mode = 'solo'; }
        }
      );
    }, 620);
  }

  function goIntro() {
    U.backToIntro();
    Fx.setStageMode(false);
    busy = false;
    pendingAction = null;
  }

  /* =========================================================
   * 菜单
   * ======================================================= */
  function openMenu() {
    var themeTitle = (applyTheme(cfg.themeId) || {}).title || '';
    var html = ''
      + '<p class="modal__kicker">菜单</p>'
      + '<h3 class="modal__title">先停一停</h3>'
      + '<div class="modal__body"><p>当前课本：' + themeTitle
      + (mode === 'solo' ? '' : '　·　联机模式：' + (mode === 'host' ? '房主' : '客机')) + '</p></div>'
      + '<div class="modal__actions">'
      + '<button type="button" class="btn btn--ghost" data-act="rules">规则</button>'
      + '<button type="button" class="btn btn--ghost" data-act="speed">动画速度 ×' + cfg.speed + '</button>'
      + '<button type="button" class="btn btn--ghost" data-act="menu">回到开场</button>'
      + '<button type="button" class="btn btn--primary" data-act="restart">重开一局</button>'
      + '</div>';

    var box = U.showModal(html);

    box.querySelector('[data-act="rules"]').addEventListener('click', function () {
      U.hideModal();
      U.showRules();
    });

    box.querySelector('[data-act="speed"]').addEventListener('click', function (e) {
      var seq = [1, 1.5, 2, 3];
      var idx = seq.indexOf(cfg.speed);
      cfg.speed = seq[(idx + 1) % seq.length];
      V.setSpeed(cfg.speed);
      e.target.textContent = '动画速度 ×' + cfg.speed;
    });

    box.querySelector('[data-act="menu"]').addEventListener('click', function () {
      goIntro();
      if (mode !== 'solo') { N.disconnect(); mode = 'solo'; }
    });

    box.querySelector('[data-act="restart"]').addEventListener('click', function () {
      U.hideModal();
      busy = false;
      pendingAction = null;
      if (isClient()) { U.toast('等房主开新局'); return; }
      if (mode === 'host') { hostStartLan(); return; }
      startSolo();
    });
  }

  /* =========================================================
   * 声音
   * ======================================================= */
  function bindSound() {
    var Au = global.EPF.audio;
    var b1 = document.getElementById('btnSound');
    var b2 = document.getElementById('btnSound2');
    if (!Au) return;

    function paint() {
      var info = Au.info();
      var on = info.on;
      if (b1) {
        b1.setAttribute('aria-pressed', on ? 'true' : 'false');
        var label = b1.querySelector('.snd-label');
        if (label) {
          label.textContent = on
            ? (info.mode === 'files' && info.currentTitle ? '♪ ' + info.currentTitle : '声音：开')
            : '声音：关';
        }
      }
      if (b2) b2.setAttribute('aria-pressed', on ? 'true' : 'false');
    }

    function hit() {
      try {
        Au.toggle();
      } catch (err) {
        console.error('[sound] 切换失败', err);
        U.toast('这台机器放不出声音');
      }
      paint();
    }

    if (b1) b1.addEventListener('click', hit);
    if (b2) b2.addEventListener('click', hit);
    Au.onChange(paint);
    paint();
  }

  /* =========================================================
   * 启动
   * ======================================================= */
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bootIntro);
  } else {
    bootIntro();
  }

  global.EPF.app = {
    get state() { return state; },
    get mode() { return mode; },
    startGame: startSolo,
    config: cfg
  };
})(window);

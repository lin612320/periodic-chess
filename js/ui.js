/* ============================================================
 * ui.js — 开场配置 / HUD / 科学计算器演出 / 弹窗 / 提示
 * ============================================================ */
(function (global) {
  'use strict';

  var D = global.EPF.data;
  var E = global.EPF.engine;

  var dom = {};
  var toastTimer = null;
  var logCount = 0;
  var MAX_LOG = 80;

  function $(id) { return document.getElementById(id); }
  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }
  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

  /* =========================================================
   * 位置描述 —— slotId 可能是主表 1..56/72..88/104..118、
   * 占位格 1001/1002，或镧系/锕系区 2000+/3000+
   * ======================================================= */
  function posDesc(pos) {
    var sym, tag;
    if (D.isPlaceholder(pos)) {
      sym = pos === D.SLOT_P_LN ? '镧' : '锕';
      tag = pos === D.SLOT_P_LN ? '镧系入口' : '锕系入口';
    } else {
      var e = D.BY_Z[D.slotZ(pos)];
      sym = e ? e.sym : '?';
      var zone = D.slotZone(pos);
      if (zone === 'ln') tag = '镧系 · 第 ' + (pos - D.SLOT_LN + 1) + ' 格';
      else if (zone === 'an') tag = '锕系 · 第 ' + (pos - D.SLOT_AN + 1) + ' 格';
      else tag = '第 ' + pos + ' 格';
    }
    return { sym: sym, tag: tag };
  }

  /* =========================================================
   * 初始化 DOM 引用
   * ======================================================= */
  function init() {
    dom.intro = $('intro');
    dom.stage = $('stage');
    dom.themeCards = $('themeCards');
    dom.countSeg = $('countSeg');
    dom.seats = $('seats');
    dom.board = $('board');
    dom.players = $('players');
    dom.log = $('log');
    dom.lcd = $('lcd');
    dom.lcdExpr = $('lcdExpr');
    dom.lcdVal = $('lcdVal');
    dom.lcdOut = $('lcdOut');
    dom.btnRoll = $('btnRoll');
    dom.turnPill = $('turnPill');
    dom.themeTag = $('themeTag');
    dom.themeTitle = $('themeTitle');
    dom.legend = $('legend');
    dom.ambientLine = $('ambientLine');
    dom.modal = $('modal');
    dom.modalBox = $('modalBox');
    dom.toast = $('toast');
    buildLegend();
  }

  /* =========================================================
   * 封面卡片
   * ======================================================= */
  function renderThemeCards(currentId, onPick) {
    dom.themeCards.innerHTML = '';
    D.THEMES.forEach(function (t) {
      var b = el('button', 'cover');
      b.type = 'button';
      b.dataset.pattern = t.pattern;
      b.dataset.themeId = t.id;
      b.setAttribute('aria-pressed', t.id === currentId ? 'true' : 'false');
      b.style.setProperty('--cv-a', t.accent);
      b.style.setProperty('--cv-b', t.deep);
      b.setAttribute('aria-label', t.volume + ' ' + t.title);

      var face = el('span', 'cover__face');
      var txt = el('span', 'cover__text');
      txt.appendChild(el('span', 'cover__vol', t.volume));
      txt.appendChild(el('span', 'cover__name', t.title));
      txt.appendChild(el('span', 'cover__press', t.press));

      b.appendChild(face);
      b.appendChild(txt);

      b.addEventListener('click', function () { onPick(t.id); });
      dom.themeCards.appendChild(b);
    });
  }

  function markThemeCard(id) {
    var kids = dom.themeCards.children;
    for (var i = 0; i < kids.length; i++) {
      kids[i].setAttribute('aria-pressed', kids[i].dataset.themeId === id ? 'true' : 'false');
    }
  }

  /* =========================================================
   * 座位设置
   * ======================================================= */
  function renderSeats(seats) {
    dom.seats.innerHTML = '';
    seats.forEach(function (s, i) {
      var row = el('div', 'seat');
      row.style.setProperty('--seat-color', s.color);

      var dot = el('span', 'seat__dot');
      var name = el('span', 'seat__name', s.name);

      var btn = el('button', 'seat__type', s.isBot ? '人机' : '真人');
      btn.type = 'button';
      btn.dataset.kind = s.isBot ? 'bot' : 'human';
      btn.setAttribute('aria-label', s.name + ' 由' + (s.isBot ? '人机' : '真人') + '操作，点击切换');
      btn.addEventListener('click', function () {
        s.isBot = !s.isBot;
        btn.textContent = s.isBot ? '人机' : '真人';
        btn.dataset.kind = s.isBot ? 'bot' : 'human';
        if (s.onToggle) s.onToggle(i, s.isBot);
      });

      row.appendChild(dot);
      row.appendChild(name);
      row.appendChild(btn);
      dom.seats.appendChild(row);
    });
  }

  function markCount(n) {
    var kids = dom.countSeg.querySelectorAll('button');
    for (var i = 0; i < kids.length; i++) {
      kids[i].setAttribute('aria-pressed', Number(kids[i].dataset.count) === n ? 'true' : 'false');
    }
  }

  /* =========================================================
   * 玩家面板
   * ======================================================= */
  function renderPlayers(players, activeId) {
    dom.players.innerHTML = '';
    players.forEach(function (p) {
      var row = el('li', 'player');
      row.style.setProperty('--tk', p.color);
      row.dataset.pid = String(p.id);
      row.dataset.active = (p.id === activeId) ? '1' : '0';

      var dot = el('span', 'player__dot');

      var body = el('div', 'player__body');
      var nameLine = el('div', 'player__name');
      nameLine.appendChild(document.createTextNode(p.name));
      if (p.isBot) nameLine.appendChild(el('span', 'player__tag', 'AI'));
      body.appendChild(nameLine);

      var where = el('div', 'player__where');
      body.appendChild(where);

      var state = el('div', 'player__state');

      row.appendChild(dot);
      row.appendChild(body);
      row.appendChild(state);
      dom.players.appendChild(row);

      updatePlayer(p);
    });
  }

  function updatePlayer(p) {
    var row = dom.players.querySelector('[data-pid="' + p.id + '"]');
    if (!row) return;
    var d0 = posDesc(p.pos);
    var where = row.querySelector('.player__where');
    where.innerHTML = '';
    var b = document.createElement('b');
    b.textContent = d0.sym;
    where.appendChild(b);
    where.appendChild(document.createTextNode(' ' + d0.tag));

    var state = row.querySelector('.player__state');
    state.innerHTML = '';
    if (p.finished) state.appendChild(el('span', 'chip chip--win', '赢了'));
    else if (p.sleeping) state.appendChild(el('span', 'chip chip--sleep', '睡着'));
  }

  function setActive(players, activeId) {
    players.forEach(function (p) {
      var row = dom.players.querySelector('[data-pid="' + p.id + '"]');
      if (row) row.dataset.active = (p.id === activeId) ? '1' : '0';
    });
  }

  function setTurn(p) {
    if (!dom.turnPill) return;
    dom.turnPill.textContent = '轮到 ' + p.name;
    dom.turnPill.style.setProperty('--turn-color', p.color);
  }

  /* =========================================================
   * 日志
   * ======================================================= */
  function log(html, kind) {
    var li = el('li', 'log__item');
    if (kind) li.dataset.kind = kind;
    li.innerHTML = html;
    dom.log.appendChild(li);
    logCount++;
    while (logCount > MAX_LOG && dom.log.firstChild) {
      dom.log.removeChild(dom.log.firstChild);
      logCount--;
    }
    dom.log.scrollTop = dom.log.scrollHeight;
  }

  function clearLog() {
    dom.log.innerHTML = '';
    logCount = 0;
  }

  /* =========================================================
   * 图例
   * ======================================================= */
  function buildLegend() {
    var tones = ['duel', 'sleep', 'again', 'tornado', 'arrow'];
    var names = { duel: '决斗', sleep: '睡觉', again: '多摇一次', tornado: '龙卷风', arrow: '上下左右' };
    dom.legend.innerHTML = '';
    tones.forEach(function (t) {
      var item = el('span', 'legend__item');
      var glyph, tone;
      if (t === 'arrow') {
        glyph = '↑↓←→';
        tone = 'arrow';
      } else {
        glyph = D.SPECIAL_META[t].glyph;
        tone = t;
      }
      var chip = el('span', 'legend__chip', glyph);
      chip.dataset.tone = tone;
      item.appendChild(chip);
      item.appendChild(document.createTextNode(names[t]));
      dom.legend.appendChild(item);
    });
  }

  /* =========================================================
   * 科学计算器 LCD
   * ======================================================= */
  function lcdReset() {
    dom.lcdExpr.textContent = '6×RAN+0.5';
    dom.lcdVal.textContent = '— — —';
    dom.lcdOut.textContent = 'Rnd = ?';
    dom.lcdVal.classList.remove('is-ticking');
    dom.lcdOut.classList.remove('is-hit');
  }

  function typeIn(node, text) {
    node.textContent = text;
    node.classList.remove('is-typing');
    void node.offsetWidth;
    node.classList.add('is-typing');
  }

  /** 数字快速跳动，模拟计算器在算 */
  function tickNumber(node, finalText, duration, tickMs) {
    return new Promise(function (resolve) {
      var t0 = performance.now();
      var tick = Math.max(38, tickMs || 52);
      node.classList.add('is-ticking');
      var timer = setInterval(function () {
        if (performance.now() - t0 >= duration) {
          clearInterval(timer);
          node.classList.remove('is-ticking');
          node.textContent = finalText;
          resolve();
        } else {
          node.textContent = (Math.random() * 9).toFixed(3);
        }
      }, tick);
    });
  }

  /**
   * 掷骰演出
   * @returns {Promise}
   */
  function animateRoll(die) {
    return Promise.resolve()
      .then(function () {
        typeIn(dom.lcdExpr, die.expr);
        dom.lcdVal.textContent = '';
        dom.lcdOut.textContent = '';
        return sleep(110);
      })
      .then(function () { return tickNumber(dom.lcdVal, die.raw.toFixed(3), 480); })
      .then(function () { typeIn(dom.lcdOut, 'Rnd = ' + die.value); })
      .then(function () {
        dom.lcdOut.classList.add('is-hit');
        return sleep(240);
      });
  }

  /** 龙卷风演出 */
  function animateTornado(t) {
    return Promise.resolve()
      .then(function () {
        typeIn(dom.lcdExpr, t.expr);
        dom.lcdVal.textContent = '';
        dom.lcdOut.textContent = '';
        return sleep(110);
      })
      .then(function () { return tickNumber(dom.lcdVal, t.raw.toFixed(1), 700, 62); })
      .then(function () { typeIn(dom.lcdOut, '→ ' + t.value + ' 号'); })
      .then(function () {
        dom.lcdOut.classList.add('is-hit');
        return sleep(260);
      });
  }

  /**
   * 决斗演出
   * rolls: [{player, ran, hit}]，players 用于取名字/颜色
   */
  function animateDuel(rolls, players, threshold) {
    return new Promise(function (resolve) {
      dom.lcdExpr.textContent = 'RAN  ≥ ' + threshold;
      dom.lcdVal.textContent = '';
      dom.lcdOut.textContent = '';

      // 用两行通道替换原有输出区
      dom.lcdOut.innerHTML = '';
      var box = el('div', 'lcd__duel');
      var involved = [];
      rolls.forEach(function (r) {
        if (involved.indexOf(r.player) < 0) involved.push(r.player);
      });
      var rows = {};
      involved.forEach(function (pid) {
        var pl = players[pid];
        var row = el('div', 'lcd__duel-row');
        row.dataset.hit = '0';
        var nm = el('span', 'lcd__duel-name', pl ? pl.name : ('P' + pid));
        var vl = el('span', 'lcd__duel-val', '—.———');
        row.appendChild(nm);
        row.appendChild(vl);
        box.appendChild(row);
        rows[pid] = { row: row, val: vl };
      });
      dom.lcdOut.appendChild(box);

      var i = 0;
      function step() {
        if (i >= rolls.length) { resolve(); return; }
        var r = rolls[i];
        var target = rows[r.player];
        if (target) {
          if (target.val) target.val.textContent = r.ran.toFixed(3);
          target.row.dataset.hit = r.hit ? '1' : '0';
          if (r.hit) target.row.classList.add('is-hit');
        }
        i++;
        setTimeout(step, r.hit ? 620 : 340);
      }
      step();
    });
  }

  function lcdMessage(main, sub) {
    dom.lcdExpr.textContent = '';
    dom.lcdVal.textContent = main || '';
    dom.lcdOut.textContent = sub || '';
  }

  /* =========================================================
   * 掷骰按钮
   * ======================================================= */
  function setRollState(mode) {
    // mode: 'ready' | 'busy' | 'wait' | 'off'
    var b = dom.btnRoll;
    b.classList.remove('is-ready', 'is-busy');
    if (mode === 'ready') {
      b.disabled = false;
      b.classList.add('is-ready');
      b.querySelector('.btn--roll__main').textContent = '摇骰子';
      b.querySelector('.btn--roll__sub').textContent = '按 RAN';
    } else if (mode === 'busy') {
      b.disabled = true;
      b.classList.add('is-busy');
      b.querySelector('.btn--roll__main').textContent = '计算中';
      b.querySelector('.btn--roll__sub').textContent = '…';
    } else if (mode === 'wait') {
      b.disabled = true;
      b.querySelector('.btn--roll__main').textContent = '对手回合';
      b.querySelector('.btn--roll__sub').textContent = 'RAN';
    } else {
      b.disabled = true;
      b.classList.remove('is-ready');
      b.querySelector('.btn--roll__main').textContent = '摇骰子';
      b.querySelector('.btn--roll__sub').textContent = '按 RAN';
    }
  }

  /* =========================================================
   * 弹窗
   * ======================================================= */
  function showModal(html, opts) {
    opts = opts || {};
    dom.modalBox.innerHTML = html;
    dom.modal.hidden = false;
    dom.modalBox.style.animation = 'none';
    void dom.modalBox.offsetWidth;
    dom.modalBox.style.animation = '';
    if (opts.dismissible !== false) {
      dom.modal.onclick = function (ev) {
        if (ev.target === dom.modal) hideModal();
      };
    } else {
      dom.modal.onclick = null;
    }
    return dom.modalBox;
  }

  function hideModal() {
    dom.modal.hidden = true;
    dom.modalBox.innerHTML = '';
  }

  function isModalOpen() { return !dom.modal.hidden; }

  /* ---------- 规则弹窗 ---------- */
  function showRules() {
    var rows = [
      ['duel', '决斗', '选一名对手，双方轮流按 <code>RAN</code>，先出 <b>≥ 0.9</b> 者胜；败者停一回合。踩中格子的人先按。'],
      ['sleep', '睡觉', '停一回合。'],
      ['again', '多摇一次', '本回合再掷一次，可以连锁。'],
      ['tornado', '龙卷风', '按 <code>118×RAN+0.5</code> 四舍五入，直接传送到对应元素格。'],
      ['arrow', '上下左右', '按周期表方向位移：上下走 1 个周期，左右走 3~5 个族。前方没路就原地不动，位移后不再二次触发。']
    ];
    var tones = { duel: '#d8434f', sleep: '#5b7ba8', again: '#2f9e73', tornado: '#8a5bc9', arrow: '#3f8fb0' };

    var html = ''
      + '<p class="modal__kicker">规则</p>'
      + '<h3 class="modal__title">118 格的那条路</h3>'
      + '<div class="modal__body">'
      + '<p>从 <b>1 号氢</b>出发，沿元素序号一路走到 <b>118 号鿫</b>。</p>'
      + '<p>骰子是科学计算器：<code>6×RAN+0.5</code>，四舍五入得 1~6。</p>'
      + '<p>走到第 118 格必须 <b>恰好停住</b>才算赢；步子越过了就从第 7 周期第 1 格 <b>Fr(87)</b> 接着走。</p>'
      + '<p>第 6、7 周期中间那块 <b>镧系 / 锕系入口格</b>是暗门：只有 <b>恰好停在这一格</b> 才会拐进下面的镧系 / 锕系行，'
      + '在系里继续走完剩下的步数，走到最后一个元素自动回到主表（Lu→Hf，Lr→Rf）。直接从旁边路过不算进去。</p>'
      + '</div>'
      + '<dl class="rules-table">';

    rows.forEach(function (r) {
      var g = r[0] === 'arrow' ? '↑↓←→' : D.SPECIAL_META[r[0]].glyph;
      html += '<dt style="background:' + tones[r[0]] + '">' + g + '</dt>'
        + '<dd><b>' + r[1] + '</b>　' + r[2] + '</dd>';
    });

    html += '</dl>'
      + '<div class="modal__actions">'
      + '<button type="button" class="btn btn--primary" data-close="1">知道了</button>'
      + '</div>';

    var box = showModal(html);
    box.querySelector('[data-close]').addEventListener('click', hideModal);
  }

  /* ---------- 决斗选人 ---------- */
  function showDuelPicker(candidates, players, onPick) {
    var html = ''
      + '<p class="modal__kicker">决斗</p>'
      + '<h3 class="modal__title">挑一个人，按 RAN</h3>'
      + '<div class="modal__body"><p>你踩到了决斗格。双方轮流按 <code>RAN</code>，先出 <b>≥ 0.9</b> 的赢，输的人停一回合。</p></div>'
      + '<div class="duel-list">';

    candidates.forEach(function (pid) {
      var p = players[pid];
      var d0 = posDesc(p.pos);
      html += '<button type="button" class="duel-pick" data-pid="' + pid + '" style="--tk:' + p.color + '">'
        + '<span class="duel-pick__dot"></span>'
        + '<span class="duel-pick__name">' + p.name + (p.isBot ? '（AI）' : '') + '</span>'
        + '<span class="duel-pick__where">' + d0.sym + ' · ' + d0.tag + '</span>'
        + '</button>';
    });

    html += '</div>';

    var box = showModal(html, { dismissible: false });
    box.querySelectorAll('.duel-pick').forEach(function (btn) {
      btn.addEventListener('click', function () {
        hideModal();
        onPick(Number(btn.dataset.pid));
      });
    });
  }

  /* ---------- 结算 ---------- */
  function showResult(winner, players, onAgain, onMenu) {
    var html = ''
      + '<p class="modal__kicker">终局</p>'
      + '<h3 class="modal__title">118 号，鿫</h3>'
      + '<div class="result-winner" style="--tk:' + winner.color + '">'
      + '<div class="result-winner__avatar">' + winner.name.slice(0, 1) + '</div>'
      + '<div>'
      + '<div class="result-winner__name">' + winner.name + '</div>'
      + '<div class="result-winner__sub">恰好停在最后一格</div>'
      + '</div></div>'
      + '<div class="modal__body"><p>晚自习的铃还没响，你已经把黑板上的那张表走完了。</p></div>'
      + '<div class="modal__actions">'
      + '<button type="button" class="btn btn--ghost" data-act="menu">回到课本</button>'
      + '<button type="button" class="btn btn--primary" data-act="again">再来一局</button>'
      + '</div>';

    var box = showModal(html, { dismissible: false });
    box.querySelector('[data-act="again"]').addEventListener('click', function () { hideModal(); onAgain(); });
    box.querySelector('[data-act="menu"]').addEventListener('click', function () { hideModal(); onMenu(); });
  }

  /* =========================================================
   * 提示
   * ======================================================= */
  function toast(msg, ms) {
    dom.toast.textContent = msg;
    dom.toast.hidden = false;
    dom.toast.dataset.show = '1';
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () {
      dom.toast.dataset.show = '0';
      setTimeout(function () { dom.toast.hidden = true; }, 320);
    }, ms || 1900);
  }

  /* =========================================================
   * 场景切换
   * ======================================================= */
  function enterStage() {
    dom.intro.hidden = true;
    dom.stage.hidden = false;
  }

  function backToIntro() {
    dom.stage.hidden = true;
    dom.intro.hidden = false;
    hideModal();
  }

  function setAmbient(text) {
    if (!dom.ambientLine) return;
    dom.ambientLine.style.opacity = '0';
    setTimeout(function () {
      dom.ambientLine.textContent = text;
      dom.ambientLine.style.opacity = '';
    }, 280);
  }

  function setThemeChrome(theme) {
    dom.themeTag.textContent = theme.volume;
    dom.themeTitle.textContent = theme.title;
  }

  /* =========================================================
   * 导出
   * ======================================================= */
  global.EPF.ui = {
    init: init,
    dom: dom,
    posDesc: posDesc,
    // 开场
    renderThemeCards: renderThemeCards,
    markThemeCard: markThemeCard,
    renderSeats: renderSeats,
    markCount: markCount,
    // 面板
    renderPlayers: renderPlayers,
    updatePlayer: updatePlayer,
    setActive: setActive,
    setTurn: setTurn,
    // 日志
    log: log,
    clearLog: clearLog,
    // LCD
    lcdReset: lcdReset,
    lcdMessage: lcdMessage,
    animateRoll: animateRoll,
    animateTornado: animateTornado,
    animateDuel: animateDuel,
    setRollState: setRollState,
    // 弹窗
    showModal: showModal,
    hideModal: hideModal,
    isModalOpen: isModalOpen,
    showRules: showRules,
    showDuelPicker: showDuelPicker,
    showResult: showResult,
    toast: toast,
    // 场景
    enterStage: enterStage,
    backToIntro: backToIntro,
    setAmbient: setAmbient,
    setThemeChrome: setThemeChrome
  };
})(window);

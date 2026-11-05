/* ============================================================
 * view.js — 棋盘渲染 / 棋子 / 动画
 * 只负责「把状态画出来」，不判定任何规则。
 * ============================================================ */
(function (global) {
  'use strict';

  var D = global.EPF.data;

  var boardEl = null;
  var layerEl = null;
  var cellMap = Object.create(null);   // z -> HTMLElement
  var tokenMap = Object.create(null);  // playerId -> HTMLElement
  var posCache = Object.create(null);  // z -> {x, y}
  var speed = 1;                       // 动画倍速，1 = 正常

  /* ---------------------------------------------------------
   * 工具
   * ------------------------------------------------------- */
  function sleep(ms) {
    return new Promise(function (r) { setTimeout(r, ms / speed); });
  }

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  /**
   * 中文名是否一定缺字。
   * 只看码点：扩展 B 区（U+20000 以上）的汉字多数系统字体没有，
   * 而 109/112/113/117/118 那几个在基本区（U+9Fxx），是能显示的。
   * 别用 canvas 量宽度 —— 汉字的 .notdef 也是全角宽，量不出来。
   */
  function willMissGlyph(name) {
    if (!name) return false;
    return name.codePointAt(0) > 0xffff;
  }

  /** 主表 row 1~7；镧系排版行第 9；锕系排版行第 10（第 8 行留给间隔） */
  function gridRow(logicalRow) {
    if (logicalRow === 8) return 9;
    if (logicalRow === 9) return 10;
    return logicalRow;
  }

  /* ---------------------------------------------------------
   * 棋盘
   * ------------------------------------------------------- */
  function renderBoard() {
    boardEl.innerHTML = '';
    cellMap = Object.create(null);
    posCache = Object.create(null);

    var frag = document.createDocumentFragment();

    for (var i = 0; i < D.ELEMENTS.length; i++) {
      var e = D.ELEMENTS[i];
      var cell = el('div', 'cell');
      cell.dataset.z = String(e.z);
      cell.dataset.cat = e.cat;
      cell.dataset.row = String(e.row);
      cell.dataset.col = String(e.col);
      cell.style.gridRow = String(gridRow(e.row));
      cell.style.gridColumn = String(e.col);
      cell.setAttribute('role', 'img');
      cell.title = e.z + '  ' + e.sym + '  ' + e.name + ' · ' + e.catLabel;

      cell.appendChild(el('span', 'cell__z', String(e.z)));
      cell.appendChild(el('span', 'cell__sym', e.sym));

      var nameText = e.name;
      if (willMissGlyph(nameText)) {
        nameText = e.sym;              // 缺字就退回元素符号，别显示豆腐块
        cell.dataset.glyphFallback = '1';
      }
      cell.appendChild(el('span', 'cell__name', nameText));

      var spec = D.SPECIALS[e.z];
      if (spec) {
        var meta = D.SPECIAL_META[spec.type];
        cell.dataset.special = spec.type;
        cell.appendChild(el('span', 'cell__badge', meta.glyph));
        cell.title += ' · ' + meta.label + '：' + meta.desc;
      }

      if (e.z === 1) cell.classList.add('is-start');
      if (e.z === D.MAX_Z) cell.classList.add('is-goal');

      cellMap[e.z] = cell;
      frag.appendChild(cell);
    }

    /* 镧系 / 锕系的占位小标：主表 (6,3) 与 (7,3) 空着，画两个提示块 */
    frag.appendChild(makeFBlockHint(6, 3, '57-71', '镧系'));
    frag.appendChild(makeFBlockHint(7, 3, '89-103', '锕系'));

    boardEl.appendChild(frag);

    layerEl = el('div', 'token-layer');
    boardEl.appendChild(layerEl);

    relayout();
  }

  function makeFBlockHint(row, col, range, label) {
    var d = el('div', 'cell');
    d.style.gridRow = String(row);
    d.style.gridColumn = String(col);
    d.style.opacity = '.34';
    d.style.pointerEvents = 'none';
    d.dataset.placeholder = '1';
    d.appendChild(el('span', 'cell__z', '*'));
    d.appendChild(el('span', 'cell__sym', '–'));
    d.appendChild(el('span', 'cell__name', label));
    d.title = range + ' ' + label;
    return d;
  }

  /* ---------------------------------------------------------
   * 位置测量
   * ------------------------------------------------------- */
  function measure() {
    posCache = Object.create(null);
    if (!boardEl) return;
    for (var z in cellMap) {
      var c = cellMap[z];
      if (!c) continue;
      posCache[z] = {
        x: c.offsetLeft + c.offsetWidth / 2,
        y: c.offsetTop + c.offsetHeight / 2,
        w: c.offsetWidth,
        h: c.offsetHeight
      };
    }
  }

  function relayout() {
    fitCell();      // 先定格子大小，再量位置
    measure();
    for (var pid in tokenMap) {
      var t = tokenMap[pid];
      if (t && t.dataset.z) placeToken(t, Number(t.dataset.z), pid);
    }
  }

  /** 同格多子时按圆周错开 */
  function placeToken(token, z, pid) {
    var p = posCache[z];
    if (!p) return;
    var mates = [];
    for (var id in tokenMap) {
      if (tokenMap[id] && Number(tokenMap[id].dataset.z) === z) mates.push(id);
    }
    var n = mates.length || 1;
    var idx = mates.indexOf(String(pid));
    if (idx < 0) idx = 0;

    var dx = 0, dy = 0;
    if (n > 1) {
      var a = (idx / n) * Math.PI * 2 - Math.PI / 2;
      var rad = Math.min(p.w, p.h) * 0.24;
      dx = Math.cos(a) * rad;
      dy = Math.sin(a) * rad;
    }
    token.style.setProperty('--x', (p.x + dx) + 'px');
    token.style.setProperty('--y', (p.y + dy) + 'px');
    token.dataset.z = String(z);
  }

  /* ---------------------------------------------------------
   * 棋子
   * ------------------------------------------------------- */
  function buildTokens(players) {
    layerEl.innerHTML = '';
    tokenMap = Object.create(null);

    players.forEach(function (pl) {
      var t = el('div', 'token', String(pl.id + 1));
      t.style.setProperty('--tk', pl.color);
      t.dataset.pid = String(pl.id);
      t.dataset.z = String(pl.pos);
      layerEl.appendChild(t);
      tokenMap[pl.id] = t;
    });

    measure();
    players.forEach(function (pl) { placeToken(tokenMap[pl.id], pl.pos, pl.id); });
  }

  function setTokenPos(pid, z, opts) {
    var t = tokenMap[pid];
    if (!t) return;
    opts = opts || {};
    if (opts.hop) t.classList.add('is-hopping');
    placeToken(t, z, pid);
    if (opts.hop) {
      setTimeout(function () { t.classList.remove('is-hopping'); }, 400 * speed);
    }
  }

  function markActive(pid) {
    for (var id in tokenMap) {
      if (tokenMap[id]) tokenMap[id].dataset.active = (String(id) === String(pid)) ? '1' : '0';
    }
  }

  function landBounce(pid) {
    var t = tokenMap[pid];
    if (!t) return;
    t.classList.remove('is-landed');
    void t.offsetWidth;
    t.classList.add('is-landed');
    setTimeout(function () { t.classList.remove('is-landed'); }, 480 * speed);
  }

  /* ---------------------------------------------------------
   * 格子状态
   * ------------------------------------------------------- */
  function clearClass(cls) {
    for (var z in cellMap) {
      if (cellMap[z]) cellMap[z].classList.remove(cls);
    }
  }

  function clearTransient() {
    clearClass('is-path');
    clearClass('is-target');
    clearClass('is-impact');
  }

  function pulsePath(path, ms) {
    for (var i = 0; i < path.length; i++) {
      var c = cellMap[path[i]];
      if (!c) continue;
      void c.offsetWidth;
      c.classList.add('is-path');
    }
    setTimeout(function () {
      for (var j = 0; j < path.length; j++) {
        var cc = cellMap[path[j]];
        if (cc) cc.classList.remove('is-path');
      }
    }, ms || 900);
  }

  function flashCell(z, cls, ms) {
    var c = cellMap[z];
    if (!c) return;
    c.classList.remove(cls);
    void c.offsetWidth;
    c.classList.add(cls);
    setTimeout(function () { c.classList.remove(cls); }, ms || 600);
  }

  function setCurrent(z) {
    clearClass('is-current');
    var c = cellMap[z];
    if (c) c.classList.add('is-current');
  }

  function markTarget(z) {
    clearClass('is-target');
    var c = cellMap[z];
    if (c) c.classList.add('is-target');
  }

  function scrollToCell(z, opts) {
    var c = cellMap[z];
    if (!c) return;
    try {
      c.scrollIntoView({
        behavior: (opts && opts.instant) ? 'auto' : 'smooth',
        block: 'nearest',
        inline: 'nearest'
      });
    } catch (e) { /* 老浏览器忽略 */ }
  }

  /** 镜头跟随：只在格子离开可视区时才滚动，避免抖动 */
  function followCell(z) {
    var c = cellMap[z];
    var scroller = boardEl && boardEl.parentElement;
    if (!c || !scroller) return;
    var cr = c.getBoundingClientRect();
    var sr = scroller.getBoundingClientRect();
    var m = 40;
    if (cr.left < sr.left + m || cr.right > sr.right - m ||
        cr.top < sr.top + m || cr.bottom > sr.bottom - m) {
      try {
        c.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
      } catch (e) { /* noop */ }
    }
  }

  /* ---------------------------------------------------------
   * 逐格移动（核心动画）
   * ------------------------------------------------------- */
  /**
   * 沿 path 逐格移动棋子，每格点亮一次。
   * @param {number} pid
   * @param {number[]} path
   * @param {object} opts { stepMs, onStep(z, i) }
   */
  function moveAlong(pid, path, opts) {
    opts = opts || {};
    var stepMs = opts.stepMs || 210;
    var i = 0;

    return new Promise(function (resolve) {
      function next() {
        if (i >= path.length) { resolve(); return; }
        var z = path[i];
        var prev = i === 0 ? path[0] : path[i - 1];
        var hop = !!D.HOPS[prev];
        setTokenPos(pid, z, { hop: hop });
        followCell(z);
        pulsePath([z], 420);
        if (opts.onStep) opts.onStep(z, i);
        i++;
        setTimeout(next, hop ? stepMs * 1.7 : stepMs);
      }
      if (!path.length) { resolve(); return; }
      next();
    });
  }

  /* ---------------------------------------------------------
   * 尺寸自适应
   * ------------------------------------------------------- */
  /**
   * 按容器实测尺寸反推格子大小，让 18 列 × 10.35 行尽量铺满。
   * 手机等窄屏保底 26px，宁可横向滚动也不要把字压没。
   */
  function fitCell() {
    if (!boardEl) return;
    var scroller = boardEl.parentElement;
    if (!scroller) return;

    var scs = getComputedStyle(scroller);
    var padX = (parseFloat(scs.paddingLeft) || 0) + (parseFloat(scs.paddingRight) || 0);
    var padY = (parseFloat(scs.paddingTop) || 0) + (parseFloat(scs.paddingBottom) || 0);
    var availW = scroller.clientWidth - padX - 3;
    var availH = scroller.clientHeight - padY - 3;
    if (availW <= 0 || availH <= 0) return;   // 还在 hidden 里，跳过

    var gap = parseFloat(getComputedStyle(boardEl).columnGap) || 4;
    var COLS = 18;
    var ROW_UNITS = 7 + 0.35 + 2;   // 7 主表 + 0.35 间隔行 + 2 个 f 区行
    var GAPS_H = COLS - 1;
    var GAPS_V = 9;                 // 10 行 → 9 个行间距 + 间隔行本身

    var byW = (availW - gap * GAPS_H) / COLS;
    var byH = (availH - gap * GAPS_V) / ROW_UNITS;
    var cell = Math.min(byW, byH, 66);
    cell = Math.max(cell, 26);

    document.documentElement.style.setProperty('--cell', cell.toFixed(2) + 'px');
  }

  /* ---------------------------------------------------------
   * 导出
   * ------------------------------------------------------- */
  global.EPF.view = {
    init: function (opts) {
      boardEl = opts.board;
      if (opts.speed) speed = opts.speed;
      renderBoard();
      fitCell();
    },
    fitCell: fitCell,
    setSpeed: function (v) { speed = Math.max(.25, Math.min(6, v || 1)); },
    renderBoard: renderBoard,
    buildTokens: buildTokens,
    relayout: relayout,
    setTokenPos: setTokenPos,
    markActive: markActive,
    landBounce: landBounce,
    moveAlong: moveAlong,
    pulsePath: pulsePath,
    flashCell: flashCell,
    setCurrent: setCurrent,
    markTarget: markTarget,
    clearTransient: clearTransient,
    scrollToCell: scrollToCell,
    followCell: followCell,
    cellOf: function (z) { return cellMap[z]; },
    sleep: sleep
  };
})(window);

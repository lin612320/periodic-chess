/* ============================================================
 * fx.js — 交互特效层
 * -----------------------------------------------------------
 *  · 元素知识卡（悬停）
 *  · 鼠标光晕 / 拖尾粒子 / 点击涟漪
 *  · 场景视差（鼠标推开背景）
 *  · 格子磁吸（靠近的格子会朝鼠标歪一点）
 * 全部走同一个 rAF 循环，不做重排。
 * ============================================================ */
(function (global) {
  'use strict';

  var D = global.EPF.data;
  var INFO = global.EPF.info;

  var canvas = null;
  var ctx = null;
  var haloEl = null;
  var cardEl = null;
  var trailEl = null;
  var boardEl = null;

  var mouse = { x: -999, y: -999, px: -999, py: -999, down: false };
  var enabled = false;
  var dpr = 1;

  /* 粒子池 */
  var particles = [];
  var ripples = [];
  var MAX_PARTICLES = 70;

  /* 光晕 / 视差的缓动值 */
  var halo = { x: -999, y: -999, tx: -999, ty: -999 };

  /* 卡片 */
  var card = { show: false, z: 0, hideTimer: null, locked: false };

  /* ---------------------------------------------------------
   * 工具
   * ------------------------------------------------------- */
  function lerp(a, b, t) { return a + (b - a) * t; }

  function isCoarse() {
    try { return window.matchMedia('(pointer: coarse)').matches; } catch (e) { return false; }
  }
  function reduceMotion() {
    try { return window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) { return false; }
  }

  /* ---------------------------------------------------------
   * Canvas 尺寸
   * ------------------------------------------------------- */
  function resize() {
    if (!canvas) return;
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.floor(window.innerWidth * dpr);
    canvas.height = Math.floor(window.innerHeight * dpr);
    canvas.style.width = window.innerWidth + 'px';
    canvas.style.height = window.innerHeight + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  /* ---------------------------------------------------------
   * 粒子
   * ------------------------------------------------------- */
  function spawnTrail(x, y) {
    if (particles.length >= MAX_PARTICLES) return;
    var speed = Math.hypot(x - mouse.px, y - mouse.py);
    if (speed < 2.4) return;                  // 移动太慢不喷
    particles.push({
      kind: 'trail',
      x: x + (Math.random() - 0.5) * 10,
      y: y + (Math.random() - 0.5) * 10,
      vx: (Math.random() - 0.5) * 0.42,
      vy: (Math.random() - 0.5) * 0.42 - 0.16,
      r: 0.9 + Math.random() * 1.9,
      life: 1,
      decay: 0.013 + Math.random() * 0.014
    });
  }

  function spawnRipple(x, y) {
    ripples.push({ x: x, y: y, r: 4, life: 1 });
    if (ripples.length > 8) ripples.shift();
    // 点击也带一小簇粒子
    for (var i = 0; i < 9; i++) {
      var a = (Math.PI * 2 * i) / 9 + Math.random() * 0.5;
      var sp = 1.1 + Math.random() * 1.7;
      if (particles.length >= MAX_PARTICLES) break;
      particles.push({
        kind: 'burst',
        x: x, y: y,
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp,
        r: 1.2 + Math.random() * 2,
        life: 1,
        decay: 0.02 + Math.random() * 0.018
      });
    }
  }

  function drawParticles() {
    if (!ctx) return;
    ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);

    var accent = getComputedStyle(document.body).getPropertyValue('--glow').trim() || '#ffb35c';

    /* 拖尾 / 爆炸粒子 */
    for (var i = particles.length - 1; i >= 0; i--) {
      var p = particles[i];
      p.x += p.vx;
      p.y += p.vy;
      p.vy += 0.008;                 // 极轻的下坠
      p.life -= p.decay;
      if (p.life <= 0) { particles.splice(i, 1); continue; }

      ctx.globalAlpha = Math.max(0, p.life) * (p.kind === 'burst' ? 0.86 : 0.5);
      ctx.fillStyle = accent;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r * p.life, 0, Math.PI * 2);
      ctx.fill();
    }

    /* 点击涟漪 */
    for (var j = ripples.length - 1; j >= 0; j--) {
      var rp = ripples[j];
      rp.r += 3.4;
      rp.life -= 0.028;
      if (rp.life <= 0) { ripples.splice(j, 1); continue; }
      ctx.globalAlpha = rp.life * 0.42;
      ctx.strokeStyle = accent;
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.arc(rp.x, rp.y, rp.r, 0, Math.PI * 2);
      ctx.stroke();
    }

    ctx.globalAlpha = 1;
  }

  /* ---------------------------------------------------------
   * 光晕
   * ------------------------------------------------------- */
  function updateHalo() {
    if (!haloEl) return;
    halo.x = lerp(halo.x, halo.tx, 0.16);
    halo.y = lerp(halo.y, halo.ty, 0.16);
    haloEl.style.transform =
      'translate3d(' + (halo.x - 260) + 'px,' + (halo.y - 260) + 'px,0)';
  }

  /* ---------------------------------------------------------
   * 场景视差
   * ------------------------------------------------------- */
  var parallaxLayers = [];
  function cacheParallax() {
    parallaxLayers = [];
    var scene = document.querySelector('.scene');
    if (!scene) return;
    ['sky', 'sun', 'haze', 'curtain--l', 'curtain--r'].forEach(function (cls) {
      var n = scene.querySelector('.' + cls) || scene.querySelector('[class*="' + cls + '"]');
      if (n) parallaxLayers.push({ node: n, depth: cls === 'sun' ? 26 : (cls.indexOf('curtain') === 0 ? 16 : 10) });
    });
  }

  var par = { x: 0, y: 0, tx: 0, ty: 0 };
  function updateParallax() {
    if (!parallaxLayers.length) return;
    par.x = lerp(par.x, par.tx, 0.06);
    par.y = lerp(par.y, par.ty, 0.06);
    for (var i = 0; i < parallaxLayers.length; i++) {
      var L = parallaxLayers[i];
      /* 用独立的 translate 属性，不去覆盖各层自己的 transform 动画 */
      L.node.style.translate =
        (par.x * L.depth).toFixed(2) + 'px ' + (par.y * L.depth).toFixed(2) + 'px';
    }
  }

  /* ---------------------------------------------------------
   * 元素知识卡
   * ------------------------------------------------------- */
  function periodLabel(info) {
    var p = '第 ' + info.period + ' 周期';
    if (info.group) {
      var g = info.group;
      var groupName = (g <= 2) ? '第 ' + String.fromCharCode(64 + g) + ' 族'
        : (g <= 7 ? '第 ' + g + ' 族'
          : (g <= 10 ? '第 ' + (g) + ' 族'
            : (g <= 12 ? '第 ' + (g) + ' 族'
              : (g === 18 ? '0 族' : '第 ' + String.fromCharCode(64 + g - 10) + ' 族'))));
      return p + ' · ' + groupName;
    }
    return p + ' · ' + info.catLabel;
  }

  function buildCard(info) {
    var facts = info.facts.map(function (f) {
      return '<li class="ecard__fact">' + f + '</li>';
    }).join('');

    var e = D.BY_Z[info.z];
    return ''
      + '<div class="ecard__top" data-cat="' + info.cat + '">'
      + '<div class="ecard__z">' + info.z + '</div>'
      + '<div class="ecard__sym">' + info.sym + '</div>'
      + '<div class="ecard__id">'
      + '<div class="ecard__name">' + info.name + '</div>'
      + '<div class="ecard__pos">' + periodLabel(info) + '</div>'
      + '</div>'
      + '</div>'
      + '<div class="ecard__rows">'
      + '<div class="ecard__row"><span>相对原子质量</span><b>' + info.mass + '</b></div>'
      + '<div class="ecard__row"><span>电子层排布</span><b>' + info.shells.join(', ') + '</b></div>'
      + '<div class="ecard__row"><span>最外层电子数</span><b>' + info.outer + '</b></div>'
      + '</div>'
      + '<div class="ecard__config" title="能级排布">' + info.config + '</div>'
      + '<ul class="ecard__facts">' + facts + '</ul>'
      + '<div class="ecard__tail">' + info.catLabel + '</div>';
  }

  function placeCard(x, y) {
    if (!cardEl) return;
    var pad = 18;
    var w = cardEl.offsetWidth;
    var h = cardEl.offsetHeight;
    var vw = window.innerWidth;
    var vh = window.innerHeight;

    var left = x + 22;
    if (left + w + pad > vw) left = x - w - 22;
    if (left < pad) left = pad;

    var top = y - h * 0.34;
    if (top + h + pad > vh) top = vh - h - pad;
    if (top < pad) top = pad;

    cardEl.style.transform = 'translate3d(' + Math.round(left) + 'px,' + Math.round(top) + 'px,0)';
  }

  function openCard(z, x, y) {
    if (!cardEl || !INFO) return;
    var info = INFO.get(z);
    if (!info) return;
    if (card.z !== z) {
      cardEl.innerHTML = buildCard(info);
      card.z = z;
    }
    cardEl.hidden = false;
    placeCard(x, y);
    card.show = true;
    // 先定位再开类，避免从左上角飞过来
    void cardEl.offsetWidth;
    cardEl.dataset.show = '1';
  }

  function closeCard(immediate) {
    if (!cardEl) return;
    card.show = false;
    card.el_hide = true;
    cardEl.dataset.show = '0';
    card.z = 0;
    clearTimeout(card.hideTimer);
    card.hideTimer = setTimeout(function () {
      if (!card.show) { cardEl.hidden = true; cardEl.innerHTML = ''; }
    }, immediate ? 0 : 200);
  }

  /* ---------------------------------------------------------
   * 格子磁吸
   * ------------------------------------------------------- */
  function bindMagnet(board) {
    boardEl = board;
    /* V.init 会重建 #board 的子节点，但 #board 本身复用，得防重复挂监听 */
    if (board.dataset.fxBound === '1') return;
    board.dataset.fxBound = '1';

    var current = null;
    var raf = 0;

    function updateTilt(ev) {
      if (!current) return;
      var r = current.getBoundingClientRect();
      var cx = r.left + r.width / 2;
      var cy = r.top + r.height / 2;
      var dx = Math.max(-1, Math.min(1, (ev.clientX - cx) / (r.width * 0.9)));
      var dy = Math.max(-1, Math.min(1, (ev.clientY - cy) / (r.height * 0.9)));
      current.style.setProperty('--tilt-x', (-dy * 7).toFixed(2) + 'deg');
      current.style.setProperty('--tilt-y', (dx * 7).toFixed(2) + 'deg');
      current.style.setProperty('--mx', ((ev.clientX - r.left) / r.width * 100).toFixed(1) + '%');
      current.style.setProperty('--my', ((ev.clientY - r.top) / r.height * 100).toFixed(1) + '%');
    }

    board.addEventListener('pointerover', function (ev) {
      var cell = ev.target.closest('.cell[data-z]');
      if (!cell || cell === current) return;
      if (current) {
        current.classList.remove('is-magnet');
        current.style.removeProperty('--tilt-x');
        current.style.removeProperty('--tilt-y');
      }
      current = cell;
      current.classList.add('is-magnet');
      updateTilt(ev);
    });

    board.addEventListener('pointerout', function (ev) {
      var cell = ev.target.closest('.cell[data-z]');
      if (!cell) return;
      var to = ev.relatedTarget && ev.relatedTarget.closest ? ev.relatedTarget.closest('.cell[data-z]') : null;
      if (to === cell) return;
      cell.classList.remove('is-magnet');
      cell.style.removeProperty('--tilt-x');
      cell.style.removeProperty('--tilt-y');
      if (cell === current) current = null;
    });

    board.addEventListener('pointermove', function (ev) {
      if (!current) return;
      if (raf) return;
      raf = requestAnimationFrame(function () {
        raf = 0;
        updateTilt(ev);
      });
    });
  }

  /* ---------------------------------------------------------
   * 全局事件
   * ------------------------------------------------------- */
  function onPointerMove(ev) {
    mouse.px = mouse.x;
    mouse.py = mouse.y;
    mouse.x = ev.clientX;
    mouse.y = ev.clientY;

    halo.tx = mouse.x;
    halo.ty = mouse.y;

    if (document.body.classList.contains('is-stage')) {
      par.tx = (mouse.x / window.innerWidth - 0.5) * 2;
      par.ty = (mouse.y / window.innerHeight - 0.5) * 2;
    } else {
      par.tx = (mouse.x / window.innerWidth - 0.5) * 2;
      par.ty = (mouse.y / window.innerHeight - 0.5) * 2;
    }

    if (!reduceMotion()) spawnTrail(mouse.x, mouse.y);

    /* 悬停元素格 → 弹卡 */
    var cell = ev.target.closest ? ev.target.closest('.cell[data-z]') : null;
    if (cell && document.body.classList.contains('is-stage')) {
      openCard(Number(cell.dataset.z), mouse.x, mouse.y);
    } else if (card.show) {
      closeCard();
    } else if (!cardEl.hidden && !card.show) {
      /* 已经淡出中，不管 */
    }
  }

  function onPointerDown(ev) {
    if (reduceMotion()) return;
    spawnRipple(ev.clientX, ev.clientY);
  }

  /* ---------------------------------------------------------
   * 主循环
   * ------------------------------------------------------- */
  function tick() {
    updateHalo();
    updateParallax();
    drawParticles();
    if (card.show) placeCard(mouse.x, mouse.y);
    requestAnimationFrame(tick);
  }

  /* ---------------------------------------------------------
   * 初始化
   * ------------------------------------------------------- */
  function init(opts) {
    canvas = opts.canvas;
    haloEl = opts.halo;
    cardEl = opts.card;
    if (canvas) ctx = canvas.getContext('2d');

    resize();
    window.addEventListener('resize', resize);

    cacheParallax();
    requestAnimationFrame(tick);

    if (isCoarse()) {
      // 触屏没有 hover，卡片改由长按/点击触发（见 bindTapCard）
      bindTapCard();
      return;
    }

    window.addEventListener('pointermove', onPointerMove, { passive: true });
    window.addEventListener('pointerdown', onPointerDown, { passive: true });
    document.addEventListener('mouseleave', function () {
      halo.tx = -999; halo.ty = -999;
      if (card.show) closeCard();
    });

    enabled = true;
  }

  /** 触屏：点一下格子就弹卡 */
  function bindTapCard() {
    document.addEventListener('pointerup', function (ev) {
      var cell = ev.target.closest ? ev.target.closest('.cell[data-z]') : null;
      if (cell && document.body.classList.contains('is-stage')) {
        var r = cell.getBoundingClientRect();
        card.locked = true;
        openCard(Number(cell.dataset.z), r.left + r.width, r.top);
      } else if (card.locked) {
        card.locked = false;
        closeCard();
      }
    }, { passive: true });
  }

  function bindBoard(board) {
    bindMagnet(board);
  }

  function setStageMode(on) {
    document.body.classList.toggle('is-stage', !!on);
    if (!on && card.show) closeCard(true);
  }

  global.EPF = global.EPF || {};
  global.EPF.fx = {
    init: init,
    bindBoard: bindBoard,
    setStageMode: setStageMode,
    openCard: openCard,
    closeCard: closeCard,
    refreshParallax: cacheParallax
  };
})(window);

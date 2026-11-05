/* ============================================================
 * prologue.js — 序章：六幕，每一幕都要你动一下手
 * -----------------------------------------------------------
 *  幕1 把人群拨开      —— 鼠标靠近，人影往两边散
 *  幕2 你就是太阳      —— 鼠标横向 = 太阳高度，树影实时伸缩
 *  幕3 翻纸袋          —— 悬停翻面，点一个才算选好
 *  幕4 把灯点起来      —— 划过的座位一盏盏亮
 *  幕5 推门            —— 按住往两边推，门缝见光
 *  幕6 按下 RAN        —— 真的按，LCD 当场算出骰子数，然后才进游戏
 * ============================================================ */
(function (global) {
  'use strict';

  var root = null;
  var stageEl = null;
  var dotsEl = null;
  var nextBtn = null;
  var skipBtn = null;
  var hintEl = null;
  var sndBtn = null;
  var sndLabel = null;

  var acts = [];
  var scenes = [];
  var index = -1;
  var currentEl = null;
  var timers = [];
  var onDone = null;
  var running = false;
  var unlocked = true;
  var rafPending = false;
  var lastPointer = { x: -999, y: -999 };

  /* 音效节流 */
  var sndGate = { crowd: 0, seat: 0 };

  /** 序章音景；没开就是空操作 */
  function sceneAudio() {
    return global.EPF.scene || null;
  }
  function play(name, arg) {
    var s = sceneAudio();
    if (!s || !s.isOn()) return;
    try { s[name](arg); } catch (e) { /* noop */ }
  }
  function throttle(key, ms) {
    var now = Date.now();
    if (now - sndGate[key] < ms) return false;
    sndGate[key] = now;
    return true;
  }

  /* =========================================================
   * 小工具
   * ======================================================= */
  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }
  function rand(a, b) { return a + Math.random() * (b - a); }

  function clearTimers() {
    for (var i = 0; i < timers.length; i++) clearTimeout(timers[i]);
    timers = [];
  }
  function later(fn, ms) { timers.push(setTimeout(fn, ms)); }

  function el(tag, cls) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    return n;
  }

  /* =========================================================
   * 幕 1：把人群拨开
   * ======================================================= */
  function buildCrowd(art) {
    var crowd = art.querySelector('#crowd');
    if (!crowd || crowd.dataset.built) return;
    crowd.dataset.built = '1';

    var rect = crowd.getBoundingClientRect();
    for (var i = 0; i < 28; i++) {
      var d = el('i');
      /* 避开校门正中间那一小块，让人群散在校门两侧和门洞里 */
      var x;
      if (i % 3 === 0) x = rand(38, 62);          // 门洞里往外走
      else x = (i % 2 === 0) ? rand(6, 36) : rand(64, 94);

      var y = rand(0, 0.72);
      d.style.left = x + '%';
      d.style.bottom = (y * 100) + '%';
      d.style.opacity = (0.5 + Math.random() * 0.5).toFixed(2);
      d._x = rect.width * x / 100;
      d._y = rect.height * (1 - y);
      crowd.appendChild(d);
    }
  }

  function pushCrowd(art, pt) {
    var crowd = art.querySelector('#crowd');
    if (!crowd) return;
    var rect = crowd.getBoundingClientRect();
    var mx = pt.x - rect.left;
    var my = pt.y - rect.top;
    if (!isFinite(mx) || !isFinite(my)) return;

    var kids = crowd.children;
    var anyPushed = false;

    for (var i = 0; i < kids.length; i++) {
      var d = kids[i];
      var dx = d._x - mx;
      var dy = d._y - my;
      var dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < 96 && dist > 0.01) {
        var f = (96 - dist) / 96;
        d.style.translate = (dx / dist * f * 46).toFixed(1) + 'px '
          + (dy / dist * f * 16).toFixed(1) + 'px';
        d.classList.add('is-near');
        anyPushed = true;
      } else {
        d.style.translate = '0px 0px';
        d.classList.remove('is-near');
      }
    }

    if (anyPushed && throttle('crowd', 700)) play('crowd');
  }

  /* =========================================================
   * 幕 2：鼠标就是太阳
   * ======================================================= */
  function buildShadows(art) {
    var box = art.querySelector('#shadows');
    if (!box || box.dataset.built) return;
    box.dataset.built = '1';

    for (var i = 0; i < 13; i++) {
      var sh = el('i');
      var base = rand(30, 96);
      sh._base = base;
      sh.style.left = (4 + i * 7.2 + rand(-1.6, 1.6)) + '%';
      sh.style.height = base + 'px';
      sh.style.width = rand(6, 21).toFixed(0) + 'px';
      sh.style.opacity = (0.42 + Math.random() * 0.46).toFixed(2);
      box.appendChild(sh);
    }
    var r = box.getBoundingClientRect();
    moveSun(art, { x: r.left + r.width * 0.55, y: r.top + r.height * 0.5 });
  }

  function moveSun(art, pt) {
    var sun = art.querySelector('#sunball');
    var box = art.querySelector('#shadows');
    if (!sun || !box || !pt) return;

    var rect = box.getBoundingClientRect();
    if (!rect.width) return;
    var t = clamp((pt.x - rect.left) / rect.width, 0, 1);
    if (!isFinite(t)) return;

    /* 太阳在左 → 位置低、影子长；在右 → 位置高、影子短 */
    sun.style.left = (16 + t * 68).toFixed(2) + '%';
    sun.style.top = (12 + (1 - t) * 30).toFixed(2) + '%';

    var lenScale = 1.75 - t * 1.05;
    var rot = -24 + t * 50;

    var kids = box.children;
    for (var i = 0; i < kids.length; i++) {
      kids[i].style.height = (kids[i]._base * lenScale).toFixed(1) + 'px';
      kids[i].style.transform = 'rotate(' + rot.toFixed(1) + 'deg)';
    }

    /* 声音跟着光走：太阳低（t→0）音色沉，太阳高（t→1）音色亮 */
    var s = sceneAudio();
    if (s && s.isOn()) {
      try { s.setSun(t); } catch (e) { /* noop */ }
    }
  }

  /* =========================================================
   * 幕 3：翻纸袋
   * ======================================================= */
  function bindBags(art, unlock) {
    var bags = art.querySelectorAll('.bag');
    for (var i = 0; i < bags.length; i++) {
      var b = bags[i];
      if (b.dataset.bound) continue;
      b.dataset.bound = '1';

      b.querySelector('.bag__inner').setAttribute('data-label', b.dataset.label);

      b.addEventListener('click', function (ev) {
        ev.stopPropagation();
        for (var k = 0; k < bags.length; k++) bags[k].classList.remove('is-picked');
        this.classList.add('is-picked');
        play('paper');
        unlock();
      });
    }
  }

  /* =========================================================
   * 幕 4：把灯点起来
   * ======================================================= */
  function buildClassroom(art) {
    var room = art.querySelector('#classroom');
    if (!room || room.dataset.built) return;
    room.dataset.built = '1';

    /* 4 排 × 7 列；靠窗那排有个 lyx */
    var LYx = 9;
    var alwaysLit = [2, 16, 22];

    for (var i = 0; i < 28; i++) {
      var s = el('i');
      if (alwaysLit.indexOf(i) >= 0) s.classList.add('is-always');
      if (i === LYx) s.classList.add('is-always', 'is-lyx');
      room.appendChild(s);
    }
  }

  function lightSeats(art, pt) {
    var room = art.querySelector('#classroom');
    if (!room || !pt) return;
    var node = document.elementFromPoint(pt.x, pt.y);
    var seat = (node && node.closest) ? node.closest('#classroom i') : null;
    if (seat && room.contains(seat) && !seat.classList.contains('is-lit')) {
      seat.classList.add('is-lit');
      if (throttle('seat', 90)) play('seat');
    }
  }

  /* =========================================================
   * 幕 5：推门
   * ======================================================= */
  function bindDoor(art, unlock) {
    var door = art.querySelector('#door');
    if (!door || door.dataset.bound) return;
    door.dataset.bound = '1';

    var dragging = false;
    var startX = 0;
    var startOpen = 0;

    function setOpen(v) {
      var prev = parseFloat(door.style.getPropertyValue('--open') || '0');
      var o = clamp(v, 0, 1);
      door.style.setProperty('--open', o.toFixed(3));
      /* 每推开一档给一声低频的风 */
      if (o - prev > 0.16) play('door', o);
      if (o > 0.62) unlock();
    }

    door.addEventListener('pointerdown', function (ev) {
      dragging = true;
      startX = ev.clientX;
      startOpen = parseFloat(door.style.getPropertyValue('--open') || '0');
      try { door.setPointerCapture(ev.pointerId); } catch (e) { /* noop */ }
      ev.stopPropagation();
    });

    door.addEventListener('pointermove', function (ev) {
      if (!dragging) return;
      var dx = Math.abs(ev.clientX - startX);
      setOpen(startOpen + dx / 78);
      ev.stopPropagation();
    });

    function end(ev) {
      if (!dragging) return;
      dragging = false;
      try { door.releasePointerCapture(ev.pointerId); } catch (e) { /* noop */ }
    }
    door.addEventListener('pointerup', end);
    door.addEventListener('pointercancel', end);

    /* 不想拖也行：直接点两下门也能开 */
    door.addEventListener('click', function (ev) {
      ev.stopPropagation();
      var cur = parseFloat(door.style.getPropertyValue('--open') || '0');
      setOpen(cur + 0.45);
    });
  }

  /* =========================================================
   * 幕 6：真的按下 RAN
   * ======================================================= */
  function bindCalc(art, unlock) {
    var btn = art.querySelector('#proRan');
    var lcd = art.querySelector('#proLcd');
    var body = art.querySelector('#calcBody');
    if (!btn || btn.dataset.bound) return;
    btn.dataset.bound = '1';

    btn.addEventListener('click', function (ev) {
      ev.stopPropagation();
      if (btn.disabled) return;
      btn.disabled = true;
      btn.classList.add('is-press');
      setTimeout(function () { btn.classList.remove('is-press'); }, 140);
      play('key');

      /* 就按真游戏里那套来算，别糊弄 */
      var ran = Math.round(Math.random() * 1000) / 1000;
      if (ran >= 1) ran = 0.999;
      var raw = 6 * ran + 0.5;
      var die = Math.floor(raw + 0.5);

      lcd.textContent = ran.toFixed(3);

      setTimeout(function () {
        lcd.textContent = (6 * ran).toFixed(3) + ' + 0.5';
      }, 480);

      setTimeout(function () {
        lcd.textContent = raw.toFixed(3);
      }, 980);

      setTimeout(function () {
        lcd.textContent = 'Rnd = ' + die;
        lcd.classList.add('is-hit');
        btn.classList.add('is-done');
        if (body) body.classList.add('is-thanked');
      }, 1440);

      setTimeout(function () { unlock(); }, 1900);
    });
  }

  /* =========================================================
   * 场景表
   * ======================================================= */
  function buildScenes() {
    scenes = acts.map(function (actEl, i) {
      var art = actEl.querySelector('.art');
      if (!art) return null;

      var api = { act: actEl, art: art, index: i, move: null, enter: null, gated: false };

      if (i === 0) {
        api.enter = function () { buildCrowd(art); };
        api.move = function (pt) { pushCrowd(art, pt); };
      } else if (i === 1) {
        api.enter = function () { buildShadows(art); };
        api.move = function (pt) { moveSun(art, pt); };
      } else if (i === 2) {
        api.gated = true;
        api.enter = function () { bindBags(art, unlockScene); };
      } else if (i === 3) {
        api.enter = function () { buildClassroom(art); };
        api.move = function (pt) { lightSeats(art, pt); };
      } else if (i === 4) {
        api.gated = true;
        api.enter = function () { bindDoor(art, unlockScene); };
      } else if (i === 5) {
        api.gated = true;
        api.enter = function () { bindCalc(art, unlockScene); };
      }

      return api;
    });
  }

  /* =========================================================
   * 推进控制
   * ======================================================= */
  function setHint(text) {
    if (hintEl) hintEl.textContent = text;
  }

  function lockScene(actEl) {
    unlocked = false;
    nextBtn.classList.remove('is-on');
    nextBtn.classList.add('is-locked');
    setHint(actEl.dataset.hint || '先做点什么');
  }

  function unlockScene() {
    if (unlocked) return;
    unlocked = true;
    nextBtn.classList.remove('is-locked');
    nextBtn.classList.add('is-on');
    setHint('继续');
    /* 动作做完了，停一拍就走 */
    later(advance, 1700);
  }

  function durationOf(actEl) {
    var lines = actEl.querySelectorAll('.act__line').length;
    return lines * 620 + 2600;
  }

  function show(i, hold) {
    clearTimers();

    if (currentEl) {
      currentEl.classList.remove('is-live');
      currentEl.classList.add('is-gone');
      currentEl.style.opacity = '';      // 收掉上一幕的强制值
    }

    index = i;

    if (i >= acts.length) { finish(); return; }

    var actEl = acts[i];
    currentEl = actEl;

    var lines = actEl.querySelectorAll('.act__line');
    for (var k = 0; k < lines.length; k++) {
      lines[k].style.setProperty('--i', String(k));
      lines[k].querySelector('span').style.animationDelay = '';
    }

    actEl.classList.remove('is-gone');
    void actEl.offsetWidth;
    actEl.classList.add('is-live');

    /* Chrome 的 opacity 过渡会停在 0.9999…，非 1 就会留一个合成层，
       边界在暗背景上看得见一道方框。过渡结束后钉死成 1。 */
    actEl.style.opacity = '';
    later(function () {
      if (actEl.classList.contains('is-live')) actEl.style.opacity = '1';
    }, 820);

    root.dataset.act = String(i);
    markDots(i);
    if (i > 0) play('sceneShift');

    var scene = scenes[i];
    if (scene && scene.enter) {
      /* 等一帧，让 art 量到真实尺寸 */
      requestAnimationFrame(function () {
        try { scene.enter(); } catch (e) { console.error('[prologue] 场景初始化失败', e); }
      });
    }

    if (scene && scene.gated) {
      lockScene(actEl);
    } else {
      unlocked = true;
      nextBtn.classList.remove('is-locked');
      setHint('轻触继续');
      nextBtn.classList.remove('is-on');
      if (hold) {
        /* 调试/截图用：停在这一幕，不自动走 */
        nextBtn.classList.add('is-on');
        return;
      }
      var dur = durationOf(actEl);
      later(function () { nextBtn.classList.add('is-on'); }, dur - 1500);
      later(function () { show(i + 1); }, dur);
    }
  }

  function advance() {
    if (!running) return;
    if (!unlocked) return;    // 这一幕的动作还没做完

    var actEl = acts[index];
    if (actEl) {
      var spans = actEl.querySelectorAll('.act__line span');
      for (var i = 0; i < spans.length; i++) spans[i].style.animationDelay = '0ms';
    }
    show(index + 1);
  }

  function finish() {
    if (!running) return;
    running = false;
    clearTimers();
    root.classList.add('is-out');
    nextBtn.classList.remove('is-on');
    var s = sceneAudio();
    if (s && s.isOn()) s.close();
    setTimeout(function () {
      root.hidden = true;
      document.body.classList.remove('prologue-on');
      if (onDone) onDone();
    }, 780);
  }

  function skip() {
    if (!running) return;
    running = false;
    clearTimers();
    root.hidden = true;
    document.body.classList.remove('prologue-on');
    var s = sceneAudio();
    if (s && s.isOn()) s.close();
    if (onDone) onDone();
  }

  /* =========================================================
   * 鼠标分发：只有当前幕收
   * ======================================================= */
  function onPointerMove(ev) {
    lastPointer.x = ev.clientX;
    lastPointer.y = ev.clientY;
    var scene = scenes[index];
    if (!scene || !scene.move) return;
    if (rafPending) return;
    rafPending = true;
    requestAnimationFrame(function () {
      rafPending = false;
      try { scene.move(lastPointer); } catch (e) { /* noop */ }
    });
  }

  /* =========================================================
   * 启动
   * ======================================================= */
  function start(opts) {
    opts = opts || {};
    onDone = opts.onDone || function () {};

    root = document.getElementById('prologue');
    stageEl = document.getElementById('prologueStage');
    dotsEl = document.getElementById('prologueDots');
    nextBtn = document.getElementById('prologueNext');
    skipBtn = document.getElementById('prologueSkip');
    hintEl = document.getElementById('prologueHint');

    if (!root || !stageEl) { onDone(); return; }

    acts = Array.prototype.slice.call(stageEl.querySelectorAll('.act'));
    if (!acts.length) { root.hidden = true; onDone(); return; }

    buildScenes();

    dotsEl.innerHTML = '';
    for (var i = 0; i < acts.length; i++) dotsEl.appendChild(document.createElement('i'));

    root.hidden = false;
    running = true;
    document.body.classList.add('prologue-on');

    root.addEventListener('click', function (ev) {
      if (ev.target === skipBtn) return;
      if (ev.target.closest('.bag') || ev.target.closest('#door') || ev.target.closest('#proRan')) return;
      advance();
    });

    root.addEventListener('wheel', advance, { passive: true });
    root.addEventListener('pointermove', onPointerMove, { passive: true });

    nextBtn.addEventListener('click', function (ev) { ev.stopPropagation(); advance(); });
    skipBtn.addEventListener('click', function (ev) { ev.stopPropagation(); skip(); });

    /* 序章音景开关 */
    sndBtn = document.getElementById('prologueSnd');
    sndLabel = document.getElementById('prologueSndLabel');
    if (sndBtn) {
      sndBtn.addEventListener('click', function (ev) {
        ev.stopPropagation();
        var s = sceneAudio();
        if (!s) { if (sndLabel) sndLabel.textContent = '放不出声'; return; }
        var isOn = s.toggle();
        sndBtn.setAttribute('aria-pressed', isOn ? 'true' : 'false');
        if (sndLabel) sndLabel.textContent = isOn ? '声音：开' : '声音：关';
        if (isOn) {
          /* 一开就对齐当前这一幕的太阳位置 */
          if (index === 1) {
            var box = acts[1].querySelector('#shadows');
            if (box) {
              var r = box.getBoundingClientRect();
              s.setSun(clamp((lastPointer.x - r.left) / (r.width || 1), 0, 1));
            }
          }
        }
      });
    }

    document.addEventListener('keydown', function (ev) {
      if (!running) return;
      if (ev.key === ' ' || ev.key === 'Enter' || ev.key === 'ArrowRight') {
        ev.preventDefault();
        advance();
      } else if (ev.key === 'Escape') {
        skip();
      }
    });

    show(0);
  }

  function markDots(i) {
    var kids = dotsEl.children;
    for (var k = 0; k < kids.length; k++) {
      kids[k].classList.toggle('is-on', k === i);
    }
  }

  global.EPF = global.EPF || {};
  global.EPF.prologue = {
    start: start,
    /* 测试/调试用：直接跳到某一幕；hold = true 则停住不自动推进 */
    goTo: function (i, hold) {
      if (!running) return false;
      if (i < 0 || i >= acts.length) return false;
      unlocked = true;
      show(i, !!hold);
      return true;
    },
    current: function () { return index; },
    isRunning: function () { return running; }
  };
})(window);

/* ============================================================
 * prologue-audio.js — 序章音景
 * -----------------------------------------------------------
 * 第一版难听的原因，记在这里免得再犯：
 *   ✗ sawtooth 65Hz 当低频铺底 → 电锯嗡嗡
 *   ✗ 所谓"粉噪声"其实是极强一阶低通再 ×3.2 → 闷雷
 *   ✗ 370Hz 窄带噪声 → 正好在人耳最敏感区，像收音机噪音
 *
 * 这一版改成**纯环境声**，一个音调性的 drone 都不要：
 *   风       粉噪声 → 低通（太阳越低截止越低）→ 阵风 LFO
 *   树叶     白噪声 → 高通 → 极轻，随机起伏
 *   远处城市 粉噪声 → 低通 160Hz → 几乎是耳膜感
 * 太阳位置只驱动"亮暗"和"风大风小"，不改变音高 —— 变音高就成变调了。
 * ============================================================ */
(function (global) {
  'use strict';

  var API = global.EPF.audio;

  var ctx = null;
  var master = null;
  var on = false;

  var wind = null;
  var leaves = null;
  var city = null;

  var pinkBuf = null;
  var whiteBuf = null;

  var cur = { sun: 0.55 };

  /* ---------------------------------------------------------
   * 真正的粉噪声（Paul Kellet 近似）
   * ------------------------------------------------------- */
  function makePink(len) {
    if (!ctx) return null;
    var buf = ctx.createBuffer(1, len, ctx.sampleRate);
    var d = buf.getChannelData(0);
    var b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
    for (var i = 0; i < len; i++) {
      var w = Math.random() * 2 - 1;
      b0 = 0.99886 * b0 + w * 0.0555179;
      b1 = 0.99332 * b1 + w * 0.0750759;
      b2 = 0.96900 * b2 + w * 0.1538520;
      b3 = 0.86650 * b3 + w * 0.3104856;
      b4 = 0.55000 * b4 + w * 0.5329522;
      b5 = -0.7616 * b5 - w * 0.0168980;
      d[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11;
      b6 = w * 0.115926;
    }
    return buf;
  }

  function makeWhite(len) {
    if (!ctx) return null;
    var buf = ctx.createBuffer(1, len, ctx.sampleRate);
    var d = buf.getChannelData(0);
    for (var i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * 0.6;
    return buf;
  }

  function getPink() {
    if (!pinkBuf) pinkBuf = makePink(Math.floor(ctx.sampleRate * 4));
    return pinkBuf;
  }
  function getWhite() {
    if (!whiteBuf) whiteBuf = makeWhite(Math.floor(ctx.sampleRate * 3));
    return whiteBuf;
  }

  /* ---------------------------------------------------------
   * 建音景
   * ------------------------------------------------------- */
  function build() {
    if (wind) return;

    /* ---------- 风 ---------- */
    var wSrc = ctx.createBufferSource();
    wSrc.buffer = getPink();
    wSrc.loop = true;

    var wLp = ctx.createBiquadFilter();
    wLp.type = 'lowpass';
    wLp.frequency.value = 620;
    wLp.Q.value = 0.55;

    var wGain = ctx.createGain();
    wGain.gain.value = 0.0001;

    /* 阵风：很慢的 LFO 推音量 */
    var wLfo = ctx.createOscillator();
    wLfo.type = 'sine';
    wLfo.frequency.value = 0.085;
    var wLfoGain = ctx.createGain();
    wLfoGain.gain.value = 0.035;
    wLfo.connect(wLfoGain);
    wLfoGain.connect(wGain.gain);

    wSrc.connect(wLp);
    wLp.connect(wGain);
    wGain.connect(master);

    wSrc.start();
    wLfo.start();
    wind = { src: wSrc, filter: wLp, gain: wGain, lfo: wLfo };

    /* ---------- 树叶沙沙，断断续续 ---------- */
    var lSrc = ctx.createBufferSource();
    lSrc.buffer = getWhite();
    lSrc.loop = true;

    var lHp = ctx.createBiquadFilter();
    lHp.type = 'highpass';
    lHp.frequency.value = 2600;
    lHp.Q.value = 0.5;

    var lBp = ctx.createBiquadFilter();
    lBp.type = 'peaking';
    lBp.frequency.value = 4200;
    lBp.gain.value = 4;
    lBp.Q.value = 0.8;

    var lGain = ctx.createGain();
    lGain.gain.value = 0.0001;

    var lLfo = ctx.createOscillator();
    lLfo.type = 'sine';
    lLfo.frequency.value = 0.23;
    var lLfoGain = ctx.createGain();
    lLfoGain.gain.value = 0.012;
    lLfo.connect(lLfoGain);
    lLfoGain.connect(lGain.gain);

    lSrc.connect(lHp);
    lHp.connect(lBp);
    lBp.connect(lGain);
    lGain.connect(master);

    lSrc.start();
    lLfo.start();
    leaves = { src: lSrc, gain: lGain, lfo: lLfo };

    /* ---------- 远处城市的低频，几乎听不清但少了它就不对 ---------- */
    var cSrc = ctx.createBufferSource();
    cSrc.buffer = getPink();
    cSrc.loop = true;

    var cLp = ctx.createBiquadFilter();
    cLp.type = 'lowpass';
    cLp.frequency.value = 160;
    cLp.Q.value = 0.7;

    var cGain = ctx.createGain();
    cGain.gain.value = 0.0001;

    cSrc.connect(cLp);
    cLp.connect(cGain);
    cGain.connect(master);

    cSrc.start();
    city = { src: cSrc, filter: cLp, gain: cGain };
  }

  /* ---------------------------------------------------------
   * 太阳位置 → 环境音的亮暗与风大小
   *   t = 0 太阳低、影子最长 → 风更沉更响，环境更暗
   *   t = 1 太阳高、影子最短 → 风更细更轻，环境更亮
   * ------------------------------------------------------- */
  function setSun(t) {
    if (!on || !wind || !ctx) return;
    t = Math.max(0, Math.min(1, t));
    cur.sun = t;

    var now = ctx.currentTime;
    var smooth = 0.16;

    /* 风声：太阳低 → 截止低（闷）；升高 → 渐渐通透 */
    wind.filter.frequency.setTargetAtTime(240 + Math.pow(t, 0.8) * 1250, now, smooth);
    wind.gain.gain.setTargetAtTime(0.10 + (1 - t) * 0.075, now, smooth);

    /* 树叶：太阳低时安静一点，风大时才沙沙 */
    leaves.gain.gain.setTargetAtTime(0.008 + t * 0.016, now, smooth);

    /* 远处城市：太阳越低越沉 */
    city.filter.frequency.setTargetAtTime(120 + t * 200, now, smooth);
    city.gain.gain.setTargetAtTime(0.05 + (1 - t) * 0.055, now, smooth);
  }

  /* ---------------------------------------------------------
   * 一次性音效：一律用噪声塑造，不用音调
   * ------------------------------------------------------- */
  function burst(opts) {
    if (!on || !ctx) return;
    var now = ctx.currentTime + (opts.delay || 0);

    var src = ctx.createBufferSource();
    src.buffer = getWhite();

    var f = ctx.createBiquadFilter();
    f.type = opts.type || 'bandpass';
    f.frequency.setValueAtTime(opts.freq || 900, now);
    f.Q.value = opts.q == null ? 1.0 : opts.q;

    var g = ctx.createGain();
    var peak = opts.gain == null ? 0.05 : opts.gain;
    var dur = opts.dur || 0.2;

    g.gain.setValueAtTime(0.0001, now);
    g.gain.linearRampToValueAtTime(peak, now + (opts.attack || 0.014));
    g.gain.exponentialRampToValueAtTime(0.0001, now + dur);

    if (opts.sweep) f.frequency.exponentialRampToValueAtTime(opts.sweep, now + dur);

    src.connect(f);
    f.connect(g);
    g.connect(master);
    src.start(now, Math.random() * 2);
    src.stop(now + dur + 0.05);
  }

  /** 人群散开：一团很轻的中频沙沙 */
  function crowd() {
    burst({ freq: 1100, sweep: 780, q: 0.5, dur: 0.3, gain: 0.05, attack: 0.05 });
  }

  /** 翻纸袋：干脆的纸声 */
  function paper() {
    burst({ freq: 2600, sweep: 1700, q: 0.5, dur: 0.12, gain: 0.075, attack: 0.006 });
    burst({ freq: 1900, sweep: 1300, q: 0.5, dur: 0.09, gain: 0.05, attack: 0.006, delay: 0.07 });
  }

  /** 座位点亮：一声几乎听不见的轻响 */
  function seat() {
    burst({ freq: 3600, sweep: 3000, q: 2.4, dur: 0.055, gain: 0.022, attack: 0.004 });
  }

  /** 推门：一口气从闷到开 */
  function door() {
    burst({ type: 'lowpass', freq: 320, sweep: 110, q: 0.8, dur: 0.55, gain: 0.075, attack: 0.09 });
  }

  /** 计算器按键：短促的咔哒 */
  function key() {
    burst({ freq: 2100, sweep: 900, q: 1.8, dur: 0.045, gain: 0.085, attack: 0.003 });
    burst({ type: 'highpass', freq: 5000, q: 0.6, dur: 0.028, gain: 0.04, attack: 0.002, delay: 0.015 });
  }

  /** 换幕：一声很淡的过场呼吸 */
  function sceneShift() {
    burst({ type: 'lowpass', freq: 900, sweep: 320, q: 0.6, dur: 0.75, gain: 0.028, attack: 0.16 });
  }

  /* ---------------------------------------------------------
   * 开关
   * ------------------------------------------------------- */
  function open() {
    if (on) return true;
    ctx = API && API.getContext ? API.getContext() : null;
    if (!ctx) return false;

    if (!master) {
      master = ctx.createGain();
      master.gain.value = 0.0001;
      master.connect(ctx.destination);
    }

    build();

    var now = ctx.currentTime;
    master.gain.cancelScheduledValues(now);
    master.gain.setValueAtTime(0.0001, now);
    /* 别太响：这是一层环境，不是配乐 */
    master.gain.linearRampToValueAtTime(0.22, now + 3);

    on = true;
    setSun(cur.sun);
    /* 起始音量先归零，让 setSun 之后的淡入自然些 */
    if (wind) {
      wind.gain.gain.setValueAtTime(0.0001, now);
      leaves.gain.gain.setValueAtTime(0.0001, now);
      city.gain.gain.setValueAtTime(0.0001, now);
      setSun(cur.sun);
    }
    return true;
  }

  function close() {
    if (!on || !ctx) { on = false; return; }
    var now = ctx.currentTime;
    try {
      master.gain.cancelScheduledValues(now);
      master.gain.setValueAtTime(Math.max(0.0001, master.gain.value), now);
      master.gain.linearRampToValueAtTime(0.0001, now + 1.1);
    } catch (e) { /* noop */ }

    var w = wind, l = leaves, c = city;
    wind = leaves = city = null;
    on = false;

    setTimeout(function () {
      try { if (w) { w.src.stop(); w.lfo.stop(); } } catch (e) { /* noop */ }
      try { if (l) { l.src.stop(); l.lfo.stop(); } } catch (e) { /* noop */ }
      try { if (c) { c.src.stop(); } } catch (e) { /* noop */ }
    }, 1400);
  }

  function toggle() {
    if (on) { close(); return false; }
    return open();
  }

  function isOn() { return on; }

  /** 调试用：读回当前参数，验证「光—声」真的联动了 */
  function probe() {
    if (!on || !ctx || !wind || !leaves || !city) return null;
    return {
      sun: Number(cur.sun.toFixed(3)),
      windCutoff: Math.round(wind.filter.frequency.value),
      windGain: Number(wind.gain.gain.value.toFixed(4)),
      leavesGain: Number(leaves.gain.gain.value.toFixed(4)),
      cityCutoff: Math.round(city.filter.frequency.value),
      cityGain: Number(city.gain.gain.value.toFixed(4))
    };
  }

  global.EPF = global.EPF || {};
  global.EPF.scene = {
    open: open,
    close: close,
    toggle: toggle,
    isOn: isOn,
    setSun: setSun,
    crowd: crowd,
    paper: paper,
    seat: seat,
    door: door,
    key: key,
    sceneShift: sceneShift,
    __probe: probe
  };
})(window);

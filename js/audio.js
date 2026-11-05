/* ============================================================
 * audio.js — 背景音乐
 * -----------------------------------------------------------
 * 第一版难听的原因：
 *   ✗ 音符从五声音阶里随机乱跳，没有和声进行 → 不成调
 *   ✗ 纯 sine + sine×2 叠一起 → 电子琴味
 *   ✗ 混响 3.4s 太长，叠起来糊
 *
 * 这一版：固定和声进行 C → Am → F → G 循环，
 *   每个和弦 4 拍，音符只从当前和弦的音里走（相邻级进，不跳），
 *   音色用 1/2/3 次谐波 + 快速起音 + 长衰减 + 跟随的低通包络，
 *   低频跟和弦根音走长音。
 *
 * 两条轨道：
 *   1) synth  现场合成（默认，零版权零文件）
 *   2) files  读 audio/tracks.js 登记的本地 mp3
 * ============================================================ */
(function (global) {
  'use strict';

  var ctx = null;
  var master = null;
  var wet = null;
  var dry = null;
  var padNodes = [];
  var noiseNode = null;

  var state = {
    on: false,
    mode: 'synth',
    volume: 0.55,
    trackIndex: 0,
    ready: false
  };

  var synthTimer = null;
  var audioEl = null;
  var fadeTimer = null;
  var tracks = [];
  var listeners = [];

  /* ---------------------------------------------------------
   * 音名 → 频率
   * ------------------------------------------------------- */
  var SEMI = { C: 0, 'C#': 1, D: 2, 'D#': 3, E: 4, F: 5, 'F#': 6, G: 7, 'G#': 8, A: 9, 'A#': 10, B: 11 };

  function freqOf(name) {
    var m = String(name).match(/^([A-G]#?)(-?\d)$/);
    if (!m) return 261.63;
    var n = SEMI[m[1]] + (Number(m[2]) + 1) * 12;
    return 440 * Math.pow(2, (n - 69) / 12);
  }

  /* ---------------------------------------------------------
   * 和声进行：C → Am → F → G
   * ------------------------------------------------------- */
  var PROGRESSION = [
    { root: 'C3', notes: ['G3', 'C4', 'E4', 'G4', 'C5', 'E5'] },   /* C   */
    { root: 'A2', notes: ['E3', 'A3', 'C4', 'E4', 'A4', 'C5'] },   /* Am  */
    { root: 'F2', notes: ['C4', 'F4', 'A4', 'C5', 'F5', 'A5'] },   /* F   */
    { root: 'G2', notes: ['D4', 'G4', 'B4', 'D5', 'G5', 'B5'] }    /* G   */
  ];

  var BEATS_PER_CHORD = 4;
  var chordIdx = 0;
  var beatsInChord = 0;
  var lastNoteIdx = 2;

  /* ---------------------------------------------------------
   * 混响脉冲
   * ------------------------------------------------------- */
  function makeImpulse(seconds, decay) {
    var rate = ctx.sampleRate;
    var len = Math.floor(rate * seconds);
    var buf = ctx.createBuffer(2, len, rate);
    for (var ch = 0; ch < 2; ch++) {
      var d = buf.getChannelData(ch);
      for (var i = 0; i < len; i++) {
        d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
      }
    }
    return buf;
  }

  /** 粉噪声，给"远处广播"当底子 */
  function makePink(len) {
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

  /* ---------------------------------------------------------
   * 建图
   * ------------------------------------------------------- */
  function ensureContext() {
    if (ctx) return true;
    var AC = global.AudioContext || global.webkitAudioContext;
    if (!AC) return false;

    try {
      ctx = new AC();
    } catch (e) {
      return false;
    }

    master = ctx.createGain();
    master.gain.value = 0;

    dry = ctx.createGain();
    dry.gain.value = 0.72;

    wet = ctx.createGain();
    wet.gain.value = 0.62;

    var conv = ctx.createConvolver();
    conv.buffer = makeImpulse(2.6, 3.1);

    dry.connect(master);
    wet.connect(conv);
    conv.connect(master);
    master.connect(ctx.destination);

    state.ready = true;
    return true;
  }

  /* ---------------------------------------------------------
   * 单个音：1/2/3 次谐波 + 快速起音 + 长衰减 + 低通包络
   * ------------------------------------------------------- */
  function pluck(nameOrFreq, when, level) {
    if (!ctx) return;
    var f = (typeof nameOrFreq === 'number') ? nameOrFreq : freqOf(nameOrFreq);
    var t = when || ctx.currentTime;
    level = level == null ? 0.115 : level;

    var g = ctx.createGain();
    var lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(3200, t);
    lp.frequency.exponentialRampToValueAtTime(950, t + 1.6);
    lp.Q.value = 0.35;

    /* 1 : 0.20 : 0.06 —— 一点点泛音就够，别堆成电子琴 */
    var parts = [[1, 1], [2, 0.20], [3, 0.06]];
    for (var i = 0; i < parts.length; i++) {
      var o = ctx.createOscillator();
      o.type = 'sine';
      o.frequency.value = f * parts[i][0];
      /* 极轻微失谐，去掉那种"音准完美"的塑料感 */
      o.detune.value = (Math.random() - 0.5) * 5;

      var hg = ctx.createGain();
      hg.gain.value = parts[i][1];
      o.connect(hg);
      hg.connect(g);
      o.start(t);
      o.stop(t + 3.2);
    }

    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(level, t + 0.009);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 3.0);

    g.connect(lp);
    lp.connect(dry);
    lp.connect(wet);
  }

  /* ---------------------------------------------------------
   * 低音长音：跟和弦根音
   * ------------------------------------------------------- */
  function droneTo(chord) {
    if (!ctx || !chord) return;

    var now = ctx.currentTime;

    padNodes.forEach(function (p) {
      try {
        p.gain.gain.cancelScheduledValues(now);
        p.gain.gain.setValueAtTime(Math.max(0.0001, p.gain.gain.value), now);
        p.gain.gain.linearRampToValueAtTime(0.0001, now + 1.3);
        var o = p.osc;
        setTimeout(function () { try { o.stop(); } catch (e) { /* noop */ } }, 1600);
      } catch (e) { /* noop */ }
    });
    padNodes = [];

    var f = freqOf(chord.root);

    var o1 = ctx.createOscillator();
    o1.type = 'sine';
    o1.frequency.value = f;

    var o2 = ctx.createOscillator();
    o2.type = 'sine';
    o2.frequency.value = f * 2;
    o2.detune.value = -4;

    var g2 = ctx.createGain();
    g2.gain.value = 0.28;

    var lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 460;
    lp.Q.value = 0.6;

    var g = ctx.createGain();
    g.gain.value = 0.0001;

    o1.connect(lp);
    o2.connect(g2);
    g2.connect(lp);
    lp.connect(g);
    g.connect(wet);
    g.connect(dry);

    o1.start();
    o2.start();
    g.gain.linearRampToValueAtTime(0.032, now + 1.8);

    padNodes.push({ osc: o1, gain: g });
    padNodes.push({ osc: o2, gain: g });
  }

  function stopPad() {
    var now = ctx ? ctx.currentTime : 0;
    padNodes.forEach(function (p) {
      try {
        p.gain.gain.cancelScheduledValues(now);
        p.gain.gain.linearRampToValueAtTime(0.0001, now + 1.2);
        var o = p.osc;
        setTimeout(function () { try { o.stop(); } catch (e) { /* noop */ } }, 1500);
      } catch (e) { /* noop */ }
    });
    padNodes = [];
  }

  /* ---------------------------------------------------------
   * 远处广播底噪：粉噪声 + 低通，别做窄带
   * ------------------------------------------------------- */
  function startNoise() {
    if (!ctx || noiseNode) return;

    var src = ctx.createBufferSource();
    src.buffer = makePink(Math.floor(ctx.sampleRate * 4));
    src.loop = true;

    var lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 780;
    lp.Q.value = 0.4;

    var g = ctx.createGain();
    g.gain.value = 0.0001;

    src.connect(lp);
    lp.connect(g);
    g.connect(wet);
    src.start();

    g.gain.linearRampToValueAtTime(0.014, ctx.currentTime + 4);

    noiseNode = { src: src, gain: g };
  }

  function stopNoise() {
    if (!noiseNode || !ctx) return;
    var n = noiseNode;
    noiseNode = null;
    try {
      n.gain.gain.cancelScheduledValues(ctx.currentTime);
      n.gain.gain.linearRampToValueAtTime(0.0001, ctx.currentTime + 1.2);
      setTimeout(function () { try { n.src.stop(); } catch (e) { /* noop */ } }, 1500);
    } catch (e) { /* noop */ }
  }

  /* ---------------------------------------------------------
   * 旋律：在和弦内做相邻级进，不乱跳
   * ------------------------------------------------------- */
  function stepIndex(notes, from) {
    var step = [-2, -1, -1, 0, 1, 1, 2][Math.floor(Math.random() * 7)];
    var i = from + step;
    if (i < 0) i = 0;
    if (i > notes.length - 1) i = notes.length - 1;
    return i;
  }

  function schedulePhrase() {
    if (!state.on || state.mode !== 'synth' || !ctx) return;

    var chord = PROGRESSION[chordIdx];
    var now = ctx.currentTime;

    lastNoteIdx = stepIndex(chord.notes, lastNoteIdx);
    pluck(chord.notes[lastNoteIdx], now, 0.10 + Math.random() * 0.035);

    /* 偶尔补一个上方的音，像左手搭了一下 */
    if (Math.random() < 0.34) {
      var up = Math.min(chord.notes.length - 1, lastNoteIdx + 2);
      pluck(chord.notes[up], now + 0.30 + Math.random() * 0.18, 0.052);
    }

    beatsInChord++;
    if (beatsInChord >= BEATS_PER_CHORD) {
      beatsInChord = 0;
      chordIdx = (chordIdx + 1) % PROGRESSION.length;
      droneTo(PROGRESSION[chordIdx]);
    }

    var gap = 1500 + Math.random() * 1500;
    synthTimer = setTimeout(schedulePhrase, gap);
  }

  /* ---------------------------------------------------------
   * 文件播放
   * ------------------------------------------------------- */
  function loadTracks() {
    tracks = (global.EPF_AUDIO_TRACKS || []).filter(function (t) {
      return t && t.src;
    });
    return tracks;
  }

  function playTrackFile() {
    if (!tracks.length) return false;
    if (!audioEl) {
      audioEl = new Audio();
      audioEl.preload = 'none';
      audioEl.loop = false;
      audioEl.addEventListener('ended', function () {
        if (audioEl.loop) return;
        state.trackIndex = (state.trackIndex + 1) % tracks.length;
        playTrackFile();
      });
      audioEl.addEventListener('error', function () {
        console.warn('[audio] 这首放不了，跳到下一首');
        state.trackIndex = (state.trackIndex + 1) % tracks.length;
        playTrackFile();
      });
    }
    var t = tracks[state.trackIndex % tracks.length];
    /* 单曲 / 标了 loop 的曲子直接无缝循环，不用等 ended */
    audioEl.loop = !!t.loop || tracks.length === 1;
    audioEl.src = t.src;
    audioEl.volume = state.volume;
    var pr = audioEl.play();
    if (pr && pr.catch) pr.catch(function () { /* 被自动播放策略拦了，忽略 */ });
    fadeInElement();
    notify();
    return true;
  }

  /** 淡入，别让音乐一上来就怼耳朵 */
  function fadeInElement() {
    if (!audioEl) return;
    if (fadeTimer) clearInterval(fadeTimer);
    var target = state.volume;
    var t0 = Date.now();
    audioEl.volume = 0;
    fadeTimer = setInterval(function () {
      if (!audioEl || !state.on) { clearInterval(fadeTimer); fadeTimer = null; return; }
      var k = Math.min(1, (Date.now() - t0) / 1800);
      audioEl.volume = Math.max(0, Math.min(1, target * k));
      if (k >= 1) { clearInterval(fadeTimer); fadeTimer = null; }
    }, 90);
  }

  function stopTrackFile() {
    if (fadeTimer) { clearInterval(fadeTimer); fadeTimer = null; }
    if (audioEl) {
      try { audioEl.pause(); } catch (e) { /* noop */ }
    }
  }

  /* ---------------------------------------------------------
   * 对外
   * ------------------------------------------------------- */
  function notify() {
    listeners.forEach(function (fn) {
      try { fn(state); } catch (e) { /* noop */ }
    });
  }

  function fadeTo(v, seconds) {
    if (!master || !ctx) return;
    var t = ctx.currentTime;
    master.gain.cancelScheduledValues(t);
    master.gain.setValueAtTime(Math.max(0.0001, master.gain.value), t);
    master.gain.linearRampToValueAtTime(v, t + (seconds || 1.6));
  }

  function play() {
    if (state.on) return;
    loadTracks();

    var useFile = tracks.length > 0;
    state.mode = useFile ? 'files' : 'synth';

    if (useFile) {
      state.on = true;
      playTrackFile();
      notify();
      return;
    }

    if (!ensureContext()) {
      console.warn('[audio] 这个浏览器不支持 Web Audio');
      return;
    }
    if (ctx.state === 'suspended') {
      try { ctx.resume(); } catch (e) { /* noop */ }
    }

    state.on = true;
    chordIdx = 0;
    beatsInChord = 0;
    lastNoteIdx = 2;

    fadeTo(0.34, 3);
    droneTo(PROGRESSION[0]);
    startNoise();
    clearTimeout(synthTimer);
    synthTimer = setTimeout(schedulePhrase, 900);
    notify();
  }

  function pause() {
    if (!state.on) return;
    state.on = false;

    if (state.mode === 'files') {
      stopTrackFile();
    } else {
      fadeTo(0, 1.2);
      stopPad();
      stopNoise();
      clearTimeout(synthTimer);
      synthTimer = null;
    }
    notify();
  }

  function toggle() {
    if (state.on) pause(); else play();
    return state.on;
  }

  function setVolume(v) {
    state.volume = Math.max(0, Math.min(1, v));
    if (audioEl) audioEl.volume = state.volume;
    notify();
  }

  function next() {
    if (!tracks.length) return;
    state.trackIndex = (state.trackIndex + 1) % tracks.length;
    if (state.on && state.mode === 'files') playTrackFile();
  }

  function onChange(fn) { listeners.push(fn); }

  /** 文件模式下暴露 <audio> 元素（调试 / 自检用） */
  function element() { return audioEl; }

  /** 供其它模块共用同一个 AudioContext（序章音景用） */
  function getContext() {
    if (!ensureContext()) return null;
    if (ctx.state === 'suspended') {
      try { ctx.resume(); } catch (e) { /* noop */ }
    }
    return ctx;
  }

  function info() {
    return {
      on: state.on,
      mode: state.mode,
      volume: state.volume,
      trackCount: tracks.length,
      currentTitle: (tracks.length && state.mode === 'files')
        ? (tracks[state.trackIndex % tracks.length] || {}).title || ''
        : '',
      chord: state.mode === 'synth' ? PROGRESSION[chordIdx].root : ''
    };
  }

  global.EPF = global.EPF || {};
  global.EPF.audio = {
    play: play,
    pause: pause,
    toggle: toggle,
    next: next,
    setVolume: setVolume,
    onChange: onChange,
    element: element,
    getContext: getContext,
    info: info,
    state: state
  };
})(window);

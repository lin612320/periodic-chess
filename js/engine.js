/* ============================================================
 * engine.js — 规则引擎（纯逻辑，不碰 DOM）
 * -----------------------------------------------------------
 * 设计要点：
 *  1. 所有随机数由「计算器 RAN」模拟，保留 3 位小数，
 *     这样 LCD 上显示的算式与判定结果永远自洽、可验算。
 *  2. 引擎产出「事件流」，UI 按事件逐帧播放；
 *     联机时主机把同一条事件流广播给客户端回放 → 天然防不同步。
 *  3. 掷骰/移动/落点结算分离，便于动画穿插。
 * ============================================================ */
(function (global) {
  'use strict';

  var D = global.EPF.data;
  var BY_Z = D.BY_Z;
  var BY_POS = D.BY_POS;
  var SPECIALS = D.SPECIALS;
  var MAX_Z = D.MAX_Z;
  var SLOT_LN = D.SLOT_LN;
  var SLOT_AN = D.SLOT_AN;
  var SLOT_P_LN = D.SLOT_P_LN;
  var SLOT_P_AN = D.SLOT_P_AN;
  var MAIN_TRACK = D.MAIN_TRACK;
  var MAIN_INDEX = D.MAIN_INDEX;
  var slotZ = D.slotZ;
  var WRAP_TO = 87;          // 溢出后回到第 7 周期第 1 格 Fr
  var DUEL_THRESHOLD = 0.9;  // 决斗命中线
  var MAX_CHAIN_AGAIN = 8;   // 连续「多摇一次」保护

  /* ---------------------------------------------------------
   * 1. 随机数：模拟科学计算器 RAN
   * ------------------------------------------------------- */

  /** mulberry32：确定性 PRNG，方便调试与联机复现 */
  function makeRng(seed) {
    var s = (seed >>> 0) || 0x9e3779b9;
    return function () {
      s = (s + 0x6d2b79f5) >>> 0;
      var t = s;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  /** 计算器风格的 RAN：0.000 ~ 0.999，三位小数 */
  function ran(rng) {
    var v = Math.round(rng() * 1000) / 1000;
    if (v >= 1) v = 0.999;
    return v;
  }

  /** 四舍五入到整数（计算器的 Rnd） */
  function rnd(x) {
    return Math.floor(x + 0.5);
  }

  /** 6 × RAN + 0.5 → 1~6 */
  function rollDie(rng) {
    var r = ran(rng);
    var raw = 6 * r + 0.5;
    var value = rnd(raw);
    if (value < 1) value = 1;
    if (value > 6) value = 6;
    return { ran: r, raw: raw, value: value, expr: '6×RAN+0.5' };
  }

  /** 118 × RAN + 0.5 → 1~118（龙卷风） */
  function rollTornado(rng) {
    var r = ran(rng);
    var raw = 118 * r + 0.5;
    var value = rnd(raw);
    if (value < 1) value = 1;
    if (value > MAX_Z) value = MAX_Z;
    return { ran: r, raw: raw, value: value, expr: '118×RAN+0.5' };
  }

  /* ---------------------------------------------------------
   * 2. 轨道推进（镧系/锕系：踩到占位格才进）
   * -----------------------------------------------------------
   * 位置用 slotId（见 data.js）：
   *   1..56 / 72..88 / 104..118  主表
   *   1001 / 1002                两个占位格（入口标记，棋子不会停在这）
   *   2000..2014 / 3000..3014    镧系 / 锕系内部
   *
   * 走到主表的占位格 → 直接转入对应的系，剩余步数继续在系里走；
   * 系内走到最后一格 → 自动出到主表 72 / 104；
   * 主表 118 之后 → 回到 87。
   * ------------------------------------------------------- */

  function inLN(id) { return id >= SLOT_LN && id <= SLOT_LN + 14; }
  function inAN(id) { return id >= SLOT_AN && id <= SLOT_AN + 14; }

  /** 元素序号 → slotId（57~71 / 89~103 一定属于两个系） */
  function toSlot(z) {
    if (z >= 57 && z <= 71) return SLOT_LN + (z - 57);
    if (z >= 89 && z <= 103) return SLOT_AN + (z - 89);
    return z;
  }

  /** 走一步 */
  function nextSlot(id) {
    /* 系内 */
    if (inLN(id)) return id < SLOT_LN + 14 ? id + 1 : 72;    // Lu 之后出到 Hf
    if (inAN(id)) return id < SLOT_AN + 14 ? id + 1 : 104;   // Lr 之后出到 Rf

    /* 主表 */
    var i = MAIN_INDEX[id];
    if (i === undefined) return WRAP_TO;
    if (i >= MAIN_TRACK.length - 1) return WRAP_TO;          // 118 之后回 Fr(87)

    var nxt = MAIN_TRACK[i + 1];
    if (nxt === SLOT_P_LN) return SLOT_LN;                   // 踩到镧系占位 → 进 La
    if (nxt === SLOT_P_AN) return SLOT_AN;                   // 踩到锕系占位 → 进 Ac
    return nxt;
  }

  /** 从 from 走 steps 步，返回逐格路径 */
  function stepPath(from, steps) {
    var path = [];
    var cur = from;
    for (var i = 0; i < steps; i++) {
      cur = nextSlot(cur);
      path.push(cur);
    }
    return path;
  }

  /** 只算落点 */
  function advance(from, steps) {
    var cur = from;
    for (var i = 0; i < steps; i++) cur = nextSlot(cur);
    return cur;
  }

  /** 这一步是不是跨行/跨系了（给动画用） */
  function isHop(from, to) {
    var a = D.slotPos(from);
    var b = D.slotPos(to);
    if (!a || !b) return true;
    if (a.row !== b.row) return true;
    return Math.abs(a.col - b.col) > 1;
  }

  /**
   * 行程进度（给「谁领先」用）：主表按轨道序号 ×100，
   * 系内算成「刚过入口」，保证比较结果和实际路程一致。
   */
  function progress(pos) {
    if (inLN(pos)) return MAIN_INDEX[SLOT_P_LN] * 100 + 50 + (pos - SLOT_LN);
    if (inAN(pos)) return MAIN_INDEX[SLOT_P_AN] * 100 + 50 + (pos - SLOT_AN);
    var i = MAIN_INDEX[pos];
    return (i === undefined ? 0 : i) * 100;
  }

  /* ---------------------------------------------------------
   * 3. 方向格：周期表坐标位移
   * ------------------------------------------------------- */

  /** 取同一行的元素，按列排序 —— 用于左右移动 */
  var rowCache = Object.create(null);
  function rowList(row) {
    if (rowCache[row]) return rowCache[row];
    var arr = D.ELEMENTS.filter(function (e) { return e.row === row; });
    arr.sort(function (a, b) { return a.col - b.col; });
    rowCache[row] = arr;
    return arr;
  }

  function clamp(v, lo, hi) {
    return v < lo ? lo : (v > hi ? hi : v);
  }

  /**
   * 方向格结算。
   * up/down：同族 ±1 周期，只在主表 row 1~7 内有效，找不到则原地不动。
   *           f 区（row 8/9）没有上下；主表第 7 周期下方是空，不是镧系/锕系行。
   * left/right：同周期内按元素序列左右 k 格，出界 clamp 到两端。
   */
  function applyArrow(z, dir, k, rng) {
    var el = BY_Z[z];
    if (!el) return { from: z, to: z, moved: false, reason: 'element-missing' };

    if (dir === 'up' || dir === 'down') {
      if (el.isFBlock) return { from: z, to: z, moved: false, reason: 'f-block-no-vertical' };
      var targetRow = el.row + (dir === 'up' ? -1 : 1);
      // 只在主表 7 个周期内上下，绝不跨进 f 区的排版行
      if (targetRow < 1 || targetRow > 7) {
        return { from: z, to: z, moved: false, reason: 'no-element-above-below' };
      }
      var hit = BY_POS['r' + targetRow + 'c' + el.col];
      if (!hit) return { from: z, to: z, moved: false, reason: 'no-element-above-below' };
      return { from: z, to: hit.z, moved: true, reason: dir };
    }

    // left / right
    var list = rowList(el.row);
    var idx = -1;
    for (var i = 0; i < list.length; i++) {
      if (list[i].z === z) { idx = i; break; }
    }
    if (idx < 0) return { from: z, to: z, moved: false, reason: 'row-index-missing' };

    var dd = (k == null) ? (3 + Math.floor(rng() * 3)) : k; // 3~5
    var next = clamp(idx + (dir === 'left' ? -dd : dd), 0, list.length - 1);
    return { from: z, to: list[next].z, moved: next !== idx, distance: dd, reason: dir };
  }

  /* ---------------------------------------------------------
   * 4. 游戏状态
   * ------------------------------------------------------- */

  var PLAYER_COLORS = ['#e0567f', '#3fb6a8', '#e0913f', '#7a8ce8'];
  var PLAYER_NAMES = ['你', '小满', '阿申', '老周'];

  function createGame(opts) {
    opts = opts || {};
    var count = clamp(opts.count || 2, 2, 4);
    var bots = opts.bots || [];
    var seed = opts.seed != null ? opts.seed : ((Date.now() ^ (Math.random() * 0xffffffff)) >>> 0);

    var players = [];
    for (var i = 0; i < count; i++) {
      var isBot = bots.indexOf(i) >= 0;
      players.push({
        id: i,
        name: (opts.names && opts.names[i]) || (isBot ? PLAYER_NAMES[i % 4] : PLAYER_NAMES[i % 4]),
        isBot: isBot,
        pos: 1,
        color: PLAYER_COLORS[i],
        sleeping: false,
        finished: false
      });
    }

    return {
      players: players,
      turn: 0,
      phase: 'ready',        // ready | await-roll | moving | await-duel | over
      winner: null,
      seed: seed,
      rng: makeRng(seed),
      againChain: 0,
      round: 1,
      log: []
    };
  }

  function currentPlayer(state) {
    return state.players[state.turn];
  }

  /** 下一位还在场的玩家；绕回 0 号时轮次 +1 */
  function nextTurn(state) {
    var n = state.players.length;
    var old = state.turn;
    for (var i = 1; i <= n; i++) {
      var idx = (old + i) % n;
      if (!state.players[idx].finished) {
        state.turn = idx;
        if (idx <= old) state.round++;
        return state.players[idx];
      }
    }
    return currentPlayer(state);
  }

  /* ---------------------------------------------------------
   * 5. 回合流程（产出事件流）
   * ------------------------------------------------------- */

  /**
   * 回合开始：处理「睡觉」。
   * 返回 { skipped:boolean, events:[] }
   */
  function beginTurn(state) {
    var p = currentPlayer(state);
    var events = [];
    state.againChain = 0;
    state.phase = 'await-roll';

    if (p.sleeping) {
      p.sleeping = false;
      events.push({ type: 'wake', player: p.id, text: p.name + ' 睡醒了一觉' });
      events.push({ type: 'skip', player: p.id, text: p.name + ' 本回合停一手' });
      state.phase = 'ready';
      return { skipped: true, events: events };
    }
    return { skipped: false, events: events };
  }

  /**
   * 掷骰 + 移动 + 落点结算（不含决斗的选目标环节）。
   * 返回 { die, events, needsDuel }
   */
  function rollAndMove(state) {
    var p = currentPlayer(state);
    var events = [];

    var die = rollDie(state.rng);
    events.push({
      type: 'roll',
      player: p.id,
      ran: die.ran,
      raw: die.raw,
      value: die.value,
      expr: die.expr
    });

    var from = p.pos;
    var path = stepPath(from, die.value);
    p.pos = path.length ? path[path.length - 1] : from;

    /* 这一步是不是踩进了镧系/锕系，单独发个事件给 UI 播动画 */
    var entered = null;
    var prevSlot = from;
    for (var k = 0; k < path.length; k++) {
      if (D.slotZone(path[k]) && !D.slotZone(prevSlot)) {
        entered = D.slotZone(path[k]);
        break;
      }
      prevSlot = path[k];
    }

    events.push({
      type: 'move',
      player: p.id,
      from: from,
      to: p.pos,
      path: path,
      hops: path.map(function (z, i) {
        var prev = i === 0 ? from : path[i - 1];
        return isHop(prev, z);
      }),
      entered: entered
    });

    if (entered) {
      events.push({
        type: 'enter-zone',
        player: p.id,
        zone: entered,
        slot: p.pos,
        text: p.name + ' 踩到了' + (entered === 'ln' ? '镧系' : '锕系') + '入口'
      });
    }

    // 恰好停在 118 → 胜利
    if (p.pos === MAX_Z) {
      p.finished = true;
      state.winner = p;
      state.phase = 'over';
      events.push({ type: 'win', player: p.id, text: p.name + ' 恰好落在 118 号 Og，赢了' });
      return { die: die, events: events, needsDuel: false };
    }

    var res = resolveLanding(state, p, events);
    res.die = die;
    return res;
  }

  /**
   * 落点结算。位移类（方向格、龙卷风）不二次触发特殊格。
   */
  function resolveLanding(state, p, events) {
    var zHere = slotZ(p.pos);
    var spec = SPECIALS[zHere];
    events.push({ type: 'land', player: p.id, z: p.pos, zEl: zHere, special: spec ? spec.type : null });

    if (!spec) {
      state.phase = 'ready';
      return { die: null, events: events, needsDuel: false };
    }

    var meta = D.SPECIAL_META[spec.type];
    events.push({
      type: 'special',
      player: p.id,
      z: p.pos,
      zEl: zHere,
      special: spec.type,
      text: meta.glyph + ' ' + meta.label
    });

    switch (spec.type) {
      case 'sleep':
        p.sleeping = true;
        events.push({ type: 'sleep', player: p.id, text: p.name + ' 趴下睡了一回合' });
        state.phase = 'ready';
        return { die: null, events: events, needsDuel: false };

      case 'again':
        state.againChain++;
        if (state.againChain >= MAX_CHAIN_AGAIN) {
          events.push({ type: 'again-stop', player: p.id, text: '连摇次数到顶，本回合收手' });
          state.phase = 'ready';
          return { die: null, events: events, needsDuel: false };
        }
        events.push({ type: 'again', player: p.id, text: p.name + ' 再摇一次' });
        state.phase = 'await-roll';
        return { die: null, events: events, needsDuel: false, again: true };

      case 'tornado': {
        var t = rollTornado(state.rng);
        var tfrom = p.pos;
        /* 随机到 57~71 / 89~103 就是直接卷进对应的系 */
        p.pos = toSlot(t.value);
        events.push({
          type: 'tornado',
          player: p.id,
          ran: t.ran,
          raw: t.raw,
          value: t.value,
          expr: t.expr,
          from: tfrom,
          to: p.pos
        });
        if (p.pos === MAX_Z) {
          p.finished = true;
          state.winner = p;
          state.phase = 'over';
          events.push({ type: 'win', player: p.id, text: p.name + ' 被龙卷风直接送到 118 号 Og' });
          return { die: null, events: events, needsDuel: false };
        }
        state.phase = 'ready';
        return { die: null, events: events, needsDuel: false };
      }

      case 'up':
      case 'down':
      case 'left':
      case 'right': {
        /* 方向格按周期表坐标走，算完再换回 slotId */
        var r = applyArrow(zHere, spec.type, null, state.rng);
        if (r.moved) {
          var afrom = p.pos;
          p.pos = toSlot(r.to);
          events.push({
            type: 'arrow',
            player: p.id,
            dir: r.reason,
            distance: r.distance || 1,
            from: afrom,
            to: p.pos
          });
          // 位移恰好踩中终点同样算赢
          if (p.pos === MAX_Z) {
            p.finished = true;
            state.winner = p;
            state.phase = 'over';
            events.push({ type: 'win', player: p.id, text: p.name + ' 被箭头推到 118 号 Og' });
            return { die: null, events: events, needsDuel: false };
          }
        } else {
          events.push({
            type: 'arrow-blocked',
            player: p.id,
            dir: r.reason,
            z: p.pos,
            text: meta.glyph + ' 前头没路，原地不动'
          });
        }
        state.phase = 'ready';
        return { die: null, events: events, needsDuel: false };
      }

      case 'duel': {
        var rivals = state.players.filter(function (q) {
          return q.id !== p.id && !q.finished;
        });
        if (!rivals.length) {
          events.push({ type: 'duel-skip', player: p.id, text: '没有对手，决斗作废' });
          state.phase = 'ready';
          return { die: null, events: events, needsDuel: false };
        }
        state.phase = 'await-duel';
        return {
          die: null,
          events: events,
          needsDuel: true,
          candidates: rivals.map(function (q) { return q.id; })
        };
      }

      default:
        state.phase = 'ready';
        return { die: null, events: events, needsDuel: false };
    }
  }

  /** 方向格位移的视觉路径（只做高亮，不逐格） */
  function stepPathSimple(from, to) {
    return [from, to];
  }

  /**
   * 决斗：双方轮流按 RAN，先出 ≥0.9 者胜，败者停一回合。
   * 踩中格子的玩家先按（挑战者优势）。
   */
  function resolveDuel(state, challengerId, targetId) {
    var a = state.players[challengerId];
    var b = state.players[targetId];
    var events = [];
    var rollSeq = [];
    var winner = null;
    var loser = null;
    var guard = 0;

    while (!winner && guard < 200) {
      guard++;
      var ra = ran(state.rng);
      rollSeq.push({ player: a.id, ran: ra, hit: ra >= DUEL_THRESHOLD });
      if (ra >= DUEL_THRESHOLD) { winner = a; loser = b; break; }

      var rb = ran(state.rng);
      rollSeq.push({ player: b.id, ran: rb, hit: rb >= DUEL_THRESHOLD });
      if (rb >= DUEL_THRESHOLD) { winner = b; loser = a; break; }
    }

    if (!winner) { winner = a; loser = b; }

    loser.sleeping = true;
    state.phase = 'ready';

    events.push({
      type: 'duel',
      challenger: a.id,
      target: b.id,
      rolls: rollSeq,
      winner: winner.id,
      loser: loser.id,
      threshold: DUEL_THRESHOLD,
      text: winner.name + ' 决斗获胜，' + loser.name + ' 停一回合'
    });

    return { events: events, winner: winner.id, loser: loser.id };
  }

  /** 回合收尾：切换玩家 */
  function endTurn(state) {
    if (state.phase === 'over') return [];
    state.phase = 'ready';
    var p = nextTurn(state);
    return [{ type: 'turn', player: p.id, text: '轮到 ' + p.name }];
  }

  /* ---------------------------------------------------------
   * 6. 人机决策
   * ------------------------------------------------------- */

  /** 决斗选谁：优先领先者 */
  function botPickDuelTarget(state, challengerId) {
    var rivals = state.players.filter(function (q) {
      return q.id !== challengerId && !q.finished;
    });
    if (!rivals.length) return null;
    rivals.sort(function (a, b) {
      var d = progress(b.pos) - progress(a.pos);
      if (d !== 0) return d;
      return a.id - b.id;
    });
    return rivals[0].id;
  }

  /* ---------------------------------------------------------
   * 7. 导出
   * ------------------------------------------------------- */
  global.EPF = global.EPF || {};
  global.EPF.engine = {
    // 随机
    makeRng: makeRng,
    ran: ran,
    rnd: rnd,
    rollDie: rollDie,
    rollTornado: rollTornado,
    // 轨道
    stepPath: stepPath,
    advance: advance,
    nextSlot: nextSlot,
    isHop: isHop,
    progress: progress,
    toSlot: toSlot,
    // 方向格
    applyArrow: applyArrow,
    rowList: rowList,
    // 状态
    createGame: createGame,
    currentPlayer: currentPlayer,
    nextTurn: nextTurn,
    // 流程
    beginTurn: beginTurn,
    rollAndMove: rollAndMove,
    resolveLanding: resolveLanding,
    resolveDuel: resolveDuel,
    endTurn: endTurn,
    // 人机
    botPickDuelTarget: botPickDuelTarget,
    // 常量
    WRAP_TO: WRAP_TO,
    DUEL_THRESHOLD: DUEL_THRESHOLD,
    PLAYER_COLORS: PLAYER_COLORS,
    PLAYER_NAMES: PLAYER_NAMES
  };
})(window);

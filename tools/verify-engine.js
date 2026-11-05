/* 引擎自检：node tools/verify-engine.js */
global.window = global;
require('../js/data.js');
require('../js/engine.js');

var D = global.EPF.data;
var E = global.EPF.engine;
var fail = [];

function ok(cond, label, extra) {
  if (!cond) fail.push(label + (extra ? ' → ' + extra : ''));
}
function eq(a, b, label) {
  ok(a === b, label, '期望 ' + b + '，实际 ' + a);
}

/* ---------- 1. RAN 与掷骰 ---------- */
eq(E.ran(function () { return 0; }), 0, 'RAN 下限');
eq(E.ran(function () { return 0.9999; }), 0.999, 'RAN 上限夹到 0.999');
eq(E.ran(function () { return 0.12345; }), 0.123, 'RAN 保留三位小数');

eq(E.rollDie(function () { return 0; }).value, 1, 'RAN=0 → 点数 1');
eq(E.rollDie(function () { return 0.9999; }).value, 6, 'RAN=0.999 → 点数 6');

/* 分布：100 万次，各面频率应接近 1/6 */
var rng = E.makeRng(20240501);
var dist = [0, 0, 0, 0, 0, 0, 0];
for (var i = 0; i < 1000000; i++) dist[E.rollDie(rng).value]++;
console.log('点数分布      :', dist.slice(1).map(function (n) { return (n / 10000).toFixed(2) + '%'; }).join('  '));
dist.slice(1).forEach(function (n, k) {
  var p = n / 1000000;
  ok(Math.abs(p - 1 / 6) < 0.003, '点数 ' + (k + 1) + ' 分布偏离', p.toFixed(4));
});

/* 龙卷风分布边界 */
eq(E.rollTornado(function () { return 0; }).value, 1, '龙卷风下限 1');
eq(E.rollTornado(function () { return 0.9999; }).value, 118, '龙卷风上限 118');
var rng2 = E.makeRng(777);
var tmin = 999, tmax = 0;
for (var j = 0; j < 200000; j++) {
  var tv = E.rollTornado(rng2).value;
  if (tv < tmin) tmin = tv;
  if (tv > tmax) tmax = tv;
}
ok(tmin >= 1 && tmax <= 118, '龙卷风越界', tmin + '~' + tmax);
console.log('龙卷风区间    :', tmin + ' ~ ' + tmax);

/* ---------- 2. 轨道推进：主表 + 镧系/锕系 ---------- */
eq(E.advance(1, 6), 7, '开局走 6 步');
eq(E.advance(115, 3), 118, '恰好到终点');
eq(E.advance(117, 1), 118, '117 走 1 到终点');
eq(E.advance(118, 1), 87, '越过终点回到第 7 周期第 1 格');
eq(E.advance(115, 5), 88, '越过后继续沿主轨走');

/* 进度单调：主轨一路向前，不会倒退 */
var prevP = -1, monotone = true;
var curSlot = 1;
for (var mi = 0; mi < 40; mi++) {
  var pv = E.progress(curSlot);
  if (pv < prevP) monotone = false;
  prevP = pv;
  curSlot = E.nextSlot(curSlot);
}
ok(monotone, '主轨进度单调递增');
ok(E.progress(D.SLOT_LN) > E.progress(56) && E.progress(D.SLOT_LN) < E.progress(72), '镧系排在 Ba 与 Hf 之间');
ok(E.progress(D.SLOT_AN) > E.progress(88) && E.progress(D.SLOT_AN) < E.progress(104), '锕系排在 Ra 与 Rf 之间');

/* 镧系：踩到 (6,3) 占位格才进 */
eq(E.advance(56, 1), D.SLOT_LN, 'Ba 下一步踩镧系入口 → La');
eq(E.advance(56, 2), D.SLOT_LN + 1, '进镧系后接着往里走');
eq(E.advance(56, 15), D.SLOT_LN + 14, '一路走到 Lu');
eq(E.advance(56, 16), 72, 'Lu 之后出到 Hf');

/* 锕系：踩到 (7,3) 占位格才进 */
eq(E.advance(88, 1), D.SLOT_AN, 'Ra 下一步踩锕系入口 → Ac');
eq(E.advance(88, 15), D.SLOT_AN + 14, '一路走到 Lr');
eq(E.advance(88, 16), 104, 'Lr 之后出到 Rf');

/* 系内路径连续，且不会回主表 */
var wantLn = [];
for (var q1 = 0; q1 < 6; q1++) wantLn.push(D.SLOT_LN + q1);
eq(E.stepPath(56, 6).join(','), wantLn.join(','), '进镧系逐格路径');

/* 路径长度必须等于步数 */
for (var s = 1; s <= 6; s++) {
  eq(E.stepPath(110, s).length, s, '路径长度 = 步数 (' + s + ')');
}
eq(E.stepPath(115, 5).join(','), '116,117,118,87,88', '回绕路径');

/* ---------- 3. 方向格 ---------- */
function arrowCase(z, dir, expectTo, label, k) {
  var r = E.applyArrow(z, dir, k, E.makeRng(1));
  eq(r.to, expectTo, label);
}
arrowCase(20, 'down', 38, 'Ca 向下 → Sr');
arrowCase(1, 'down', 3, 'H 向下 → Li');
arrowCase(2, 'down', 10, 'He 向下 → Ne');
arrowCase(20, 'up', 12, 'Ca 向上 → Mg');
arrowCase(12, 'up', 4, 'Mg 向上 → Be');
arrowCase(30, 'up', 30, 'Zn 上方是空位 → 原地');
arrowCase(13, 'down', 31, 'Al 向下 → Ga');
arrowCase(56, 'down', 88, 'Ba 向下 → Ra');
arrowCase(118, 'up', 86, 'Og 向上 → Rn');
arrowCase(104, 'down', 104, 'Rf 在第7周期下方无元素 → 原地');
arrowCase(88, 'down', 88, 'Ra 已在第7周期 → 原地');
arrowCase(57, 'up', 57, 'La 在 f 区无上下');
arrowCase(89, 'down', 89, 'Ac 在 f 区无上下');

/* 左右：沿同行元素序列 */
var rLeft = E.applyArrow(30, 'left', 5, E.makeRng(1));
eq(rLeft.to, D.BY_POS['r4c7'].z, 'Zn(30) 左移 5 → 第4周期第7格 Mn');
var rRight = E.applyArrow(20, 'right', 5, E.makeRng(1));
eq(rRight.to, D.BY_POS['r4c7'].z, 'Ca(20) 右移 5 → Mn');
var rClamp = E.applyArrow(3, 'left', 5, E.makeRng(1));
eq(rClamp.to, 3, 'Li 左移出界 → 原地');
var rHeLeft = E.applyArrow(2, 'left', 5, E.makeRng(1));
eq(rHeLeft.to, 1, 'He 左移 → H');
/* 镧系内部左右 */
var rLa = E.applyArrow(57, 'right', 4, E.makeRng(1));
eq(rLa.to, 61, 'La 右移 4 → Pm');

/* 随机距离落在 3~5 */
var rng3 = E.makeRng(9);
for (var q = 0; q < 300; q++) {
  var rr = E.applyArrow(50, 'right', null, rng3);
  ok(rr.distance >= 3 && rr.distance <= 5, '左右随机距离越界', rr.distance);
}

/* ---------- 4. 整局模拟 ---------- */
function playOne(seed) {
  var st = E.createGame({ count: 4, bots: [0, 1, 2, 3], seed: seed });
  var guard = 0;
  while (st.phase !== 'over' && guard < 50000) {
    guard++;
    var bt = E.beginTurn(st);
    if (bt.skipped) { E.endTurn(st); continue; }

    var r = E.rollAndMove(st);
    var chain = 0;
    while (r.again && chain++ < 20 && st.phase !== 'over') r = E.rollAndMove(st);

    if (r.needsDuel && st.phase !== 'over') {
      var target = E.botPickDuelTarget(st, st.turn);
      if (target != null) E.resolveDuel(st, st.turn, target);
    }
    if (st.phase === 'over') break;

    st.players.forEach(function (pp) {
      if (D.isPlaceholder(pp.pos)) fail.push('棋子停在了占位格 seed=' + seed + ' pos=' + pp.pos);
      if (!(D.slotZ(pp.pos) >= 1 && D.slotZ(pp.pos) <= 118)) fail.push('位置越界 seed=' + seed + ' pos=' + pp.pos);
    });
    E.endTurn(st);
  }
  return { st: st, guard: guard };
}

var rounds = [];
var wins = 0;
for (var seed = 1; seed <= 300; seed++) {
  var out = playOne(seed);
  if (out.st.phase === 'over' && out.st.winner && out.st.winner.pos === 118) {
    wins++;
    rounds.push(out.guard);
  } else {
    fail.push('seed ' + seed + ' 未正常结束，guard=' + out.guard + ' phase=' + out.st.phase);
  }
}
rounds.sort(function (a, b) { return a - b; });
console.log('对局完成      :', wins + ' / 300');
console.log('回合数中位数  :', rounds[Math.floor(rounds.length / 2)]);
console.log('回合数区间    :', rounds[0] + ' ~ ' + rounds[rounds.length - 1]);

/* ---------- 5. 结算函数返回值完整性 ---------- */
var st2 = E.createGame({ count: 2, bots: [1], seed: 42 });
E.beginTurn(st2);
var rr2 = E.rollAndMove(st2);
ok(rr2.die && typeof rr2.die.value === 'number', 'rollAndMove 返回 die');
ok(Array.isArray(rr2.events) && rr2.events.length > 0, 'rollAndMove 返回事件流');
ok(rr2.events[0].type === 'roll', '首事件是 roll');
ok(rr2.events[1].type === 'move', '次事件是 move');

console.log('');
if (fail.length) {
  console.log('❌ 失败 ' + fail.length + ' 项：');
  fail.slice(0, 40).forEach(function (f) { console.log('  -', f); });
  process.exit(1);
} else {
  console.log('✅ 引擎自检全部通过');
}

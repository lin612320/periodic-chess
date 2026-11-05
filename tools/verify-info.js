/* 元素知识层自检：node tools/verify-info.js */
global.window = global;
require('../js/data.js');
require('../js/element-info.js');

var D = global.EPF.data;
var I = global.EPF.info;
var fail = [];

function ok(c, label, extra) { if (!c) fail.push(label + (extra ? ' → ' + extra : '')); }

/* 1. 每个元素都有卡片 */
for (var z = 1; z <= 118; z++) {
  var info = I.get(z);
  if (!info) { fail.push('缺少 ' + z); continue; }
  if (!(info.mass > 0)) fail.push(z + ' 原子量异常');
  if (!info.config) fail.push(z + ' 无电子排布');
  if (!info.facts || !info.facts.length) fail.push(z + ' 无考点');
}

/* 2. 电子层电子数之和必须等于原子序数 */
for (var z2 = 1; z2 <= 118; z2++) {
  var inf = I.get(z2);
  if (!inf) continue;
  var sum = inf.shells.reduce(function (a, b) { return a + b; }, 0);
  if (sum !== z2) fail.push(z2 + ' ' + inf.sym + ' 电子层求和 ' + sum + ' ≠ ' + z2 + ' [' + inf.config + ']');
}

/* 3. 能级排布的总电子数也应为 z */
function unsup(s) {
  var d = '';
  for (var i = 0; i < s.length; i++) {
    var v = '⁰¹²³⁴⁵⁶⁷⁸⁹'.indexOf(s.charAt(i));
    d += (v >= 0 ? v : '');
  }
  return d === '' ? 0 : Number(d);
}
for (var z3 = 1; z3 <= 118; z3++) {
  var c = I.configOf(z3);
  var parts = c.split(' ');
  var tot = 0;
  for (var i = 0; i < parts.length; i++) {
    var m = parts[i].match(/([⁰¹²³⁴⁵⁶⁷⁸⁹]+)$/);
    if (!m) continue;
    tot += unsup(m[1]);
  }
  if (tot !== z3) fail.push(z3 + ' 能级电子总数 ' + tot + ' ≠ ' + z3 + ' [' + c + ']');
}

/* 4. 抽查几个关键值 */
var checks = [
  [1, '氢'], [6, '碳'], [8, '氧'], [11, '钠'], [13, '铝'], [17, '氯'],
  [26, '铁'], [29, '铜'], [47, '银'], [79, '金'], [118, '鿫']
];
checks.forEach(function (p) {
  var x = I.get(p[0]);
  if (!x) { fail.push('抽查缺失 ' + p[0]); return; }
  if (x.name !== p[1]) fail.push(p[0] + ' 名字应为 ' + p[1] + '，实际 ' + x.name);
});

/* 5. 例外排布 */
ok(I.get(24).config.indexOf('3d⁵ 4s¹') > 0, 'Cr 应为 3d⁵ 4s¹', I.get(24).config);
ok(I.get(29).config.indexOf('3d¹⁰ 4s¹') > 0, 'Cu 应为 3d¹⁰ 4s¹', I.get(29).config);
ok(I.get(46).config.indexOf('4d¹⁰') > 0 && I.get(46).config.indexOf('5s') < 0, 'Pd 无 5s 电子', I.get(46).config);

/* 6. 周期 / 族 */
ok(I.get(1).period === 1, 'H 周期 1');
ok(I.get(87).period === 7, 'Fr 周期 7');
ok(I.get(57).period === 6, 'La 属第 6 周期', String(I.get(57).period));
ok(I.get(89).period === 7, 'Ac 属第 7 周期', String(I.get(89).period));

/* 7. 铁的最外层 */
ok(I.get(26).outer === 2, 'Fe 最外层 2', String(I.get(26).outer));
ok(I.get(17).outer === 7, 'Cl 最外层 7', String(I.get(17).outer));
ok(I.get(11).outer === 1, 'Na 最外层 1', String(I.get(11).outer));

/* 输出抽样 */
console.log('抽样：');
[1, 6, 11, 13, 17, 24, 26, 29, 46, 79, 118].forEach(function (z) {
  var x = I.get(z);
  console.log('  ' + String(z).padStart(3) + ' ' + x.sym.padEnd(3) + x.name +
    '  质量 ' + String(x.mass).padEnd(7) +
    ' 电子层 ' + x.shells.join(',') +
    '  最外层 ' + x.outer +
    '  ' + x.config);
});

var noFact = Object.keys(I.all).filter(function (k) {
  return I.all[k].facts.length === 1 && I.all[k].facts[0].indexOf('暂无') === 0;
}).length;
console.log('\n有专属考点的元素：' + (118 - noFact) + ' / 118');

console.log('');
if (fail.length) {
  console.log('❌ 失败 ' + fail.length + ' 项：');
  fail.slice(0, 20).forEach(function (f) { console.log('  -', f); });
  process.exit(1);
} else {
  console.log('✅ 元素知识层自检全部通过');
}

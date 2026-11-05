/* 数据层自检：node tools/verify-data.js */
global.window = global;
require('../js/data.js');

var D = global.EPF.data;
var E = D.ELEMENTS;
var problems = [];

/* 1. 数量与连续性 */
if (E.length !== 118) problems.push('元素数量不是 118，实际 ' + E.length);
for (var z = 1; z <= 118; z++) {
  if (!D.BY_Z[z]) problems.push('缺少元素 ' + z);
  else if (D.BY_Z[z].z !== z) problems.push('序号错乱 ' + z);
}

/* 2. 坐标唯一性 */
var posSeen = Object.create(null);
E.forEach(function (el) {
  if (posSeen[el.key]) problems.push('坐标重复 ' + el.key + ' → ' + el.z + ' / ' + posSeen[el.key]);
  posSeen[el.key] = el.z;
});

/* 3. 每行元素数 */
var rowCount = Object.create(null);
E.forEach(function (el) { rowCount[el.row] = (rowCount[el.row] || 0) + 1; });
var expect = { 1: 2, 2: 8, 3: 8, 4: 18, 5: 18, 6: 17, 7: 17, 8: 15, 9: 15 };
Object.keys(expect).forEach(function (r) {
  if (rowCount[r] !== expect[r]) {
    problems.push('第 ' + r + ' 行元素数 ' + (rowCount[r] || 0) + '，期望 ' + expect[r]);
  }
});

/* 4. 列不越界 */
E.forEach(function (el) {
  if (el.col < 1 || el.col > 18) problems.push('列越界 ' + el.z);
  if (el.row < 1 || el.row > 9) problems.push('行越界 ' + el.z);
});

/* 5. 特殊格 */
var sCount = 0, sSeen = Object.create(null);
Object.keys(D.SPECIALS).forEach(function (k) {
  var z = Number(k); sCount++;
  if (!(z >= 1 && z <= 118)) problems.push('特殊格越界 ' + z);
  if (sSeen[z]) problems.push('特殊格重复 ' + z);
  sSeen[z] = 1;
  if (z === 1 || z === 118) problems.push('特殊格占了起终点 ' + z);
  if (z === 57 || z === 89) problems.push('特殊格占了进系点 ' + z);
  if (!D.SPECIAL_META[D.SPECIALS[k].type]) problems.push('未知特殊格类型 ' + D.SPECIALS[k].type);
});

/* 6. 轨道与位置编码 */
var mainSlots = D.MAIN_TRACK.length;
if (mainSlots !== 90) problems.push('主轨槽位数应为 90，实际 ' + mainSlots);
if (D.MAIN_TRACK[0] !== 1) problems.push('主轨起点不是 1');
if (D.MAIN_TRACK[mainSlots - 1] !== 118) problems.push('主轨终点不是 118');
if (D.LN_TRACK.length !== 15) problems.push('镧系轨道应为 15 格');
if (D.AN_TRACK.length !== 15) problems.push('锕系轨道应为 15 格');
if (D.MAIN_TRACK.indexOf(D.SLOT_P_LN) < 0) problems.push('主轨缺镧系入口格');
if (D.MAIN_TRACK.indexOf(D.SLOT_P_AN) < 0) problems.push('主轨缺锕系入口格');

/* 每个元素都能映射到唯一 slotId，且与轨道表一致 */
var slotSeen = Object.create(null);
E.forEach(function (el) {
  var slot = el.z >= 57 && el.z <= 71 ? D.SLOT_LN + (el.z - 57)
    : el.z >= 89 && el.z <= 103 ? D.SLOT_AN + (el.z - 89)
      : el.z;
  if (slotSeen[slot]) problems.push('slotId 重复 ' + slot);
  slotSeen[slot] = 1;
  if (D.slotZ(slot) !== el.z) problems.push('slotZ 反查失败 ' + el.z);
  var p = D.slotPos(slot);
  if (!p || !(p.row >= 1 && p.row <= 9) || !(p.col >= 1 && p.col <= 18)) problems.push('slotPos 越界 ' + el.z);
});

/* 主表不包含 57~71 / 89~103，系内轨道不包含主表序号
 * （两个入口格 slotZ 会指到 57/89，属于设计，跳过） */
D.MAIN_TRACK.forEach(function (slot) {
  if (D.isPlaceholder(slot)) return;
  var z = D.slotZ(slot);
  if (z >= 57 && z <= 71) problems.push('主轨混进了镧系元素 ' + z);
  if (z >= 89 && z <= 103) problems.push('主轨混进了锕系元素 ' + z);
});
D.LN_TRACK.concat(D.AN_TRACK).forEach(function (slot) {
  if (!D.slotZone(slot)) problems.push('系内轨道缺区标记 ' + slot);
});

/* 7. 中文名字段可用（非空且不是纯符号） */
E.forEach(function (el) {
  if (!el.name || !el.sym) problems.push('元素字段缺失 ' + el.z);
});

console.log('元素数        :', E.length);
console.log('坐标数        :', Object.keys(D.BY_POS).length);
console.log('特殊格数      :', sCount);
console.log('特殊格占比    :', (sCount / 118 * 100).toFixed(1) + '%');
console.log('主轨槽位数    :', mainSlots, '（含 2 个进系入口）');
console.log('每行元素数    :', JSON.stringify(rowCount));
console.log('主题          :', D.THEMES.map(function (t) { return t.id; }).join(', '));
console.log('');
if (problems.length) {
  console.log('❌ 问题 ' + problems.length + ' 处：');
  problems.forEach(function (p) { console.log('  -', p); });
  process.exit(1);
} else {
  console.log('✅ 数据层自检全部通过');
}

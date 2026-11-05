/* ============================================================
 * audio-test.js — 背景音乐开关链路
 *   node tools/audio-test.js
 * ============================================================ */
'use strict';

const { connect, sleep } = require('./lib-cdp');

const APP = 'http://127.0.0.1:18080/';

async function main() {
  const { send, evaluate, shot, installErrorTrap, errs } = await connect();

  await send('Runtime.enable');
  await send('Page.enable');
  await installErrorTrap();
  await send('Emulation.setDeviceMetricsOverride', {
    width: 1440, height: 900, deviceScaleFactor: 1, mobile: false
  });

  await send('Page.navigate', { url: APP });
  await sleep(2400);

  const out = [];
  const bad = [];
  const step = (k, v) => { const s = k + '：' + JSON.stringify(v); out.push(s); console.log(s); };
  const val = (r) => (r && typeof r === 'object' && 'value' in r ? r.value : r);

  await evaluate('(()=>{const b=document.getElementById("prologueSkip");if(b)b.click();return true;})()');
  await sleep(600);

  step('音频模块存在', await evaluate('typeof window.EPF.audio === "object"'));
  step('曲目登记表', await evaluate('Array.isArray(window.EPF_AUDIO_TRACKS)'));
  step('初始状态', await evaluate('window.EPF.audio.info()'));
  step('开场按钮初始', await evaluate(
    '({pressed:document.getElementById("btnSound").getAttribute("aria-pressed"),' +
    'label:document.querySelector("#btnSound .snd-label").textContent})'
  ));

  /* 打开 */
  await evaluate('document.getElementById("btnSound").click()');
  await sleep(2200);
  const onInfo = val(await evaluate('window.EPF.audio.info()'));
  step('开启后', onInfo);
  if (onInfo.mode !== 'files') bad.push('没有走文件播放，mode=' + onInfo.mode);
  if (!onInfo.currentTitle) bad.push('曲目名为空');

  const el = val(await evaluate(
    '(()=>{const e=window.EPF.audio.element();if(!e)return null;' +
    'return {readyState:e.readyState,loop:e.loop,paused:e.paused,' +
    'duration:Math.round(e.duration*10)/10,currentTime:Math.round(e.currentTime*10)/10,' +
    'src:e.src.split("/").pop()};})()'
  ));
  step('音频元素', el);
  if (!el) bad.push('<audio> 元素没有创建');
  else {
    if (el.paused) bad.push('音频没有真正播放');
    if (!el.loop) bad.push('单曲没有循环');
    if (!(el.duration > 60)) bad.push('时长异常：' + el.duration);
    if (!(el.readyState >= 3)) bad.push('音频没缓冲好 readyState=' + el.readyState);
  }

  step('按钮已按下', await evaluate(
    'document.getElementById("btnSound").getAttribute("aria-pressed")'
  ));
  step('AudioContext 状态', await evaluate(
    '(()=>{try{const A=window.AudioContext||window.webkitAudioContext;return "ctor-ok:"+typeof A;}catch(e){return String(e);}})()'
  ));
  await shot('50-audio-on.png');

  /* 关掉 */
  await evaluate('document.getElementById("btnSound").click()');
  await sleep(900);
  step('关闭后', await evaluate('window.EPF.audio.info()'));
  const offPaused = val(await evaluate(
    '(()=>{const e=window.EPF.audio.element();return e?e.paused:null;})()'
  ));
  step('关闭后已暂停', offPaused);
  if (offPaused !== true) bad.push('关掉后音频还在播');

  /* 开局后再开一次，确认游戏内那个按钮也通 */
  await evaluate('document.querySelector("[data-count=\'2\']").click()');
  await sleep(200);
  await evaluate('document.getElementById("btnStart").click()');
  await sleep(2400);

  step('游戏内按钮存在', await evaluate('!!document.getElementById("btnSound2")'));
  await evaluate('document.getElementById("btnSound2").click()');
  await sleep(900);
  step('游戏内开启后', await evaluate('window.EPF.audio.info()'));
  step('游戏内按钮按下', await evaluate(
    'document.getElementById("btnSound2").getAttribute("aria-pressed")'
  ));
  await shot('51-audio-in-game.png');

  console.log(out.join('\n'));

  const e = await errs();
  if (e.length) {
    console.log('\n❌ 页面错误 ' + e.length + ' 条：');
    e.slice(0, 10).forEach((x) => console.log('  -', String(x).split('\n')[0].slice(0, 180)));
  }
  if (bad.length) {
    console.log('\n❌ 音乐链路问题 ' + bad.length + ' 条：');
    bad.forEach((x) => console.log('  -', x));
  }
  if (!e.length && !bad.length) console.log('\n✅ 背景音乐链路正常');
  process.exit(e.length || bad.length ? 1 : 0);
}

main().catch((e) => { console.error('脚本失败：', e); process.exit(2); });

/* 快速截一张联机面板的图 */
'use strict';
const fs = require('fs');
const path = require('path');
const { connect, sleep } = require('./lib-cdp');

const APP = process.env.EPF_APP || 'https://lin612320.github.io/periodic-chess/';
const SHOT = path.join(__dirname, 'shots');

(async () => {
  const P = await connect();
  await P.send('Runtime.enable');
  await P.send('Page.enable');
  await P.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
  await P.send('Page.navigate', { url: APP });
  await sleep(3500);

  await P.evaluate('(()=>{const b=document.getElementById("prologueSkip");if(b)b.click();return true;})()');
  await sleep(1200);

  await P.evaluate('document.getElementById("btnLan").click()');
  await sleep(800);
  let r = await P.send('Page.captureScreenshot', { format: 'png' });
  fs.mkdirSync(SHOT, { recursive: true });
  fs.writeFileSync(path.join(SHOT, '120-lan-entry.png'), Buffer.from(r.result.data, 'base64'));
  console.log('120-lan-entry.png');

  await P.evaluate('document.getElementById("lanName").value = "小林"');
  await P.evaluate('document.querySelector(\'.lan-choice[data-act="host"]\').click()');
  for (let i = 0; i < 25; i++) {
    await sleep(1000);
    const v = (await P.evaluate('(document.getElementById("lanRoomCode")||{}).textContent || ""')).value;
    if (/^\d{6}$/.test(v.trim())) break;
  }
  await sleep(800);
  r = await P.send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(path.join(SHOT, '121-lan-roomcode.png'), Buffer.from(r.result.data, 'base64'));
  console.log('121-lan-roomcode.png');
  console.log('房间码: ' + (await P.evaluate('(document.getElementById("lanRoomCode")||{}).textContent')).value);
  process.exit(0);
})().catch((e) => { console.error(e.message); process.exit(1); });

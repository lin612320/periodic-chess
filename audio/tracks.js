/* ============================================================
 * tracks.js — 背景音乐登记表
 * -----------------------------------------------------------
 * 用法：把音频放进 audio/ 目录，然后在下面数组里加一行。
 *
 *   window.EPF_AUDIO_TRACKS = [
 *     { title: 'Your Smile', src: 'audio/your-smile.mp3' },
 *     { title: 'Dream Catcher', src: 'audio/dream-catcher.mp3' }
 *   ];
 *
 * 说明：
 *  · 面板里只要这个数组非空，就优先放这里的歌；为空则退回内置的
 *    合成钢琴氛围音（零版权、不需要任何文件）。
 *  · 只有一首时单曲循环，多首时顺序播放循环。
 *  · 用 <audio> 直接播，file:// 双击打开也能响。
 *  · ⚠️ 录音版权归唱片/演奏者所有，请只在你自己拥有或已获授权的
 *    场合使用；对外分发前请换成授权音源。
 * ============================================================ */

window.EPF_AUDIO_TRACKS = [
  {
    /* 班得瑞（Bandari）演奏版 · 安妮之歌（Annie's Song） */
    title: '安妮之歌',
    subtitle: "Annie's Song · Bandari",
    src: 'audio/annie-song.flac',
    loop: true
  }
];

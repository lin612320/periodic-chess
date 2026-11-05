/* ============================================================
 * turn-config.js — TURN 中继服务器配置
 * -----------------------------------------------------------
 * 为什么需要它：
 *   STUN 只能告诉双方"你在公网上的地址是什么"，打洞还得靠两边自己。
 *   如果有一方在对称 NAT / 严格防火墙后面（公司网、校园网、部分运营商），
 *   打洞会失败，这时必须用 TURN 服务器把数据转一手。
 *
 * ⚠️ 公开免费的 TURN 已经全部下线了（实测 openrelay / freestun /
 *    expressturn 都拿不到 relay candidate）。TURN 是台要跑的服务器，
 *    要么用别人的免费额度，要么自己搭 coturn。
 *
 * 怎么填（Metered 免费额度每月 50 GB）：
 *   1. https://www.metered.ca/tools/openrelay/ 注册（免费）
 *   2. 控制台里拿到 TURN 的 username 和 credential，以及服务器域名
 *   3. 把下面数组的注释去掉，填上自己的值
 *
 *   填好之后：IceServers = TURN + STUN，连通率基本就是"只要两边能上网就连得上"。
 *   不填的时候：只用 STUN，同 WiFi 必定能连，跨网络大约 80~90% 能连。
 * ============================================================ */

window.EPF_TURN = [
  /* 例子（把 XXX 换成你的）：

  {
    urls: [
      'turn:standard.relay.metered.ca:80',
      'turn:standard.relay.metered.ca:443',
      'turn:standard.relay.metered.ca:443?transport=tcp'
    ],
    username: 'XXX',
    credential: 'XXX'
  }

  */
];

/* 自建 coturn 的话长这样：
window.EPF_TURN = [
  {
    urls: ['turn:你的服务器:3478', 'turn:你的服务器:3478?transport=tcp'],
    username: 'user',
    credential: 'pass'
  }
];
*/

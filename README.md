# Cloudflare Pages 部署产物（由 tools/make-deploy.ps1 生成，勿手改）

只包含运行所需的静态文件：

- `index.html`
- `styles/*.css`
- `js/*.js`
- `audio/tracks.js`（曲目登记表；同名 mp3 若存在也会一并带上）

不含：`server.js`、`tools/`、`*.md`、`启动联机.bat`。

## 注意：这个站点**没有联机功能**

Cloudflare Pages 只托管静态文件，跑不了 `server.js` 里的 WebSocket 中转。所以部署到 Pages 之后：

| 功能 | Pages 上 |
|---|---|
| 单机 / 人机 / 序章 / 知识卡 / 音乐 | ✅ 全部可用 |
| 局域网联机 | ❌ 不可用（需要另起 WebSocket 服务） |

想在公网联机，两条路：
1. 把 `server.js` 跑在任意一台能开端口的机器上（含本机），前端通过它的地址访问
2. 把中转改用 Cloudflare Durable Objects 重写（工作量不小）

## 重新发布

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File ..\tools\make-deploy.ps1
cd ..
wrangler pages deploy deploy --project-name=<你的项目名> --commit-dirty=true
```

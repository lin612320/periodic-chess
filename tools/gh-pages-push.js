/* ============================================================
 * gh-pages-push.js — 走 GitHub API 推送静态站（不依赖 git push）
 * -----------------------------------------------------------
 * 为什么不用 git push：这台机器连不上 github.com:443，
 * 但 api.github.com 是通的，所以改走 Git Data API。
 *
 *   node tools/gh-pages-push.js
 * ============================================================ */
'use strict';

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const OWNER = 'lin612320';
const REPO = 'periodic-chess';
const DIR = path.join(process.env.TEMP, 'epf-gh-pages');

let TOKEN = '';
try {
  TOKEN = execSync('gh auth token', { encoding: 'utf8' }).trim();
} catch (e) {
  console.error('拿不到 gh token');
  process.exit(1);
}

async function api(pathname, opts) {
  opts = opts || {};
  const res = await fetch('https://api.github.com' + pathname, {
    method: opts.method || 'GET',
    headers: {
      Authorization: 'Bearer ' + TOKEN,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'epf-deploy',
      'Content-Type': 'application/json'
    },
    body: opts.body ? JSON.stringify(opts.body) : undefined
  });
  const text = await res.text();
  if (!res.ok) {
    const err = new Error(res.status + ' ' + pathname + ' → ' + text.slice(0, 400));
    err.status = res.status;
    throw err;
  }
  return text ? JSON.parse(text) : {};
}

function collect(dir, base, out) {
  for (const name of fs.readdirSync(dir)) {
    if (name === '.git') continue;
    const full = path.join(dir, name);
    const rel = base ? base + '/' + name : name;
    if (fs.statSync(full).isDirectory()) collect(full, rel, out);
    else out.push({ rel, full });
  }
}

(async () => {
  console.log('仓库: ' + OWNER + '/' + REPO);

  /* 1. 现有 main 的 head（空仓库则为 null） */
  let parentSha = null;
  try {
    const ref = await api(`/repos/${OWNER}/${REPO}/git/ref/heads/main`);
    parentSha = ref.object.sha;
    console.log('已存在 main: ' + parentSha.slice(0, 8));
  } catch (e) {
    if (e.status === 404 || e.status === 409) {
      console.log('main 还不存在（首次推送）—— 先用 Contents API 把仓库点着');
      /* 空仓库不允许直接建 blob/tree，必须先有一个 commit */
      await api(`/repos/${OWNER}/${REPO}/contents/robots.txt`, {
        method: 'PUT',
        body: {
          message: 'chore: bootstrap',
          content: Buffer.from('User-agent: *\nAllow: /\n').toString('base64')
        }
      });
      const ref = await api(`/repos/${OWNER}/${REPO}/git/ref/heads/main`);
      parentSha = ref.object.sha;
      console.log('初始 commit: ' + parentSha.slice(0, 8));
    } else {
      throw e;
    }
  }

  /* 2. 逐个文件建 blob */
  const files = [];
  collect(DIR, '', files);
  console.log('文件数: ' + files.length);

  const tree = [];
  for (const f of files) {
    const content = fs.readFileSync(f.full).toString('base64');
    const blob = await api(`/repos/${OWNER}/${REPO}/git/blobs`, {
      method: 'POST',
      body: { content, encoding: 'base64' }
    });
    tree.push({ path: f.rel, mode: '100644', type: 'blob', sha: blob.sha });
    process.stdout.write('.');
  }
  console.log('');

  /* 3. tree */
  const newTree = await api(`/repos/${OWNER}/${REPO}/git/trees`, {
    method: 'POST',
    body: { tree }
  });
  console.log('tree: ' + newTree.sha.slice(0, 8));

  /* 4. commit */
  const commitBody = {
    message: '元素周期表飞行棋：静态发布\n\n118 个元素的飞行棋，序章六幕、知识卡、科学计算器演算、局域网联机。',
    tree: newTree.sha,
    parents: parentSha ? [parentSha] : []
  };
  const commit = await api(`/repos/${OWNER}/${REPO}/git/commits`, {
    method: 'POST',
    body: commitBody
  });
  console.log('commit: ' + commit.sha.slice(0, 8));

  /* 5. 更新/创建 main */
  if (parentSha) {
    await api(`/repos/${OWNER}/${REPO}/git/refs/heads/main`, {
      method: 'PATCH',
      body: { sha: commit.sha, force: true }
    });
  } else {
    await api(`/repos/${OWNER}/${REPO}/git/refs`, {
      method: 'POST',
      body: { ref: 'refs/heads/main', sha: commit.sha }
    });
  }
  console.log('✅ main 已更新');

  /* 6. 开启 GitHub Pages */
  let pages = null;
  try {
    pages = await api(`/repos/${OWNER}/${REPO}/pages`);
    console.log('Pages 已存在: ' + pages.html_url);
  } catch (e) {
    if (e.status !== 404) throw e;
  }

  if (!pages) {
    try {
      pages = await api(`/repos/${OWNER}/${REPO}/pages`, {
        method: 'POST',
        body: { source: { branch: 'main', path: '/' } }
      });
      console.log('✅ Pages 已创建');
    } catch (e) {
      // 409 = 已经存在并发创建
      if (e.status === 409) {
        pages = await api(`/repos/${OWNER}/${REPO}/pages`);
      } else throw e;
    }
  }

  console.log('');
  console.log('URL: https://' + OWNER + '.github.io/' + REPO + '/');
  console.log('status: ' + (pages.status || 'building'));
})().catch((e) => {
  console.error('');
  console.error('❌ ' + e.message);
  process.exit(1);
});

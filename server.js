/* The Memory — 本地后台服务器（纯 Node 内置模块，无需 npm install）
 * 启动：node server.js   （默认端口 8787，可用 PORT 环境变量覆盖）
 * 功能：托管站点 + 后台接口（登录 / 读取数据 / 保存数据 / 上传媒体 / 删除媒体）
 * 说明：这是本地原型。上云时把“本地文件存储”换成腾讯云 COS + 云函数即可，后台操作方式不变。
 */
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFile } = require('child_process');

const ROOT = __dirname;                       // site-preview 目录
const DATA_FILE = path.join(ROOT, 'data.json');
const MEDIA_DIR = path.join(ROOT, 'media');
const PORT = process.env.PORT || 8787;

// ---- 云端同步（腾讯云 COS）：本地保存后自动上传/删除云端副本 ----
// 站点现已迁移到 GitHub Pages + jsDelivr，不再依赖 COS 作为线上资源来源；
// 且 COS 账号已欠费（451）。默认关闭云同步，避免上传/保存被卡住。
// 若日后需要，可设 TM_SYNC_CLOUD=1 重新开启。
const PYTHON = process.env.TM_PYTHON || 'C:\\Users\\m1333\\.workbuddy\\binaries\\python\\versions\\3.13.12\\python.exe';
const SYNC_CLOUD = process.env.TM_SYNC_CLOUD === '1';   // 默认关闭，仅显式开启时同步
const TOOLS_DIR = path.join(ROOT, 'tools');
// 本地 ffmpeg（用于上传视频时裁剪/压缩）。放在 tools/ 下，gh_push 不会把它推到仓库。
const FFMPEG = process.env.TM_FFMPEG || path.join(TOOLS_DIR, 'ffmpeg.exe');
const MAX_CLIP = 30; // 单次上传裁剪最长秒数
function syncCloud(script, rel) {
  return new Promise(resolve => {
    if (!SYNC_CLOUD) return resolve({ ok: false, skipped: true });
    const { execFile } = require('child_process');
    execFile(PYTHON, [path.join(TOOLS_DIR, script), rel], { cwd: ROOT, timeout: 300000, maxBuffer: 10 * 1024 * 1024 },
      (err, stdout) => {
        if (err) return resolve({ ok: false, error: String(err.message || err) });
        try { resolve(Object.assign({ ok: true }, JSON.parse(String(stdout).trim().split('\n').pop()))); }
        catch (e) { resolve({ ok: false, error: 'parse fail', raw: String(stdout).slice(0, 200) }); }
      });
  });
}

const ADMIN_PASS = process.env.TM_ADMIN_PASS || 'thememory2026';
const SECRET = crypto.randomBytes(16).toString('hex');
const VALID_TOKEN = crypto.createHash('sha256').update(ADMIN_PASS + ':' + SECRET).digest('hex');

if (ADMIN_PASS === 'thememory2026') {
  console.log('\x1b[33m[警告] 正在使用默认后台密码 thememory2026，请在 server.js 或环境变量 TM_ADMIN_PASS 中修改！\x1b[0m');
}

const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif',
  '.webp': 'image/webp', '.svg': 'image/svg+xml', '.mp4': 'video/mp4', '.webm': 'video/webm',
  '.wav': 'audio/wav', '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg', '.m4a': 'audio/mp4'
};

function sendJSON(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(body);
}
function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    let size = 0, chunks = [];
    req.on('data', c => {
      size += c.length;
      if (size > limit) { reject(new Error('body too large')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}
function authOK(req) {
  return (req.headers['x-admin-token'] || '') === VALID_TOKEN;
}
// 仅允许 media 目录内的相对路径，防穿越
function safeMediaPath(rel) {
  rel = String(rel || '').replace(/\\/g, '/').replace(/^\/+/, '').replace(/^media\//, '');
  const p = path.normalize(path.join(MEDIA_DIR, rel));
  if (p !== MEDIA_DIR && !p.startsWith(MEDIA_DIR + path.sep)) return null;
  return p;
}
function sanitizeName(name) {
  return path.basename(name).replace(/[\/\\]/g, '').replace(/\.\./g, '').replace(/^\.+/, '').slice(0, 120) || ('file_' + Date.now());
}

// ---- 视频裁剪/压缩（ffmpeg）----
// 将任意来源视频转码为网页友好 mp4：H.264+AAC+faststart，自动按旋转方向转正，宽度≤1080，CRF 压缩。
// opts: { start(秒), duration(秒) }；返回转码后的 Buffer。
function transcodeVideo(inputPath, opts) {
  return new Promise((resolve, reject) => {
    if (!fs.existsSync(FFMPEG)) {
      return reject(new Error('ffmpeg 未找到（tools/ffmpeg.exe），无法裁剪/压缩'));
    }
    opts = opts || {};
    const start = Number(opts.start) >= 0 ? Number(opts.start) : 0;
    let dur = Number(opts.duration) > 0 ? Number(opts.duration) : 0;
    if (dur > MAX_CLIP) dur = MAX_CLIP;            // 封顶 30 秒
    // 探测是否有音轨（ffmpeg 7.x 会自动按旋转元数据转正，无需手动 transpose）
    execFile(FFMPEG, ['-hide_banner', '-i', inputPath], { maxBuffer: 10 * 1024 * 1024 }, (e, _out, stderr) => {
      const info = String(stderr || '');
      const hasAudio = /Stream.*Audio:/.test(info);
      const vf = "scale='min(1080,iw)':-2,format=yuv420p";
      const out = inputPath + '.web.mp4';
      const args = ['-y', '-ss', String(start)];
      if (dur > 0) args.push('-t', String(dur));
      args.push('-i', inputPath, '-vf', vf, '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '26', '-pix_fmt', 'yuv420p', '-movflags', '+faststart');
      if (hasAudio) { args.push('-c:a', 'aac', '-b:a', '128k'); }
      else { args.push('-an'); }
      args.push(out);
      execFile(FFMPEG, args, { maxBuffer: 50 * 1024 * 1024 }, (e2, _o2, se2) => {
        if (e2) return reject(new Error('ffmpeg 转码失败：' + String(se2 || e2.message).slice(0, 300)));
        fs.readFile(out, (err, buf) => {
          try { fs.unlinkSync(inputPath); } catch (_) {}
          try { fs.unlinkSync(out); } catch (_) {}
          if (err) return reject(err);
          resolve(buf);
        });
      });
    });
  });
}

function serveStatic(req, res, urlPath) {
  let rel = decodeURIComponent(urlPath.split('?')[0]);
  if (rel === '/' || rel === '') rel = '/index.html';
  const filePath = path.normalize(path.join(ROOT, rel));
  if (!filePath.startsWith(ROOT)) { res.writeHead(403); res.end('forbidden'); return; }
  fs.stat(filePath, (err, st) => {
    if (err || !st.isFile()) {
      // SPA 回退到 index.html
      if (!path.extname(rel)) {
        fs.readFile(path.join(ROOT, 'index.html'), (e2, buf) => {
          if (e2) { res.writeHead(404); res.end('not found'); return; }
          res.writeHead(200, { 'Content-Type': MIME['.html'] }); res.end(buf);
        });
        return;
      }
      res.writeHead(404); res.end('not found'); return;
    }
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    fs.createReadStream(filePath).pipe(res);
  });
}

const server = http.createServer(async (req, res) => {
  const url = req.url;
  const method = req.method;

  try {
    // ---- 登录 ----
    if (url === '/api/login' && method === 'POST') {
      const body = JSON.parse(await readBody(req, 1e6));
      if (body.password === ADMIN_PASS) sendJSON(res, 200, { ok: true, token: VALID_TOKEN });
      else sendJSON(res, 401, { ok: false, error: '密码错误' });
      return;
    }

    // ---- 读取数据（公开）----
    if (url === '/api/data' && method === 'GET') {
      fs.readFile(DATA_FILE, 'utf8', (err, txt) => {
        if (err) { sendJSON(res, 500, { error: 'read fail' }); return; }
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(txt);
      });
      return;
    }

    // ---- 保存数据（需登录）----
    if (url === '/api/data' && method === 'PUT') {
      if (!authOK(req)) { sendJSON(res, 401, { error: 'unauthorized' }); return; }
      const txt = await readBody(req, 20 * 1024 * 1024);
      try {
        JSON.parse(txt); // 校验
        const tmp = DATA_FILE + '.tmp';
        fs.writeFile(tmp, txt, 'utf8', () => {
          fs.rename(tmp, DATA_FILE, async e => {
            if (e) { sendJSON(res, 500, { error: 'save fail' }); return; }
            // 保存后自动把 data.json 同步到云端，线上立刻生效
            const up = await syncCloud('upload_one.py', 'data.json');
            sendJSON(res, 200, { ok: true, cloud: up });
          });
        });
      } catch (e) { sendJSON(res, 400, { error: 'JSON 格式错误' }); }
      return;
    }

    // ---- 通用媒体上传/覆盖（需登录，base64）：支持视频、音乐等大文件 ----
    if (url === '/api/upload-media' && method === 'POST') {
      if (!authOK(req)) { sendJSON(res, 401, { error: 'unauthorized' }); return; }
      const body = JSON.parse(await readBody(req, 500 * 1024 * 1024));
      const b64 = (body.data || '').replace(/^data:.*,/, '');
      let buf;
      try { buf = Buffer.from(b64, 'base64'); } catch (e) { sendJSON(res, 400, { error: 'base64 解码失败' }); return; }
      if (!buf.length) { sendJSON(res, 400, { error: '文件内容为空' }); return; }

      // 上传时裁剪/压缩：有 start / duration / cap30 任一参数即触发 ffmpeg 转码
      const doClip = body.start != null || body.duration != null || body.cap30;
      if (doClip) {
        const tmpIn = path.join(ROOT, '.tm_up_' + Date.now() + '.mp4');
        try { fs.writeFileSync(tmpIn, buf); } catch (e) { sendJSON(res, 500, { error: '临时文件写入失败' }); return; }
        try {
          const dur = (body.cap30 && !body.duration) ? MAX_CLIP : body.duration;
          buf = await transcodeVideo(tmpIn, { start: body.start, duration: dur });
        } catch (e) {
          sendJSON(res, 500, { error: e.message || '转码失败' });
          return;
        }
      }

      let rel = String(body.path || '').replace(/\\/g, '/').replace(/^\/+/, '').replace(/^media\//, '');
      let filename;
      if (rel && body.overwrite) {
        filename = sanitizeName(path.basename(rel));
        let dir = path.dirname(rel).replace(/\\/g, '/');
        rel = (!dir || dir === '.' || dir === '/') ? filename : dir + '/' + filename;
      } else {
        filename = sanitizeName(body.filename || ('media_' + Date.now() + '.mp4'));
        rel = 'videos/' + filename;
      }
      const target = safeMediaPath(rel);
      if (!target) { sendJSON(res, 400, { error: '非法路径' }); return; }

      fs.mkdir(path.dirname(target), { recursive: true }, err => {
        if (err) { sendJSON(res, 500, { error: 'mkdir fail' }); return; }
        fs.writeFile(target, buf, e => {
          if (e) { sendJSON(res, 500, { error: 'write fail' }); return; }
          const retRel = 'media/' + rel.replace(/\\/g, '/');
          // 本地文件写入成功即返回，避免大文件 cloud 同步阻塞响应；
          // 云同步在后台异步进行，失败只落日志，不影响本地上传结果。
          sendJSON(res, 200, { ok: true, path: retRel, size: buf.length, cloud: { pending: true } });
          syncCloud('upload_one.py', retRel).then(function (up) {
            console.log('[cloud sync]', retRel, up);
          }).catch(function (err) {
            console.error('[cloud sync error]', retRel, err);
          });
        });
      });
      return;
    }

    // ---- 上传媒体（需登录，base64）----
    if (url === '/api/upload' && method === 'POST') {
      if (!authOK(req)) { sendJSON(res, 401, { error: 'unauthorized' }); return; }
      const body = JSON.parse(await readBody(req, 200 * 1024 * 1024));
      const albumId = sanitizeName(body.albumId || 'misc');
      const fname = sanitizeName(body.filename || ('file_' + Date.now()));
      const dir = path.join(MEDIA_DIR, 'albums', albumId);
      fs.mkdir(dir, { recursive: true }, err => {
        if (err) { sendJSON(res, 500, { error: 'mkdir fail' }); return; }
        let rel = 'albums/' + albumId + '/' + fname;
        let target = path.join(dir, fname);
        if (fs.existsSync(target)) {
          const dot = fname.lastIndexOf('.');
          const base = dot > 0 ? fname.slice(0, dot) : fname;
          const ext = dot > 0 ? fname.slice(dot) : '';
          rel = 'albums/' + albumId + '/' + base + '_' + Date.now() + ext;
          target = path.join(dir, path.basename(rel));
        }
        const b64 = (body.data || '').replace(/^data:.*,/, '');
        try {
          fs.writeFile(target, Buffer.from(b64, 'base64'), async e => {
            if (e) { sendJSON(res, 500, { error: 'write fail' }); return; }
            const up = await syncCloud('upload_one.py', 'media/' + rel);
            sendJSON(res, 200, { ok: true, path: 'media/' + rel, cloud: up });
          });
        } catch (e2) { sendJSON(res, 500, { error: 'decode fail' }); }
      });
      return;
    }

    // ---- 删除媒体（需登录）----
    if (url === '/api/media' && method === 'DELETE') {
      if (!authOK(req)) { sendJSON(res, 401, { error: 'unauthorized' }); return; }
      const body = JSON.parse(await readBody(req, 1e6));
      const target = safeMediaPath(body.path || '');
      if (!target) { sendJSON(res, 400, { error: '非法路径' }); return; }
      fs.unlink(target, async e => {
        if (e) { sendJSON(res, 404, { error: '文件不存在' }); return; }
        const rel = path.relative(ROOT, target).replace(/\\/g, '/');
        const del = await syncCloud('delete_one.py', rel);
        sendJSON(res, 200, { ok: true, cloud: del });
      });
      return;
    }

    // ---- 静态文件 ----
    if (method === 'GET' || method === 'HEAD') { serveStatic(req, res, url); return; }
    res.writeHead(405); res.end('method not allowed');
  } catch (e) {
    console.error(e);
    sendJSON(res, 500, { error: String(e && e.message || e) });
  }
});

server.listen(PORT, '127.0.0.1', () => {
  console.log('\x1b[32mThe Memory 后台已启动\x1b[0m');
  console.log('  网站：  http://127.0.0.1:' + PORT + '/');
  console.log('  后台：  http://127.0.0.1:' + PORT + '/admin.html');
  console.log('  账号：  后台密码 = ' + ADMIN_PASS);
});

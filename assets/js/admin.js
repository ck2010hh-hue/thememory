/* The Memory — 后台逻辑 */
(function () {
  'use strict';
  var DATA = null;
  var TOKEN = localStorage.getItem('tm_token') || '';
  var BASE = ''; // 同域

  /* ---------- GitHub 模式：静态站（GitHub Pages）直接改仓库里的 data.json ---------- */
  var GH = { owner: 'ck2010hh-hue', repo: 'thememory', branch: 'main', path: 'data.json' };
  var GH_TOKEN = localStorage.getItem('tm_gh_token') || '';
  var GH_SHA = '';
  var isStatic = !/127\.0\.0\.1|localhost/i.test(location.host);
  var MODE = isStatic ? 'gh' : 'local';

  function ghHeaders(extra) {
    var h = { 'Accept': 'application/vnd.github+json' };
    if (GH_TOKEN) h['Authorization'] = 'Bearer ' + GH_TOKEN;
    if (extra) Object.keys(extra).forEach(function (k) { h[k] = extra[k]; });
    return h;
  }
  function ghApi(method, path, body) {
    var opt = { method: method, headers: ghHeaders({ 'Content-Type': 'application/json' }) };
    if (body !== undefined) opt.body = JSON.stringify(body);
    return fetch('https://api.github.com' + path, opt).then(function (r) {
      return r.json().then(function (j) { return { ok: r.ok, status: r.status, j: j }; });
    });
  }
  function b64(str) { return btoa(unescape(encodeURIComponent(str))); }

  function $(s, r) { return (r || document).querySelector(s); }
  function $all(s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); }
  function el(tag, cls, html) { var e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; }
  function esc(s) { return (s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

  /* 可复用的「说明/文案」编辑器：大文本框 + 回车换行 + 对齐选择 */
  function descEditor(v, key, label) {
    key = key || 'desc';
    label = label || '说明（回车换行，空行分段）';
    var wrap = el('div', 'desc-editor');
    wrap.appendChild(el('div', 'de-label', label));
    var ta = document.createElement('textarea');
    ta.className = 'desc-area';
    ta.rows = 6;
    ta.value = (v[key] || '').replace(/<br>/g, '\n');
    ta.placeholder = '输入文字，回车换行，两段之间空一行...';
    ta.oninput = function () { v[key] = ta.value; };
    wrap.appendChild(ta);
    var alignRow = el('div', 'align-row');
    alignRow.appendChild(el('label', '', '对齐'));
    var sel = document.createElement('select');
    sel.innerHTML = '<option value="left">左对齐</option><option value="center">居中</option>';
    sel.value = v.align || 'left';
    sel.onchange = function () { v.align = sel.value; };
    alignRow.appendChild(sel);
    wrap.appendChild(alignRow);
    return wrap;
  }

  function toast(msg) {
    var t = $('#toast'); t.textContent = msg; t.classList.add('show');
    clearTimeout(t._t); t._t = setTimeout(function () { t.classList.remove('show'); }, 2200);
  }

  function api(method, url, body, isJSON) {
    var opt = { method: method, headers: { 'x-admin-token': TOKEN } };
    if (body !== undefined) {
      if (isJSON === false) { opt.body = body; }
      else { opt.headers['Content-Type'] = 'application/json'; opt.body = JSON.stringify(body); }
    }
    return fetch(BASE + url, opt).then(function (r) {
      if (r.status === 401) throw new Error('unauthorized');
      return r.json();
    });
  }
  function getJSON() {
    return fetch(BASE + '/api/data?_=' + Date.now(), { cache: 'no-store', headers: { 'x-admin-token': TOKEN } })
      .then(function (r) { return r.json(); });
  }

  // 静态站模式：登录框改成 GitHub Token 入口
  /* ---------- 匿名直传 COS（手机可用，无需密钥） ----------
     桶策略限定：匿名只能 PUT 到 media/albums 下 upload- 前缀的新文件；
     读 / 列 / 删 以及覆盖已有照片全部拒绝。 */
  var COS_ORIGIN = 'https://thememoryhk-1482718043.cos.ap-hongkong.myqcloud.com';

  function cosPut(key, blob) {
    var url = COS_ORIGIN + '/' + key.split('/').map(encodeURIComponent).join('/');
    return fetch(url, { method: 'PUT', body: blob, headers: { 'Content-Type': 'image/jpeg' } })
      .then(function (r) {
        if (r.ok) return { ok: true };
        return r.text().then(function (t) { return { ok: false, msg: 'HTTP ' + r.status }; });
      });
  }

  function shrinkImg(file, maxSide, quality) {
    return new Promise(function (resolve, reject) {
      var url = URL.createObjectURL(file);
      var img = new Image();
      img.onload = function () {
        var w = img.naturalWidth || img.width, h = img.naturalHeight || img.height;
        var sc = Math.min(1, maxSide / Math.max(w, h));
        var cv = document.createElement('canvas');
        cv.width = Math.max(1, Math.round(w * sc));
        cv.height = Math.max(1, Math.round(h * sc));
        cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height);
        cv.toBlob(function (b) {
          URL.revokeObjectURL(url);
          if (b) resolve(b); else reject(new Error('图片压缩失败'));
        }, 'image/jpeg', quality);
      };
      img.onerror = function () { URL.revokeObjectURL(url); reject(new Error('无法读取该图片')); };
      img.src = url;
    });
  }

  function stampOf(file) {
    var d = file.lastModified ? new Date(file.lastModified) : new Date();
    function pad(n) { return n < 10 ? '0' + n : '' + n; }
    return d.getFullYear() + '.' + pad(d.getMonth() + 1) + '.' + pad(d.getDate());
  }

  // done(item|false)：item = {src, thumb, cap}
  function phoneUpload(albumId, file, done) {
    if (!/^image\//.test(file.type || '')) { toast('只支持图片，视频请用电脑导入'); done(false); return; }
    toast('处理中…' + file.name);
    var name = 'upload-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 7) + '.jpg';
    var k1 = 'media/albums/' + albumId + '/' + name;
    var k2 = 'media/albums/' + albumId + '/thumb/' + name;
    Promise.all([shrinkImg(file, 1600, 0.82), shrinkImg(file, 480, 0.75)])
      .then(function (bs) {
        return cosPut(k1, bs[0]).then(function (r) { return r.ok ? cosPut(k2, bs[1]) : r; });
      })
      .then(function (r) {
        if (!r.ok) { toast('上传失败：' + r.msg); done(false); return; }
        toast('已上传 ✓ 记得点「保存全部」');
        done({ src: k1, thumb: k2, cap: stampOf(file) });
      })
      .catch(function (e) { toast('上传出错：' + e.message); done(false); });
  }

  /* ---------- 线上版（GH 模式）界面适配 ---------- */
  function ghPanelBar() {
    // 2026-09-07 用户要求：手机上传提示栏不要了（手机端暂时不操作后台），不再渲染。
    return;
    if (MODE !== 'gh' || $('#ghBar')) return;
    var panel = $('#panel');
    if (!panel) return;
    var bar = document.createElement('div');
    bar.id = 'ghBar';
    bar.style.cssText = 'background:#2a201a;color:#e8ddd2;padding:10px 16px;font-size:13px;'
      + 'line-height:1.7;border-bottom:1px solid #3b2f27;';
    bar.innerHTML = '<b>线上版</b>　改完记得点「保存全部」，约 1 分钟生效。'
      + '<br>可改：文字 / 标题 / 说明 / 排序 / 增删条目；<b style="color:#9fd0a8;">可直接从手机相册上传照片</b>（自动压缩）。'
      + '<br><span style="color:#d8a08a;">视频需电脑导入</span>（体积大，手机传不动）。';
    panel.insertBefore(bar, panel.firstChild);
  }

  function disableUploadUI() {
    if (MODE !== 'gh') return;
    Array.prototype.forEach.call(document.querySelectorAll('button'), function (b) {
      if (!/\u4e0a\u4f20(\u89c6\u9891|\u97f3\u4e50)/.test(b.textContent || '')) return;
      if (b.dataset.ghOff === '1') return;
      b.dataset.ghOff = '1';
      b.disabled = true;
      b.title = '视频/音乐体积大，请用电脑端导入脚本';
      b.style.opacity = '.35';
      b.style.cursor = 'not-allowed';
    });
  }

  function watchUploadUI() {
    if (MODE !== 'gh' || typeof MutationObserver === 'undefined') { disableUploadUI(); return; }
    new MutationObserver(disableUploadUI).observe(document.body, { childList: true, subtree: true });
    disableUploadUI();
  }

  function pullLatest() {
    if (!GH_TOKEN) { toast('请先填入 GitHub Token'); return; }
    toast('拉取中…');
    ghApi('GET', '/repos/' + GH.owner + '/' + GH.repo + '/contents/' + GH.path + '?ref=' + GH.branch)
      .then(function (res) {
        if (!res.ok) { toast('拉取失败 ' + res.status); return; }
        GH_SHA = res.j.sha;
        try {
          DATA = JSON.parse(decodeURIComponent(escape(atob(res.j.content.replace(/\n/g, '')))));
          renderAll(); toast('已拉取线上最新 ✓');
        } catch (e) { toast('解析失败：' + e.message); }
      });
  }

  function guardStaticHost() {
    if (!isStatic) return;
    var p = $('#pass');
    if (p) { p.type = 'text'; p.placeholder = '粘贴 GitHub Token（只需一次）'; }
    var sub = document.querySelector('.login-sub');
    if (sub) sub.textContent = 'The Memory · 线上版';
    var card = document.querySelector('.login-card');
    if (card && !$('#ghTip')) {
      var tip = document.createElement('div');
      tip.id = 'ghTip';
      tip.style.cssText = 'margin-top:14px;font-size:12px;line-height:1.7;color:#9a8f86;';
      tip.innerHTML = '线上版通过 GitHub 保存内容，需要一个只授权本仓库的 Token。'
        + '<br>生成：<a href="https://github.com/settings/personal-access-tokens/new" target="_blank" style="color:#c8a882;">'
        + 'github.com/settings/personal-access-tokens</a><br>'
        + 'Repository access 选 <b>Only select repositories → thememory</b>，权限勾 <b>Contents: Read and write</b>。';
      card.appendChild(tip);
    }
    // 已有 token 就直接读内容
    if (GH_TOKEN) {
      ghApi('GET', '/repos/' + GH.owner + '/' + GH.repo + '/contents/' + GH.path + '?ref=' + GH.branch)
        .then(function (res) {
          if (!res.ok) { localStorage.removeItem('tm_gh_token'); return; }
          GH_SHA = res.j.sha;
          enterPanel(JSON.parse(decodeURIComponent(escape(atob(res.j.content.replace(/\n/g, ''))))));
        });
    }
  }

  function enterPanel(d) {
    DATA = d;
    $('#login').classList.add('hidden');
    $('#panel').classList.remove('hidden');
    ghPanelBar();
    renderAll();
  }

  function pollDeployStatus() {
    var max = 40, i = 0;
    function check() {
      if (i++ > max) { toast('推送时间较长，请稍后刷新网站查看'); return; }
      fetch(BASE + '/api/deploy-status?_=' + Date.now(), { headers: { 'x-admin-token': TOKEN } })
        .then(function (r) { return r.json(); })
        .then(function (s) {
          if (s.last && s.last.time) {
            var age = Date.now() - s.last.time;
            if (age < 4000) {
              toast(s.last.ok ? '已推送至 GitHub ✓ 约 1 分钟后生效' : 'GitHub 推送失败，请检查后台终端');
              return;
            }
          }
          if (s.running || s.pending) { toast('正在推送到 GitHub...'); setTimeout(check, 1500); }
          else { setTimeout(check, 1000); }
        }).catch(function () { /* ignore */ });
    }
    check();
  }

  function mergeOrderArrays(to, from) {
    if (!from) return to;
    var set = new Set(to || []);
    (from || []).forEach(function (id) { if (!set.has(id)) to.push(id); });
    return to;
  }
  function parseYearFromDate(dateStr) {
    var m = String(dateStr || '').match(/\d{4}/);
    return m ? m[0] : null;
  }
  function syncYearAlbums() {
    var m = DATA.moments = DATA.moments || {};
    var years = [];
    for (var y = 2026; y >= 2016; y--) years.push('year-' + y);
    m.yearOrder = m.yearOrder || years;
    // 顺序固定为最新年份在最上（防止旧内存顺序覆盖后回退）
    m.yearOrder.sort(function (a, b) {
      return (parseInt(b.replace('year-', ''), 10) || 0) - (parseInt(a.replace('year-', ''), 10) || 0);
    });
    m.yearAlbums = m.yearAlbums || {};
    years.forEach(function (id) {
      if (!m.yearAlbums[id]) {
        m.yearAlbums[id] = { id: id, title: id.replace('year-', ''), place: '', date: id.replace('year-', ''), desc: '', hero: '', story: [], photos: [] };
      }
    });
    years.forEach(function (id) { m.yearAlbums[id].photos = []; });
    (m.items || []).forEach(function (it) {
      var y = parseYearFromDate(it.date);
      if (!y) return;
      var id = 'year-' + y;
      if (!m.yearAlbums[id]) return;
      m.yearAlbums[id].photos.push({ src: it.media || '', cap: (it.place || '') + (it.date ? ' · ' + it.date : '') });
    });
    // 说明：hero 只代表「用户主动上传的封面」，不自动填充首图，
    // 这样前台年份图文档里不会出现「封面 = 第一条图文」的重复。
  }
  function saveAll() {
    syncYearAlbums();
    if (MODE === 'gh') {
      if (!GH_TOKEN) { toast('请先填入 GitHub Token'); return; }
      toast('正在保存…');
      var p = '/repos/' + GH.owner + '/' + GH.repo + '/contents/' + GH.path;
      return ghApi('GET', p + '?ref=' + GH.branch).then(function (g) {
        if (!g.ok) throw new Error('读取远端失败 ' + g.status);
        GH_SHA = g.j.sha;
        // 防覆盖：合并远端已有的 galleryOrder/favoritesOrder/yearOrder
        var remote = {};
        try { remote = JSON.parse(atob(g.j.content)); } catch (e) { remote = {}; }
        mergeOrderArrays(DATA.galleryOrder, remote.galleryOrder);
        mergeOrderArrays(DATA.favoritesOrder, remote.favoritesOrder);
        if (DATA.moments && DATA.moments.yearOrder && remote.moments && remote.moments.yearOrder) {
          mergeOrderArrays(DATA.moments.yearOrder, remote.moments.yearOrder);
        }
        return ghApi('PUT', p, {
          message: 'update data.json via admin',
          content: b64(JSON.stringify(DATA, null, 2)),
          sha: GH_SHA,
          branch: GH.branch
        });
      }).then(function (res) {
        if (res.ok) { GH_SHA = res.j.content && res.j.content.sha; toast('已保存 ✓ 约 1 分钟后生效'); }
        else if (res.status === 409) toast('线上数据已被改动，请先点「拉取线上最新」再改');
        else toast('保存失败：' + ((res.j && res.j.message) || res.status));
      }).catch(function (e) { toast('保存出错：' + e.message); });
    }
    return api('PUT', '/api/data', DATA).then(function (r) {
      if (r.ok) { toast('已保存 ✓ 正在推送到 GitHub...'); pollDeployStatus(); }
      else toast('保存失败');
    }).catch(function () { toast('保存失败：请确认是用本机后台地址打开'); });
  }
  function upload(albumId, filename, dataUrl) {
    if (MODE === 'gh') return Promise.resolve({ ok: false, error: '线上版不能直接传照片，请在本机用导入脚本（照片存 COS）' });
    return api('POST', '/api/upload', { albumId: albumId, filename: filename, data: dataUrl });
  }
  function delMedia(path) {
    if (MODE === 'gh') return Promise.resolve({ ok: true });
    return api('DELETE', '/api/media', { path: path });
  }

  function readFileAsDataURL(file) {
    return new Promise(function (resolve, reject) {
      var fr = new FileReader();
      fr.onload = function () { resolve(fr.result); };
      fr.onerror = reject;
      fr.readAsDataURL(file);
    });
  }

  /* ---------- 上传前压缩（2026-09-07 加）----------
     原图动辄 5MB，直传会让页面加载极慢。统一压到最长边 1600px / JPEG 82%，
     与电脑端 import_album.py 的规格一致。非图片（视频等）不压缩，原样上传。 */
  var UP_MAX = 1600, UP_Q = 0.82;
  function compressImage(file) {
    return new Promise(function (resolve) {
      if (!/^image\//.test(file.type) || /gif|svg/.test(file.type)) { resolve(null); return; }
      function draw(src) {
        var w = src.width, h = src.height;
        var s = Math.min(1, UP_MAX / Math.max(w, h));
        var cv = document.createElement('canvas');
        cv.width = Math.round(w * s); cv.height = Math.round(h * s);
        cv.getContext('2d').drawImage(src, 0, 0, cv.width, cv.height);
        cv.toBlob(function (b) { resolve(b || null); }, 'image/jpeg', UP_Q);
      }
      function fallback() {
        var fr = new FileReader();
        fr.onload = function () {
          var im = new Image();
          im.onload = function () { draw(im); };
          im.onerror = function () { resolve(null); };
          im.src = fr.result;
        };
        fr.onerror = function () { resolve(null); };
        fr.readAsDataURL(file);
      }
      if (window.createImageBitmap) {
        try {
          createImageBitmap(file, { imageOrientation: 'from-image' }).then(draw).catch(fallback);
        } catch (e) { fallback(); }
      } else { fallback(); }
    });
  }

  /* ---------- 登录 ---------- */
  function doLogin() {
    var p = ($('#pass').value || '').trim();
    if (MODE === 'gh') {
      if (!p) { $('#loginErr').textContent = '请粘贴 GitHub Token'; return; }
      $('#loginErr').textContent = '验证中…';
      GH_TOKEN = p;
      ghApi('GET', '/repos/' + GH.owner + '/' + GH.repo + '/contents/' + GH.path + '?ref=' + GH.branch)
        .then(function (res) {
          if (!res.ok) { $('#loginErr').textContent = 'Token 无效或无权访问该仓库（' + res.status + '）'; GH_TOKEN = ''; return; }
          localStorage.setItem('tm_gh_token', GH_TOKEN);
          GH_SHA = res.j.sha;
          try { enterPanel(JSON.parse(decodeURIComponent(escape(atob(res.j.content.replace(/\n/g, '')))))); }
          catch (e) { $('#loginErr').textContent = 'data.json 解析失败：' + e.message; }
        });
      return;
    }
    fetch(BASE + '/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: p }) })
      .then(function (r) { return r.json().then(function (j) { return { ok: r.ok, j: j }; }); })
      .then(function (res) {
        if (res.ok && res.j.token) {
          TOKEN = res.j.token; localStorage.setItem('tm_token', TOKEN);
          $('#login').classList.add('hidden'); $('#panel').classList.remove('hidden');
          load();
        } else { $('#loginErr').textContent = (res.j && res.j.error) || '登录失败'; }
      }).catch(function () { $('#loginErr').textContent = '网络错误'; });
  }

  function load() {
    toast('正在加载数据…');
    getJSON().then(function (d) {
      if (!d || typeof d !== 'object') { toast('数据格式错误：未读到有效内容'); return; }
      DATA = d;
      try { renderAll(); toast('数据已加载 ✓'); }
      catch (e) { console.error(e); toast('渲染出错：' + e.message); }
    }).catch(function (e) { toast('读取数据失败：' + e.message); });
  }

  /* ---------- 相册 ↔ 省市自动联动（与 site.js 同逻辑） ----------
     依据相册 place 字段中的省名/城市名，把相册 ID 补进对应城市的 albums（去重，只增不删）。
     让 Places 统计、省份点亮、城市圆点随相册自动更新，后台无需手工维护。 */
  function normalizePlaceLinks(d) {
    try {
      var provs = d.places && d.places.provinces || {};
      var provByName = {};
      var cityIndex = {};
      Object.keys(provs).forEach(function (pk) {
        var p = provs[pk];
        if (p.name) provByName[p.name] = pk;
        Object.keys(p.cities || {}).forEach(function (ck) {
          var c = p.cities[ck];
          if (c && c.name) (cityIndex[c.name] = cityIndex[c.name] || []).push({ pk: pk, ck: ck });
        });
      });
      Object.keys(d.albums || {}).forEach(function (id) {
        var a = d.albums[id];
        if (!a || !a.place) return;
        var parts = String(a.place).split('·').map(function (s) { return s.trim(); }).filter(Boolean);
        var pk = null, ck = null;
        parts.forEach(function (seg) {
          if (provByName[seg]) pk = provByName[seg];
          var hits = cityIndex[seg];
          if (hits) {
            var h = pk ? hits.filter(function (x) { return x.pk === pk; })[0] : (hits.length === 1 ? hits[0] : null);
            if (!h && hits.length === 1) h = hits[0];
            if (h) { ck = h.ck; pk = pk || h.pk; }
          }
        });
        if (pk && ck && provs[pk].cities[ck]) {
          var c = provs[pk].cities[ck];
          c.albums = c.albums || [];
          if (c.albums.indexOf(id) === -1) c.albums.push(id);
        }
      });
    } catch (e) { /* 联动失败不阻塞后台 */ }
  }

  /* ---------- 渲染 ---------- */
  function renderAll() {
    normalizePlaceLinks(DATA);
    var fns = [
      ['网站设置', renderSite],
      ['影片管理', renderVideos],
      ['归档影片', renderFilms],
      ['瞬间管理', renderMoments],
      ['相册管理', renderAlbums],
      ['首页收藏顺序', function () { renderOrder('#favOrder', 'favoritesOrder', '首页收藏'); }],
      ['图集顺序', function () { renderOrder('#galOrder', 'galleryOrder', '图集'); }],
      ['地点地图', renderPlaces]
    ];
    fns.forEach(function (pair) {
      try { pair[1](); }
      catch (e) { console.error('渲染 ' + pair[0] + ' 出错:', e); toast('「' + pair[0] + '」渲染出错：' + e.message); }
    });
    disableUploadUI();
  }

  function renderVideos() {
    var wrap = $('#videoList'); wrap.innerHTML = '';
    var videos = (DATA.site && DATA.site.videos) || (DATA.site = DATA.site || {}, DATA.site.videos = []);
    if (!videos.length) { wrap.appendChild(el('p', 'hint', '还没有影片，点右上角「添加影片」。')); return; }
    videos.forEach(function (v, i) {
      var item = el('div', 'order-item sortable-item');
      item.appendChild(el('div', 'oi-title', esc(v.title || '未命名')));
      var row = el('div', 'field-row');
      row.appendChild(el('label', '', '编号'));
      row.appendChild(inp('text', v.sub || '', function (val) { v.sub = val; }));
      row.appendChild(el('label', '', '标题'));
      row.appendChild(inp('text', v.title || '', function (val) { v.title = val; }));
      item.appendChild(row);
      var srcRow = el('div', 'field-row');
      srcRow.appendChild(el('label', '', '视频文件'));
      var srcIn = inp('text', v.src || '', function (val) { v.src = val; });
      srcIn.style.flex = '1'; srcIn.placeholder = '如 media/hero-web2.mp4';
      srcRow.appendChild(srcIn);
      var upBtn = el('button', 'btn-mini', '上传并覆盖');
      // 裁剪/压缩控件
      var clipRow = el('div', 'field-row clip-row');
      var clipChk = document.createElement('input');
      clipChk.type = 'checkbox'; clipChk.checked = true; clipChk.style.width = 'auto'; clipChk.style.marginRight = '4px';
      clipRow.appendChild(clipChk);
      clipRow.appendChild(el('label', '', '上传时裁剪/压缩'));
      var sIn = inp('number', 0, function () {}); sIn.placeholder = '起始秒'; sIn.style.width = '64px'; sIn.min = 0;
      clipRow.appendChild(sIn);
      var dIn = inp('number', 30, function () {}); dIn.placeholder = '时长≤30'; dIn.style.width = '78px'; dIn.min = 1; dIn.max = 30;
      clipRow.appendChild(dIn);
      var clipHint = el('span', 'clip-hint', '自动转码：≤30秒、宽≤1080、压缩小体积');
      clipHint.style.cssText = 'font-size:11px;opacity:.7;align-self:center;margin-left:6px;';
      clipRow.appendChild(clipHint);
      upBtn.onclick = function () {
        if (MODE === 'gh') { toast('线上版请把视频放到 media/ 目录后用 gh_push.py 推送'); return; }
        pickFile(false, function (files) {
          var f = files[0];
          if (f.size > 200 * 1024 * 1024 && !confirm('视频超过 200MB，确认上传吗？')) return;
          toast('上传中…' + f.name);
          readFileAsDataURL(f).then(function (du) {
            var body = { path: v.src || '', filename: f.name, data: du, overwrite: true };
            if (clipChk.checked) {
              body.cap30 = true;
              var s = parseFloat(sIn.value); if (!isNaN(s) && s > 0) body.start = s;
              var d = parseFloat(dIn.value); if (!isNaN(d) && d > 0) body.duration = Math.min(d, 30);
            }
            return fetch(BASE + '/api/upload-media', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', 'x-admin-token': TOKEN },
              body: JSON.stringify(body)
            });
          }).then(function (r) { return r.json(); }).then(function (r) {
            if (r.ok) { v.src = r.path; srcIn.value = r.path; toast('已覆盖：' + r.path + (r.size ? '（' + Math.round(r.size / 1024) + ' KB）' : '') + '，正在推送...'); pollDeployStatus(); }
            else { toast('上传失败：' + (r.error || '未知错误')); }
          }).catch(function (e) { toast('上传出错：' + e.message); });
        }, 'video/*');
      };
      srcRow.appendChild(upBtn);
      item.appendChild(srcRow);
      item.appendChild(clipRow);
      item.appendChild(descEditor(v));
      var acts = sortActions(videos, i, renderVideos, '删除影片「' + (v.title || '') + '」？', function () { videos.splice(i, 1); });
      item.appendChild(acts);
      wrap.appendChild(item);
    });
    makeSortable(wrap, videos, renderVideos);
  }

  function renderFilms() {
    DATA.films = DATA.films || {};
    var f = DATA.films;
    $('#f-title').value = f.title || '';
    $('#f-subtitle').value = f.subtitle || '';
    $('#f-intro').value = (f.intro || '').replace(/<br>/g, '\n');
    $('#f-title').oninput = function () { f.title = $('#f-title').value; };
    $('#f-subtitle').oninput = function () { f.subtitle = $('#f-subtitle').value; };
    $('#f-intro').oninput = function () { f.intro = $('#f-intro').value.replace(/\n/g, '<br>'); };

    var wrap = $('#filmList'); wrap.innerHTML = '';
    var items = f.items || (f.items = []);
    if (!items.length) { wrap.appendChild(el('p', 'hint', '还没有归档影片，点右上角「添加归档影片」。')); return; }
    items.forEach(function (v, i) {
      var item = el('div', 'order-item sortable-item');
      item.appendChild(el('div', 'oi-title', esc(v.title || '未命名')));
      var row = el('div', 'field-row');
      row.appendChild(el('label', '', '标题'));
      row.appendChild(inp('text', v.title || '', function (val) { v.title = val; item.querySelector('.oi-title').textContent = val || '未命名'; }));
      item.appendChild(row);
      var srcRow = el('div', 'field-row');
      srcRow.appendChild(el('label', '', '视频文件'));
      var srcIn = inp('text', v.src || '', function (val) { v.src = val; });
      srcIn.style.flex = '1'; srcIn.placeholder = '如 media/film-01.mp4';
      srcRow.appendChild(srcIn);
      var upBtn = el('button', 'btn-mini', '上传并覆盖');
      var clipRow = el('div', 'field-row clip-row');
      var clipChk = document.createElement('input');
      clipChk.type = 'checkbox'; clipChk.checked = true; clipChk.style.width = 'auto'; clipChk.style.marginRight = '4px';
      clipRow.appendChild(clipChk);
      clipRow.appendChild(el('label', '', '上传时裁剪/压缩'));
      var sIn = inp('number', 0, function () {}); sIn.placeholder = '起始秒'; sIn.style.width = '64px'; sIn.min = 0;
      clipRow.appendChild(sIn);
      var dIn = inp('number', 30, function () {}); dIn.placeholder = '时长≤30'; dIn.style.width = '78px'; dIn.min = 1; dIn.max = 30;
      clipRow.appendChild(dIn);
      var clipHint = el('span', 'clip-hint', '自动转码：≤30秒、宽≤1080、压缩小体积');
      clipHint.style.cssText = 'font-size:11px;opacity:.7;align-self:center;margin-left:6px;';
      clipRow.appendChild(clipHint);
      upBtn.onclick = function () {
        if (MODE === 'gh') { toast('线上版请把视频放到 media/ 目录后用 gh_push.py 推送'); return; }
        pickFile(false, function (files) {
          var ff = files[0];
          if (ff.size > 200 * 1024 * 1024 && !confirm('视频超过 200MB，确认上传吗？')) return;
          toast('上传中…' + ff.name);
          readFileAsDataURL(ff).then(function (du) {
            var body = { path: v.src || '', filename: ff.name, data: du, overwrite: true };
            if (clipChk.checked) {
              body.cap30 = true;
              var s = parseFloat(sIn.value); if (!isNaN(s) && s > 0) body.start = s;
              var dd = parseFloat(dIn.value); if (!isNaN(dd) && dd > 0) body.duration = Math.min(dd, 30);
            }
            return fetch(BASE + '/api/upload-media', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', 'x-admin-token': TOKEN },
              body: JSON.stringify(body)
            });
          }).then(function (r) { return r.json(); }).then(function (r) {
            if (r.ok) { v.src = r.path; srcIn.value = r.path; toast('已覆盖：' + r.path + (r.size ? '（' + Math.round(r.size / 1024) + ' KB）' : '') + '，正在推送...'); pollDeployStatus(); }
            else { toast('上传失败：' + (r.error || '未知错误')); }
          }).catch(function (e) { toast('上传出错：' + e.message); });
        }, 'video/*');
      };
      srcRow.appendChild(upBtn);
      item.appendChild(srcRow);
      item.appendChild(clipRow);
      item.appendChild(descEditor(v));
      var acts = sortActions(items, i, renderFilms, '删除归档影片「' + (v.title || '') + '」？', function () { items.splice(i, 1); });
      item.appendChild(acts);
      wrap.appendChild(item);
    });
    makeSortable(wrap, items, renderFilms);
  }

  function renderMoments() {
    DATA.moments = DATA.moments || {};
    var m = DATA.moments;
    var wrap = $('#momentsForm'); wrap.innerHTML = '';
    // 入口设置
    var head = el('div', 'album-card');
    head.appendChild(el('div', 'ac-head', '<div class="ac-title">首页入口</div>'));
    var g = el('div', 'grid2');
    g.appendChild(field('导航名称', inp('text', m.navLabel || 'Moments', function (v) { m.navLabel = v; })));
    g.appendChild(field('大标题', inp('text', m.title || '', function (v) { m.title = v; })));
    head.appendChild(g);
    var subRow = el('div', 'field');
    subRow.appendChild(el('label', null, '副标题'));
    var subTa = document.createElement('textarea'); subTa.rows = 2; subTa.value = m.subtitle || '';
    subTa.oninput = function () { m.subtitle = subTa.value; };
    subRow.appendChild(subTa); head.appendChild(subRow);
    var heroRow = el('div', 'field');
    heroRow.appendChild(el('label', null, '入口背景图'));
    var hr = el('div', 'row');
    var hi = inp('text', m.hero || '', function (v) { m.hero = v; }); hi.style.flex = '1';
    hr.appendChild(hi);
    var hb = el('button', 'btn-mini', '上传背景');
    hb.onclick = function () { pickFile(false, function (files) { uploadOne('moments', files[0], function (path) { if (path) { m.hero = path; hi.value = path; } }); }, 'image/*'); };
    hr.appendChild(hb); heroRow.appendChild(hr); head.appendChild(heroRow);
    wrap.appendChild(head);

    // 年份相册管理
    var yearHead = el('div', 'tab-head');
    yearHead.appendChild(el('h3', 'sub-h', '年份相册（2016-2026）'));
    wrap.appendChild(yearHead);
    wrap.appendChild(el('p', 'hint', '保存时系统会根据上方「零散瞬间条目」里的日期，自动把照片归集到对应年份相册。这里可上传/替换封面，或编辑年份说明。'));
    var yearGrid = el('div', 'year-album-grid');
    var yOrder = m.yearOrder || [];
    if (!m.yearAlbums) m.yearAlbums = {};
    if (!yOrder.length) {
      for (var yy = 2026; yy >= 2016; yy--) yOrder.push('year-' + yy);
      m.yearOrder = yOrder;
    }
    // 与前台一致：最新年份在最上
    yOrder.sort(function (a, b) {
      return (parseInt(b.replace('year-', ''), 10) || 0) - (parseInt(a.replace('year-', ''), 10) || 0);
    });
    yOrder.forEach(function (id) {
      var a = m.yearAlbums[id];
      if (!a) {
        a = { id: id, title: id.replace('year-', ''), place: '', date: id.replace('year-', ''), desc: '', hero: '', story: [], photos: [] };
        m.yearAlbums[id] = a;
      }
      var card = el('div', 'year-album-card');
      card.appendChild(el('div', 'yac-year', a.title));
      var imgWrap = el('div', 'yac-img');
      if (a.hero) {
        var im = document.createElement('img'); im.src = a.hero; im.alt = ''; imgWrap.appendChild(im);
      } else {
        imgWrap.appendChild(el('span', '', '暂无封面'));
      }
      card.appendChild(imgWrap);
      var descInp = document.createElement('textarea'); descInp.rows = 2; descInp.value = a.desc || ''; descInp.placeholder = '年份说明';
      descInp.oninput = function () { a.desc = descInp.value; };
      card.appendChild(descInp);
      var btnRow = el('div', 'yac-actions');
      var upBtn = el('button', 'btn-mini', a.hero ? '替换封面' : '上传封面');
      upBtn.onclick = function () {
        pickFile(false, function (files) {
          uploadOne(id, files[0], function (r) {
            if (typeof r === 'string') { a.hero = r; }
            else if (r) { a.hero = r.src; }
            renderMoments();
          });
        }, 'image/*');
      };
      btnRow.appendChild(upBtn);
      var viewLink = el('a', 'yac-view', '前台查看 →');
      viewLink.href = 'moments.html?year=' + a.title;
      viewLink.target = '_blank';
      btnRow.appendChild(viewLink);
      card.appendChild(btnRow);
      yearGrid.appendChild(card);
    });
    wrap.appendChild(yearGrid);

    // 条目列表
    var listHead = el('div', 'tab-head');
    listHead.appendChild(el('h3', 'sub-h', '零散瞬间条目'));
    var addBtn = el('button', 'btn-primary', '+ 添加条目');
    addBtn.onclick = function () {
      m.items = m.items || [];
      m.items.push({ id: 'moment-' + Date.now(), date: '', place: '', text: '', media: '', type: 'image' });
      renderMoments();
    };
    listHead.appendChild(addBtn);
    wrap.appendChild(listHead);
    var items = m.items || [];
    if (!items.length) { wrap.appendChild(el('p', 'hint', '还没有条目，点右上角「添加条目」。')); return; }
    items.forEach(function (it, i) {
      var card = el('div', 'album-card');
      card.appendChild(el('div', 'ac-head', '<div class="ac-title">条目 ' + (i + 1) + '</div>'));
      var row1 = el('div', 'field-row');
      row1.appendChild(el('label', '', '时间'));
      row1.appendChild(inp('text', it.date || '', function (v) { it.date = v; }));
      row1.appendChild(el('label', '', '地点'));
      row1.appendChild(inp('text', it.place || '', function (v) { it.place = v; }));
      card.appendChild(row1);
      var typeRow = el('div', 'field-row');
      typeRow.appendChild(el('label', '', '类型'));
      var sel = document.createElement('select');
      sel.innerHTML = '<option value="image"' + (it.type === 'image' ? ' selected' : '') + '>图片</option>'
        + '<option value="video"' + (it.type === 'video' ? ' selected' : '') + '>视频</option>'
        + '<option value="auto"' + (it.type === 'auto' ? ' selected' : '') + '>自动判断</option>';
      sel.onchange = function () { it.type = sel.value; };
      typeRow.appendChild(sel);
      card.appendChild(typeRow);
      var textRow = el('div', 'field');
      textRow.appendChild(descEditor(it, 'text', '文案（回车换行，空行分段）'));
      card.appendChild(textRow);
      var mediaRow = el('div', 'field');
      mediaRow.appendChild(el('label', null, '照片 / 视频文件'));
      var mr = el('div', 'row');
      var mi = inp('text', it.media || '', function (v) { it.media = v; }); mi.style.flex = '1';
      mr.appendChild(mi);
      var mb = el('button', 'btn-mini', '上传媒体');
      mb.onclick = function () {
        pickFile(false, function (files) {
          var f = files[0];
          var acc = (it.type === 'video') ? 'video/*' : ((it.type === 'image') ? 'image/*' : 'image/*,video/*');
          if (f.type && f.type.startsWith('video/')) it.type = 'video';
          uploadOne('moments', f, function (path) { if (path) { it.media = path; mi.value = path; } });
        }, (it.type === 'video') ? 'video/*' : ((it.type === 'image') ? 'image/*' : 'image/*,video/*'));
      };
      mr.appendChild(mb); mediaRow.appendChild(mr); card.appendChild(mediaRow);
      var acts = sortActions(items, i, renderMoments, '删除这条瞬间记录？', function () { items.splice(i, 1); });
      card.appendChild(acts);
      wrap.appendChild(card);
    });
    makeSortable(wrap, items, renderMoments);
  }

  function renderSite() {
    var s = DATA.site || (DATA.site = {});
    $('#s-name').value = s.name || '';
    $('#s-intro').value = (s.intro || '').replace(/<br>/g, '\n');
    $('#s-hero').value = s.heroVideo || '';
    $('#s-audio').value = s.introAudio || '';
    if ($('#s-mapkey')) $('#s-mapkey').value = s.mapKey || '';
  }

  function renderAlbums() {
    var wrap = $('#albumList'); wrap.innerHTML = '';
    var ids = Object.keys(DATA.albums || {});
    if (!ids.length) wrap.appendChild(el('p', 'hint', '还没有相册，点右上角「新建相册」。'));
    ids.forEach(function (id) { wrap.appendChild(albumCard(DATA.albums[id])); });
  }

  function albumCard(a) {
    var card = el('div', 'album-card');
    card.appendChild(el('div', 'ac-head', '<div class="ac-title">' + esc(a.title || '(未命名)') + '</div>'));
    var del = el('button', 'btn-danger', '删除相册');
    del.onclick = function () {
      if (!confirm('确定删除相册「' + (a.title || '') + '」？其照片文件也会从服务器删除。')) return;
      (a.photos || []).forEach(function (p) { if (p.src) delMedia(p.src.replace(/^media\//, 'media/')); });
      if (a.hero) delMedia(a.hero.replace(/^media\//, 'media/'));
      delete DATA.albums[a.id];
      DATA.favoritesOrder = (DATA.favoritesOrder || []).filter(function (x) { return x !== a.id; });
      DATA.galleryOrder = (DATA.galleryOrder || []).filter(function (x) { return x !== a.id; });
      renderAlbums();
    };
    card.querySelector('.ac-head').appendChild(del);

    var g = el('div', 'grid2');
    g.appendChild(field('标题', inp('text', a.title || '', function (v) { a.title = v; })));
    g.appendChild(field('地点（如 安徽 · 中国）', inp('text', a.place || '', function (v) { a.place = v; })));
    g.appendChild(field('日期（如 2026 · 02）', inp('text', a.date || '', function (v) { a.date = v; })));
    g.appendChild(field('一句话简介', inp('text', a.desc || '', function (v) { a.desc = v; })));
    card.appendChild(g);

    // 主图
    var heroRow = el('div', 'field');
    heroRow.appendChild(el('label', null, '主图（满屏大图）'));
    var hr = el('div', 'row');
    var hi = inp('text', a.hero || '', function (v) { a.hero = v; }); hi.style.flex = '1';
    hr.appendChild(hi);
    var hb = el('button', 'btn-mini', '上传主图');
    hb.onclick = function () { pickFile(false, function (files) { uploadOne(a.id, files[0], function (r) {
      if (typeof r === 'string') { a.hero = r; hi.value = r; }
      else if (r) { a.hero = r.src; a.heroThumb = r.thumb; hi.value = r.src; }
      toast(r ? '主图已设' : '未设置');
    }); }); };
    hr.appendChild(hb);
    heroRow.appendChild(hr);
    card.appendChild(heroRow);

    // 故事
    var story = el('div', 'field');
    story.appendChild(el('label', null, '游记故事（每段一段，可加/删/排序）'));
    (a.story || []).forEach(function (p, i) {
      var ta = document.createElement('textarea'); ta.rows = 2; ta.value = p; ta.style.marginBottom = '6px';
      ta.style.width = '100%'; ta.style.boxSizing = 'border-box';
      ta.oninput = function () { a.story[i] = ta.value; };
      var rr = el('div', 'row sortable-item story-row'); rr.style.marginBottom = '8px';
      var dh = el('span', 'drag-handle', '\u22EF');
      rr.appendChild(dh);
      var rm = el('button', 'btn-danger btn-mini', '删'); rm.onclick = function () { a.story.splice(i, 1); renderAlbums(); };
      rr.appendChild(rm); rr.appendChild(ta);
      story.appendChild(rr);
    });
    makeSortable(story, a.story, renderAlbums);
    var addS = el('button', 'btn-mini', '+ 加一段');
    addS.onclick = function () { a.story = a.story || []; a.story.push(''); renderAlbums(); };
    story.appendChild(addS);
    card.appendChild(story);

    // 照片管理
    var pm = el('div', 'photo-mgr');
    var pmh = el('div', 'pm-head');
    pmh.appendChild(el('div', null, '<b>相册照片</b>（点击「设为主图」可换满屏大图；可排序/删除）'));
    var upBtn = el('button', 'btn-mini', '上传照片');
    upBtn.onclick = function () { pickFile(true, function (files) {
      var i = 0;
      (function next() {
        if (i >= files.length) { renderAlbums(); return; }
        var f = files[i++];
        uploadOne(a.id, f, function (r) {
          if (r) {
            a.photos = a.photos || [];
            a.photos.push(typeof r === 'string' ? { src: r, cap: f.name.replace(/\.[^.]+$/, '') } : r);
          }
          next();
        });
      })();
    }); };
    pmh.appendChild(upBtn);
    pm.appendChild(pmh);

    var grid = el('div', 'photo-grid');
    (a.photos || []).forEach(function (p, i) {
      var cell = el('div', 'photo-cell sortable-item' + (a.hero === p.src ? ' is-hero' : ''));
      if (a.hero === p.src) cell.appendChild(el('div', 'hero-badge', '主图'));
      cell.appendChild(el('img', null, '').cloneNode(false)); // placeholder
      var im = cell.querySelector('img') || document.createElement('img');
      im.src = p.src; im.alt = ''; cell.insertBefore(im, cell.firstChild);
      cell.appendChild(el('div', 'pc-cap', esc(p.cap || '')));
      var acts = el('div', 'pc-actions');
      var shero = el('button', null, '设主图'); shero.onclick = function () { a.hero = p.src; renderAlbums(); };
      var srm = el('button', null, '删'); srm.onclick = function () {
        if (!confirm('删除这张照片？')) return;
        delMedia(p.src.replace(/^media\//, 'media/'));
        a.photos.splice(i, 1); renderAlbums();
      };
      acts.appendChild(shero); acts.appendChild(srm);
      cell.appendChild(acts);
      grid.appendChild(cell);
    });
    makeSortable(grid, a.photos, renderAlbums);
    pm.appendChild(grid);
    card.appendChild(pm);

    return card;
  }

  function field(label, input) {
    var f = el('div', 'field'); f.appendChild(el('label', null, label)); f.appendChild(input); return f;
  }
  function inp(type, val, onchange) {
    var i = document.createElement('input'); i.type = type; i.value = val || '';
    i.oninput = function () { onchange(i.value); }; return i;
  }
  function swap(arr, i, j) { if (!arr || i < 0 || j < 0 || i >= arr.length || j >= arr.length) return; var t = arr[i]; arr[i] = arr[j]; arr[j] = t; }

  /* ---------- 通用拖拽排序（替代所有 ↑↓ 按钮） ----------
     用法：在渲染完列表后调用 makeSortable(container, array, rerender)
     container 是包裹所有 .sortable-item 的父元素；
     array 是对应的数据数组引用；rerender 是变化后回调（一般为重新渲染该板块）。
     每个 .sortable-item 左侧会自动插入拖拽手柄，拖拽松手后自动 splice 重排。 */
  var _dragSrcEl = null, _dragOverEl = null;
  function makeSortable(container, arr, rerender) {
    if (!container) return;
    var items = container.querySelectorAll('.sortable-item');
    items.forEach(function (item, idx) {
      item.setAttribute('draggable', 'true');
      item.setAttribute('data-sidx', idx);
      // 插入拖拽手柄（如果还没有）
      if (!item.querySelector('.drag-handle')) {
        var dh = el('span', 'drag-handle', '\u22EF'); /* ≡ */
        item.insertBefore(dh, item.firstChild);
      }
      item.ondragstart = function (e) {
        _dragSrcEl = item;
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', idx);
        setTimeout(function () { item.classList.add('dragging'); }, 0);
      };
      item.ondragend = function () {
        item.classList.remove('dragging');
        _dragSrcEl = null;
        _dragOverEl = null;
        container.querySelectorAll('.sortable-item').forEach(function (el) { el.classList.remove('drag-over'); });
      };
      item.ondragover = function (e) {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        if (_dragOverEl && _dragOverEl !== item) _dragOverEl.classList.remove('drag-over');
        if (item !== _dragSrcEl) { item.classList.add('drag-over'); _dragOverEl = item; }
      };
      item.ondragleave = function () { if (item !== _dragSrcEl) item.classList.remove('drag-over'); };
      item.ondrop = function (e) {
        e.preventDefault();
        if (!_dragSrcEl || _dragSrcEl === item) return;
        var fromIdx = parseInt(_dragSrcEl.getAttribute('data-sidx'), 10);
        var toIdx = parseInt(item.getAttribute('data-sidx'), 10);
        if (isNaN(fromIdx) || isNaN(toIdx)) return;
        // splice 重排
        var moved = arr.splice(fromIdx, 1)[0];
        arr.splice(toIdx, 0, moved);
        if (rerender) rerender();
      };
    });
  }
  /* 辅助：生成带删除按钮的操作行（替代原来 up+dn+rm 三按钮） */
  function sortActions(arr, i, rerender, confirmMsg, onDel) {
    var wrap = el('div', 'field-row sort-actions');
    var rm = el('button', 'btn-danger btn-mini', '删');
    rm.onclick = function () { if (confirmMsg ? confirm(confirmMsg) : true) { if (onDel) onDel(); else arr.splice(i, 1); if (rerender) rerender(); } };
    wrap.appendChild(rm);
    return wrap;
  }

  function renderOrder(sel, key, label) {
    var wrap = $(sel); wrap.innerHTML = '';
    var order = DATA[key] || (DATA[key] = []);
    if (key === 'favoritesOrder') {
      var tip = el('p', 'hint', '首页只显示前 3 个（当前 ' + order.length + ' 个）。'
        + '用 ↑↓ 调整顺序决定哪 3 个上首页，第 4 个起仅出现在二级页。');
      tip.style.cssText = 'color:#c8a882;margin:0 0 10px;font-size:12px;line-height:1.7;';
      wrap.appendChild(tip);
    }
    order.forEach(function (id, i) {
      var a = DATA.albums[id]; if (!a) return;
      var item = el('div', 'order-item sortable-item');
      var pre = (key === 'favoritesOrder') ? ((i < 3 ? '首页 ' : '隐藏 ') + (i + 1) + '. ') : '';
      item.appendChild(el('div', 'oi-title', pre + esc(a.title || id)));
      var rm = el('button', 'btn-danger', '移出'); rm.onclick = function () { order.splice(i, 1); renderOrder(sel, key, label); };
      item.appendChild(rm);
      wrap.appendChild(item);
    });
    makeSortable(wrap, order, function () { renderOrder(sel, key, label); });
    // 添加
    var opts = Object.keys(DATA.albums).filter(function (id) { return order.indexOf(id) < 0; })
      .map(function (id) { return '<option value="' + esc(id) + '">' + esc(DATA.albums[id].title || id) + '</option>'; }).join('');
    if (opts) {
      var addRow = el('div', 'order-item');
      addRow.appendChild(el('div', 'oi-title', '添加到「' + label + '」：'));
      var sel2 = document.createElement('select'); sel2.innerHTML = opts;
      var ab = el('button', 'btn-mini', '添加'); ab.onclick = function () { order.push(sel2.value); renderOrder(sel, key, label); };
      addRow.appendChild(sel2); addRow.appendChild(ab);
      wrap.appendChild(addRow);
    }
    if (!order.length && !opts) wrap.appendChild(el('p', 'hint', '暂无相册。'));
  }

  function renderPlaces() {
    DATA.places = DATA.places || {};
    DATA.places.provinces = DATA.places.provinces || {};
    DATA.places.abroad = DATA.places.abroad || {};
    renderProvinces(); renderAbroad();
  }

  function albumOptions(selected) {
    return '<option value="">（不跳转）</option>' + Object.keys(DATA.albums).map(function (id) {
      return '<option value="' + esc(id) + '"' + (selected === id ? ' selected' : '') + '>' + esc(DATA.albums[id].title || id) + '</option>';
    }).join('');
  }

  function renderProvinces() {
    var wrap = $('#placeLit'); wrap.innerHTML = '';

    /* ===== 精选足迹管理（首页 Featured 卡片） ===== */
    var fHead = el('div', 'tab-head');
    fHead.appendChild(el('h3', 'sub-h', '精选足迹（首页 Featured 卡片）'));
    wrap.appendChild(fHead);
    wrap.appendChild(el('p', 'hint', '拖拽调整顺序；选择省份和对应相册。留空则自动 fallback 到有相册的省份。'));
    var fWrap = el('div', 'order-list');
    var featured = DATA.places.featured || (DATA.places.featured = []);
    featured.forEach(function (f, i) {
      var prov = DATA.places.provinces[f.province];
      var item = el('div', 'order-item sortable-item');
      // 省份选择
      var pSel = document.createElement('select');
      pSel.style.flex = '1';
      pSel.innerHTML = Object.keys(DATA.places.provinces).map(function (pk) {
        return '<option value="' + pk + '"' + (pk === f.province ? ' selected' : '') + '>' + esc((DATA.places.provinces[pk].name || pk)) + '</option>';
      }).join('');
      pSel.onchange = function () { f.province = pSel.value; };
      item.appendChild(pSel);
      // 相册选择（根据选中省份动态更新）
      function buildAlbumOpts() {
        var provData = DATA.places.provinces[pSel.value];
        var albumIds = [];
        if (provData && provData.cities) {
          Object.keys(provData.cities).forEach(function (ck) {
            var al = provData.cities[ck].albums || [];
            al.forEach(function (aid) { if (albumIds.indexOf(aid) < 0) albumIds.push(aid); });
          });
        }
        aSel.innerHTML = '<option value="">默认首个</option>' + albumIds.map(function (aid) {
          var aa = DATA.albums[aid];
          return '<option value="' + aid + '"' + (aid === f.albumId ? ' selected' : '') + '>' + esc(aa ? aa.title : aid) + '</option>';
        }).join('');
      }
      var aSel = document.createElement('select');
      aSel.style.flex = '2'; aSel.style.minWidth = '140px';
      buildAlbumOpts();
      aSel.onchange = function () { f.albumId = aSel.value || null; };
      pSel.onchange = function () { f.province = pSel.value; buildAlbumOpts(); f.albumId = null; };
      item.appendChild(aSel);
      // 删除
      var rm = el('button', 'btn-danger btn-mini', '移'); rm.style.marginLeft = '8px';
      rm.onclick = function () { featured.splice(i, 1); renderProvinces(); };
      item.appendChild(rm);
      fWrap.appendChild(item);
    });
    // 添加新精选
    var addFRow = el('div', 'order-item');
    var addPSel = document.createElement('select');
    addPSel.innerHTML = '<option value="">选择省份…</option>' + Object.keys(DATA.places.provinces).map(function (pk) {
      return '<option value="' + pk + '">' + esc(DATA.places.provinces[pk].name || pk) + '</option>';
    }).join('');
    addFRow.appendChild(addPSel);
    var addBtn = el('button', 'btn-mini', '+ 添加到精选');
    addBtn.onclick = function () {
      if (!addPSel.value) { toast('请先选择省份'); return; }
      featured.push({ province: addPSel.value, albumId: null });
      renderProvinces();
    };
    addFRow.appendChild(addBtn);
    fWrap.appendChild(addFRow);
    wrap.appendChild(fWrap);
    makeSortable(fWrap, featured, renderProvinces);

    /* ===== 省份详情编辑 ===== */
    Object.keys(DATA.places.provinces).forEach(function (k) {
      var p = DATA.places.provinces[k];
      var item = el('div', 'place-item province-item');
      item.appendChild(el('div', 'oi-title', '省份：' + esc(p.name || k)));
      // key（只读）
      var keyRow = el('div', 'field-row');
      keyRow.appendChild(el('label', '', 'ID'));
      var keyIn = inp('text', k, null); keyIn.disabled = true; keyRow.appendChild(keyIn);
      item.appendChild(keyRow);
      // 名称 / x / y
      var row = el('div', 'field-row');
      row.appendChild(el('label', '', '名称'));
      row.appendChild(inp('text', p.name || '', function (v) { p.name = v; renderProvinces(); }));
      row.appendChild(el('label', '', 'X'));
      row.appendChild(inp('number', p.cx || 0, function (v) { p.cx = Number(v); }));
      row.appendChild(el('label', '', 'Y'));
      row.appendChild(inp('number', p.cy || 0, function (v) { p.cy = Number(v); }));
      item.appendChild(row);
      // 经纬度（真实地图定位用，GCJ-02）
      var gRow = el('div', 'field-row');
      gRow.appendChild(el('label', '', '经度'));
      gRow.appendChild(inp('number', p.lng || '', function (v) { p.lng = parseFloat(v); }));
      gRow.appendChild(el('label', '', '纬度'));
      gRow.appendChild(inp('number', p.lat || '', function (v) { p.lat = parseFloat(v); }));
      item.appendChild(gRow);
      // 简介（省份页标题下的文字，留空则不显示）
      var iRow = el('div', 'field-row');
      iRow.appendChild(el('label', '', '简介'));
      var iTa = document.createElement('textarea');
      iTa.rows = 3; iTa.value = p.intro || '';
      iTa.oninput = function(){ p.intro = iTa.value; };
      iRow.appendChild(iTa);
      item.appendChild(iRow);
      // 省份页背景图
      var hRow = el('div', 'field-row');
      hRow.appendChild(el('label', '', '背景图'));
      var hIn = inp('text', p.hero || '', function(v){ p.hero = v; });
      hIn.style.flex = '1'; hIn.placeholder = '如 assets/images/provinces/anhui-hero.jpg，留空则无背景';
      hRow.appendChild(hIn);
      if(p.hero){
        var hImg = document.createElement('img');
        hImg.src = p.hero; hImg.alt = '';
        hImg.style.cssText = 'max-height:80px;max-width:140px;border-radius:4px;object-fit:cover;display:block;';
        hRow.appendChild(hImg);
      }
      var hBtn = el('button', 'btn-mini', p.hero ? '替换背景图' : '上传背景图');
      hBtn.onclick = function(){
        pickFile(false, function(files){
          uploadOne('_places/provinces/' + k, files[0], function(r){
            var path = (typeof r === 'string') ? r : (r && r.src);
            if(path){ p.hero = path; renderProvinces(); }
          });
        }, 'image/*');
      };
      hRow.appendChild(hBtn);
      item.appendChild(hRow);
      // 城市
      var cities = p.cities || (p.cities = {});
      var cityWrap = el('div', 'city-wrap');
      Object.keys(cities).forEach(function (ck) {
        var c = cities[ck];
        var block = el('div', 'city-block');
        var cRow = el('div', 'city-row');
        cRow.appendChild(el('span', 'city-id', ck));
        var cName = inp('text', c.name || '', function (v) { c.name = v; });
        cRow.appendChild(cName);
        var cLng = inp('number', c.lng || '', function (v) { c.lng = parseFloat(v); });
        cLng.style.width = '84px'; cLng.placeholder = '经度';
        cRow.appendChild(cLng);
        var cLat = inp('number', c.lat || '', function (v) { c.lat = parseFloat(v); });
        cLat.style.width = '84px'; cLat.placeholder = '纬度';
        cRow.appendChild(cLat);
        var cSel = document.createElement('select');
        cSel.innerHTML = albumOptions((c.albums && c.albums[0]) || '');
        cSel.onchange = function () { c.albums = cSel.value ? [cSel.value] : []; };
        cRow.appendChild(cSel);
        var rm = el('button', 'btn-danger', '删');
        rm.onclick = function () { delete cities[ck]; renderProvinces(); };
        cRow.appendChild(rm);
        block.appendChild(cRow);

        // 城市页背景图（留空则自动取该城市首个相册的主图）
        var chRow = el('div', 'city-hero-row');
        chRow.appendChild(el('label', '', '背景'));
        var chIn = inp('text', c.hero || '', function(v){ c.hero = v; });
        chIn.style.flex = '1'; chIn.placeholder = '市页大图，留空则自动取首个相册';
        chRow.appendChild(chIn);
        if(c.hero){
          var chImg = document.createElement('img');
          chImg.src = c.hero; chImg.alt = '';
          chImg.style.cssText = 'max-height:60px;max-width:100px;border-radius:4px;object-fit:cover;display:block;';
          chRow.appendChild(chImg);
        }
        var chBtn = el('button', 'btn-mini', c.hero ? '替换' : '上传');
        chBtn.onclick = function(){
          pickFile(false, function(files){
            uploadOne('_places/provinces/' + k + '/cities/' + ck, files[0], function(r){
              var path = (typeof r === 'string') ? r : (r && r.src);
              if(path){ c.hero = path; renderProvinces(); }
            });
          }, 'image/*');
        };
        chRow.appendChild(chBtn);
        block.appendChild(chRow);
        cityWrap.appendChild(block);
      });
      item.appendChild(cityWrap);
      // 添加城市
      var addC = el('button', 'btn-mini', '+ 添加城市');
      addC.onclick = function () {
        var name = prompt('城市名称：'); if (!name) return;
        var cid = name.toLowerCase().replace(/\s+/g, '-');
        cities[cid] = { name: name, albums: [] };
        renderProvinces();
      };
      item.appendChild(addC);
      // 删除省份
      var rmP = el('button', 'btn-danger', '删除省份');
      rmP.onclick = function () { if (confirm('删除省份「' + (p.name || k) + '」？')) { delete DATA.places.provinces[k]; renderProvinces(); } };
      item.appendChild(rmP);
      wrap.appendChild(item);
    });
  }

  function renderAbroad() {
    var wrap = $('#placeAbroad'); wrap.innerHTML = '';
    Object.keys(DATA.places.abroad).forEach(function (k) {
      var p = DATA.places.abroad[k];
      var item = el('div', 'place-item');
      var row = el('div', 'field-row');
      row.appendChild(el('label', '', 'ID'));
      var keyIn = inp('text', k, null); keyIn.disabled = true; row.appendChild(keyIn);
      row.appendChild(el('label', '', '名称'));
      row.appendChild(inp('text', p.name || '', function (v) { p.name = v; renderAbroad(); }));
      row.appendChild(el('label', '', 'X'));
      row.appendChild(inp('number', p.cx || 0, function (v) { p.cx = Number(v); }));
      row.appendChild(el('label', '', 'Y'));
      row.appendChild(inp('number', p.cy || 0, function (v) { p.cy = Number(v); }));
      row.appendChild(el('label', '', '经度'));
      row.appendChild(inp('number', p.lng || '', function (v) { p.lng = parseFloat(v); }));
      row.appendChild(el('label', '', '纬度'));
      row.appendChild(inp('number', p.lat || '', function (v) { p.lat = parseFloat(v); }));
      item.appendChild(row);
      var selRow = el('div', 'field-row');
      selRow.appendChild(el('label', '', '默认相册'));
      var sel = document.createElement('select');
      sel.innerHTML = albumOptions((p.albums && p.albums[0]) || '');
      sel.onchange = function () { p.albums = sel.value ? [sel.value] : []; };
      selRow.appendChild(sel);
      var rm = el('button', 'btn-danger', '删');
      rm.onclick = function () { if (confirm('删除「' + (p.name || k) + '」？')) { delete DATA.places.abroad[k]; renderAbroad(); } };
      selRow.appendChild(rm);
      item.appendChild(selRow);
      wrap.appendChild(item);
    });
  }

  /* ---------- 文件选择 ---------- */
  var pending = null;
  function pickFile(multiple, cb, accept) {
    pending = cb;
    var fi = $('#fileInput'); fi.multiple = multiple; fi.value = '';
    fi.accept = accept || 'image/*';
    fi.onchange = function () { if (fi.files && fi.files.length) cb(fi.files); pending = null; };
    fi.click();
  }
  function uploadOne(albumId, file, done) {
    if (MODE === 'gh') return phoneUpload(albumId, file, done);
    toast('压缩并上传中…' + file.name);
    Promise.resolve(compressImage(file)).then(function (blob) {
      if (blob) {
        var nm = file.name, dot = nm.lastIndexOf('.');
        nm = (dot > 0 ? nm.slice(0, dot) : nm) + '.jpg';
        return readFileAsDataURL(blob).then(function (du) { return upload(albumId, nm, du); });
      }
      return readFileAsDataURL(file).then(function (du) { return upload(albumId, file.name, du); });
    }).then(function (r) {
      if (r.ok) done(r.path); else toast('上传失败：' + (r.error || ''));
    }).catch(function (e) { toast('上传出错：' + e.message); });
  }

  /* ---------- 事件绑定 ---------- */
  function bind() {
    $('#loginBtn').onclick = doLogin;
    $('#pass').addEventListener('keydown', function (e) { if (e.key === 'Enter') doLogin(); });
    $('#logout').onclick = function () {
      TOKEN = ''; GH_TOKEN = '';
      localStorage.removeItem('tm_token'); localStorage.removeItem('tm_gh_token');
      location.reload();
    };
    $('#saveAll').onclick = function () {
      // 收集网站设置
      DATA.site = DATA.site || {};
      DATA.site.name = $('#s-name').value;
      DATA.site.intro = $('#s-intro').value.replace(/\n/g, '<br>');
      DATA.site.heroVideo = $('#s-hero').value;
      DATA.site.introAudio = $('#s-audio').value;
      if ($('#s-mapkey')) DATA.site.mapKey = ($('#s-mapkey').value || '').trim();
      // 收集归档影片区头信息
      DATA.films = DATA.films || {};
      DATA.films.title = $('#f-title').value;
      DATA.films.subtitle = $('#f-subtitle').value;
      DATA.films.intro = $('#f-intro').value.replace(/\n/g, '<br>');
      saveAll();
    };
    $('#newVideo').onclick = function () {
      var title = prompt('新影片标题：', '新影片'); if (!title) return;
      DATA.site = DATA.site || {}; DATA.site.videos = DATA.site.videos || [];
      DATA.site.videos.push({ src: '', sub: '', title: title, desc: '' });
      renderVideos();
    };
    $('#newFilm').onclick = function () {
      var title = prompt('归档影片标题：', '新归档影片'); if (!title) return;
      DATA.films = DATA.films || {};
      DATA.films.items = DATA.films.items || [];
      DATA.films.items.push({ src: '', title: title, desc: '' });
      renderFilms();
    };
    $('#newAlbum').onclick = function () {
      var title = prompt('新相册标题：', '新相册'); if (!title) return;
      var id = 'album-' + Date.now();
      DATA.albums[id] = { id: id, title: title, place: '', date: '', desc: '', hero: '', story: [], photos: [] };
      DATA.galleryOrder = DATA.galleryOrder || [];
      DATA.galleryOrder.push(id);
      renderAlbums();
    };
    // 网站设置里的上传（hero / audio）
    $all('[data-upload]').forEach(function (b) {
      b.onclick = function () {
        var kind = b.getAttribute('data-upload');
        var acc = kind === 'hero' ? 'video/mp4,video/*' : (kind === 'audio' ? 'audio/*' : 'image/*');
        pickFile(false, function (files) {
          var f = files[0];
          if (kind === 'hero' && f.size > 30 * 1024 * 1024
              && !confirm('这个视频超过 30MB，直接上传不会压缩，可能导致首页加载慢甚至同步失败。\\n\\n建议让阿布用脚本压缩后上线（更快更稳）。仍要直接上传吗？')) return;
          uploadOne('site', f, function (path) {
            if (kind === 'hero') { DATA.site.heroVideo = path; $('#s-hero').value = path; }
            else { DATA.site.introAudio = path; $('#s-audio').value = path; }
            toast('已上传');
          });
        }, acc);
      };
    });
    // 地点添加
    $('#addLit').onclick = function () {
      var name = prompt('新省份名称：'); if (!name) return;
      var id = name.toLowerCase().replace(/\s+/g, '-');
      DATA.places.provinces[id] = { name: name, cx: 400, cy: 300, cities: {} };
      renderPlaces();
    };
    $('#addAbroad').onclick = function () {
      var name = prompt('新国家/地区名称：'); if (!name) return;
      var id = name.toLowerCase().replace(/\s+/g, '-');
      DATA.places.abroad[id] = { name: name, cx: 760, cy: 260, albums: [] };
      renderPlaces();
    };
    // 侧栏切换
    $all('.side-nav a').forEach(function (a) {
      a.onclick = function () {
        $all('.side-nav a').forEach(function (x) { x.classList.remove('active'); });
        a.classList.add('active');
        var tab = a.getAttribute('data-tab');
        $all('.tab').forEach(function (t) { t.classList.toggle('hidden', t.getAttribute('data-tab') !== tab); });
      };
    });
  }

  bind();
  guardStaticHost();
  watchUploadUI();
  if (MODE === 'gh' && $('#saveAll') && !$('#pullLatest')) {
    var pb = document.createElement('button');
    pb.id = 'pullLatest'; pb.className = 'btn-primary'; pb.textContent = '拉取线上最新';
    pb.style.marginLeft = '8px';
    pb.onclick = pullLatest;
    var sb = $('#saveAll');
    sb.parentNode.insertBefore(pb, sb.nextSibling);
  }
  // 若已有 token，尝试直接进入
  if (TOKEN) {
    fetch(BASE + '/api/data', { headers: { 'x-admin-token': TOKEN } }).then(function (r) {
      if (r.ok) { $('#login').classList.add('hidden'); $('#panel').classList.remove('hidden'); load(); }
    }).catch(function () {});
  }
})();

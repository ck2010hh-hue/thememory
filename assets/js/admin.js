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
  function getJSON() { return fetch(BASE + '/api/data').then(function (r) { return r.json(); }); }

  // 静态站模式：登录框改成 GitHub Token 入口
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
    renderAll();
  }

  function saveAll() {
    if (MODE === 'gh') {
      if (!GH_TOKEN) { toast('请先填入 GitHub Token'); return; }
      toast('正在保存…');
      var p = '/repos/' + GH.owner + '/' + GH.repo + '/contents/' + GH.path;
      return ghApi('GET', p + '?ref=' + GH.branch).then(function (g) {
        if (!g.ok) throw new Error('读取远端失败 ' + g.status);
        GH_SHA = g.j.sha;
        return ghApi('PUT', p, {
          message: 'update data.json via admin',
          content: b64(JSON.stringify(DATA, null, 2)),
          sha: GH_SHA,
          branch: GH.branch
        });
      }).then(function (res) {
        if (res.ok) { GH_SHA = res.j.content && res.j.content.sha; toast('已保存 ✓ 约 1 分钟后生效'); }
        else toast('保存失败：' + ((res.j && res.j.message) || res.status));
      }).catch(function (e) { toast('保存出错：' + e.message); });
    }
    return api('PUT', '/api/data', DATA).then(function (r) {
      if (r.ok) toast('已保存 ✓ 并同步到云端'); else toast('保存失败');
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
    getJSON().then(function (d) {
      DATA = d; renderAll();
    }).catch(function (e) { toast('读取数据失败：' + e.message); });
  }

  /* ---------- 渲染 ---------- */
  function renderAll() {
    renderSite(); renderAlbums(); renderOrder('#favOrder', 'favoritesOrder', '首页收藏');
    renderOrder('#galOrder', 'galleryOrder', '图集'); renderPlaces();
  }

  function renderSite() {
    var s = DATA.site || (DATA.site = {});
    $('#s-name').value = s.name || '';
    $('#s-intro').value = (s.intro || '').replace(/<br>/g, '\n');
    $('#s-hero').value = s.heroVideo || '';
    $('#s-audio').value = s.introAudio || '';
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
    hb.onclick = function () { pickFile(false, function (files) { uploadOne(a.id, files[0], function (path) { a.hero = path; hi.value = path; toast('主图已设'); }); }); };
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
      var rr = el('div', 'row'); rr.style.marginBottom = '8px';
      var up = el('button', 'btn-mini', '↑'); up.onclick = function () { swap(a.story, i, i - 1); renderAlbums(); };
      var dn = el('button', 'btn-mini', '↓'); dn.onclick = function () { swap(a.story, i, i + 1); renderAlbums(); };
      var rm = el('button', 'btn-danger', '删'); rm.onclick = function () { a.story.splice(i, 1); renderAlbums(); };
      rr.appendChild(up); rr.appendChild(dn); rr.appendChild(rm); rr.appendChild(ta);
      story.appendChild(rr);
    });
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
      Array.prototype.forEach.call(files, function (f) {
        uploadOne(a.id, f, function (path) { a.photos = a.photos || []; a.photos.push({ src: path, cap: f.name.replace(/\.[^.]+$/, '') }); renderAlbums(); });
      });
    }); };
    pmh.appendChild(upBtn);
    pm.appendChild(pmh);

    var grid = el('div', 'photo-grid');
    (a.photos || []).forEach(function (p, i) {
      var cell = el('div', 'photo-cell' + (a.hero === p.src ? ' is-hero' : ''));
      if (a.hero === p.src) cell.appendChild(el('div', 'hero-badge', '主图'));
      cell.appendChild(el('img', null, '').cloneNode(false)); // placeholder
      var im = cell.querySelector('img') || document.createElement('img');
      im.src = p.src; im.alt = ''; cell.insertBefore(im, cell.firstChild);
      cell.appendChild(el('div', 'pc-cap', esc(p.cap || '')));
      var acts = el('div', 'pc-actions');
      var shero = el('button', null, '设主图'); shero.onclick = function () { a.hero = p.src; renderAlbums(); };
      var sup = el('button', null, '↑'); sup.onclick = function () { swap(a.photos, i, i - 1); renderAlbums(); };
      var sdn = el('button', null, '↓'); sdn.onclick = function () { swap(a.photos, i, i + 1); renderAlbums(); };
      var srm = el('button', null, '删'); srm.onclick = function () {
        if (!confirm('删除这张照片？')) return;
        delMedia(p.src.replace(/^media\//, 'media/'));
        a.photos.splice(i, 1); renderAlbums();
      };
      acts.appendChild(sup); acts.appendChild(sdn); acts.appendChild(shero); acts.appendChild(srm);
      cell.appendChild(acts);
      grid.appendChild(cell);
    });
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

  function renderOrder(sel, key, label) {
    var wrap = $(sel); wrap.innerHTML = '';
    var order = DATA[key] || (DATA[key] = []);
    order.forEach(function (id, i) {
      var a = DATA.albums[id]; if (!a) return;
      var item = el('div', 'order-item');
      item.appendChild(el('div', 'oi-title', esc(a.title || id)));
      var up = el('button', 'btn-mini', '↑'); up.onclick = function () { swap(order, i, i - 1); renderOrder(sel, key, label); };
      var dn = el('button', 'btn-mini', '↓'); dn.onclick = function () { swap(order, i, i + 1); renderOrder(sel, key, label); };
      var rm = el('button', 'btn-danger', '移出'); rm.onclick = function () { order.splice(i, 1); renderOrder(sel, key, label); };
      item.appendChild(up); item.appendChild(dn); item.appendChild(rm);
      wrap.appendChild(item);
    });
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
      // 城市
      var cities = p.cities || (p.cities = {});
      var cityWrap = el('div', 'city-wrap');
      Object.keys(cities).forEach(function (ck) {
        var c = cities[ck];
        var cRow = el('div', 'city-row');
        cRow.appendChild(el('span', 'city-id', ck));
        var cName = inp('text', c.name || '', function (v) { c.name = v; });
        cRow.appendChild(cName);
        var cSel = document.createElement('select');
        cSel.innerHTML = albumOptions((c.albums && c.albums[0]) || '');
        cSel.onchange = function () { c.albums = cSel.value ? [cSel.value] : []; };
        cRow.appendChild(cSel);
        var rm = el('button', 'btn-danger', '删');
        rm.onclick = function () { delete cities[ck]; renderProvinces(); };
        cRow.appendChild(rm);
        cityWrap.appendChild(cRow);
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
  function pickFile(multiple, cb) {
    pending = cb;
    var fi = $('#fileInput'); fi.multiple = multiple; fi.value = '';
    fi.onchange = function () { if (fi.files && fi.files.length) cb(fi.files); pending = null; };
    fi.click();
  }
  function uploadOne(albumId, file, done) {
    toast('上传中…' + file.name);
    readFileAsDataURL(file).then(function (dataUrl) {
      return upload(albumId, file.name, dataUrl);
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
      saveAll();
    };
    $('#newAlbum').onclick = function () {
      var title = prompt('新相册标题：', '新相册'); if (!title) return;
      var id = 'album-' + Date.now();
      DATA.albums[id] = { id: id, title: title, place: '', date: '', desc: '', hero: '', story: [], photos: [] };
      renderAlbums();
    };
    // 网站设置里的上传（hero / audio）
    $all('[data-upload]').forEach(function (b) {
      b.onclick = function () {
        var kind = b.getAttribute('data-upload');
        pickFile(false, function (files) {
          uploadOne('site', files[0], function (path) {
            if (kind === 'hero') { DATA.site.heroVideo = path; $('#s-hero').value = path; }
            else { DATA.site.introAudio = path; $('#s-audio').value = path; }
            toast('已上传');
          });
        });
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
  // 若已有 token，尝试直接进入
  if (TOKEN) {
    fetch(BASE + '/api/data', { headers: { 'x-admin-token': TOKEN } }).then(function (r) {
      if (r.ok) { $('#login').classList.add('hidden'); $('#panel').classList.remove('hidden'); load(); }
    }).catch(function () {});
  }
})();

/* The Memory — 数据驱动渲染 + 交互 */
(function(){
  'use strict';
  var DATA = null;
  var API = 'api/data';
  var TOKEN = localStorage.getItem('tm_token') || '';
  /* 首页 FAVORITES 最多显示几个（2026-09-07 用户定：只留 3 个）。
     多余的收藏不会丢，仍按后台顺序保留，只是首页不渲染；
     想改数量改这个数字即可（想全部显示改成 999）。 */
  var MAX_FAV = 3;

  function esc(s){ return (s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
  function getJSON(url){ return fetch(url + '?t=' + Date.now(), {cache:'no-store', headers:{'x-admin-token':TOKEN}}).then(function(r){ return r.json(); }); }

  /* ---------- CDN 前缀：data.json 只存相对路径，换域名只改 cdnBase ---------- */
  var CDN_BASE = '', MEDIA_BASE = '';
  function isMediaFile(p){
    return /\.(mp4|mov|webm|wav|mp3|m4a|ogg)$/i.test(p || '');
  }
  function encPath(p){
    // 对路径中的每一级做 URL 编码，保留斜杠；避免文件名里的空格/括号破坏 URL
    return p.split('/').map(function(s){ return encodeURIComponent(s); }).join('/');
  }
  function abs(p){
    if(!p) return p;
    if(/^https?:\/\//i.test(p) || p.indexOf('//')===0) return p;
    // 全部资源优先走国内 COS；COS 不可用时 fallback 到 jsDelivr/GitHub
    var base = MEDIA_BASE || CDN_BASE;
    return base + encPath(p);
  }
  function applyCdn(d){
    CDN_BASE = (d.site && d.site.cdnBase) || '';
    MEDIA_BASE = (d.site && d.site.mediaBase) || '';
    if(!CDN_BASE && !MEDIA_BASE) return d;
    if(d.site){
      if(d.site.heroVideo) d.site.heroVideo = abs(d.site.heroVideo);
      if(d.site.introAudio) d.site.introAudio = abs(d.site.introAudio);
      if(d.site.bgmList) d.site.bgmList = d.site.bgmList.map(function(u){ return abs(u); });
      if(d.site.videos) d.site.videos.forEach(function(v){ v.src = abs(v.src); });
    }
    if(d.films && d.films.items) d.films.items.forEach(function(v){ if(v.src) v.src = abs(v.src); });
    if(d.moments){
      if(d.moments.hero) d.moments.hero = abs(d.moments.hero);
      (d.moments.items||[]).forEach(function(m){
        if(m.media) m.media = abs(m.media);
      });
    }
    Object.keys(d.albums||{}).forEach(function(k){
      var a = d.albums[k];
      if(a.hero) a.hero = abs(a.hero);
      (a.photos||[]).forEach(function(p){
        if(p.src) p.src = abs(p.src);
        if(p.thumb) p.thumb = abs(p.thumb);
      });
      if(a.heroThumb) a.heroThumb = abs(a.heroThumb);
    });
    return d;
  }

  /* ---------- 资源加载失败自动回退：当 CDN_BASE 与 MEDIA_BASE 不同时，失败时互相回退 ---------- */
  document.addEventListener('error', function(e){
    var el = e.target;
    if(!el || (el.tagName !== 'IMG' && el.tagName !== 'VIDEO' && el.tagName !== 'SOURCE' && el.tagName !== 'AUDIO')) return;
    var src = el.src || el.currentSrc || el.getAttribute('src');
    if(!src) return;
    // 两个 base 相同或只有一个配置时不回退；避免重复请求同一地址死循环
    if(!MEDIA_BASE || !CDN_BASE || MEDIA_BASE === CDN_BASE) return;
    // 避免无限回退
    if(el.dataset._tmFb === '1') return;
    var fb = '';
    if(src.indexOf(MEDIA_BASE) === 0){
      fb = src.replace(MEDIA_BASE, CDN_BASE);
    } else if(src.indexOf(CDN_BASE) === 0){
      fb = src.replace(CDN_BASE, MEDIA_BASE);
    }
    if(fb && fb !== src){
      el.dataset._tmFb = '1';
      console.log('[TM fallback]', src, '->', fb);
      if(el.tagName === 'SOURCE') el.src = fb; else el.src = fb;
      // video 需要重新加载
      if(el.tagName === 'VIDEO' || el.tagName === 'SOURCE'){
        var v = el.tagName === 'SOURCE' ? el.parentNode : el;
        if(v && v.load) try { v.load(); } catch(err){}
      }
    }
  }, true);

  /* 卡片/列表封面统一用缩略图，灯箱与详情页大图才用原尺寸 */
  function coverThumb(a){
    if(a.heroThumb) return a.heroThumb;
    var p = (a.photos||[])[0];
    if(p && p.thumb) return p.thumb;
    if(p && p.src) return p.src;
    return a.hero || '';
  }

  /* ---------- 图片亮度检测（用于 Hero 文字深浅自适应） ----------
     以图片中心区域亮度为主（文字所在位置），全局亮度为辅；
     阈值 150：只有中心明显偏亮才用深色字，否则默认浅色字更保险。
  */
  function detectImageBrightness(url, cb){
    var img = new Image();
    try {
      var u = new URL(url, location.href);
      if(u.origin !== location.origin) img.crossOrigin = 'anonymous';
    } catch(e){}
    img.onload = function(){
      var cv = document.createElement('canvas');
      var w = 120, h = Math.round(img.naturalHeight / img.naturalWidth * 120) || 120;
      cv.width = w; cv.height = h;
      var ctx = cv.getContext('2d');
      ctx.drawImage(img, 0, 0, w, h);
      try {
        var data = ctx.getImageData(0, 0, w, h).data;
        var sumAll = 0, sumCenter = 0, nAll = 0, nCenter = 0;
        var x1 = Math.floor(w * 0.30), x2 = Math.floor(w * 0.70);
        var y1 = Math.floor(h * 0.30), y2 = Math.floor(h * 0.70);
        for(var y=0; y<h; y++){
          for(var x=0; x<w; x++){
            var i = ((y*w) + x) * 4;
            var l = 0.299*data[i] + 0.587*data[i+1] + 0.114*data[i+2];
            sumAll += l; nAll++;
            if(x >= x1 && x <= x2 && y >= y1 && y <= y2){ sumCenter += l; nCenter++; }
          }
        }
        var avgAll = nAll ? (sumAll/nAll) : 128;
        var avgCenter = nCenter ? (sumCenter/nCenter) : 128;
        var brightness = avgCenter * 0.65 + avgAll * 0.35;
        cb(null, brightness);
      } catch(e){ cb(null, 128); }
    };
    img.onerror = function(){ cb(null, 128); };
    img.src = url;
  }

  /* ---------- 中国地图：简化轮廓（可替换为精确 GeoJSON/SVG） ---------- */
  function chinaOutlinePath(){
    // 风格化简化轮廓，含台湾、海南、香港、澳门示意；未来可替换为标准省界 SVG
    return 'M80,180 C110,130 180,100 260,120 C340,90 430,100 510,130 C580,120 650,150 690,200 C730,250 735,330 700,390 C660,450 600,490 530,510 C470,540 400,530 340,500 C270,520 210,500 170,450 C120,430 90,370 85,310 C70,260 70,220 80,180 Z'
      // 台湾
      + ' M720,360 L740,350 L745,390 L725,400 Z'
      // 海南
      + ' M430,480 L460,470 L465,510 L435,520 Z'
      // 香港/澳门区域示意
      + ' M545,455 L555,450 L558,465 L548,470 Z';
  }

  /* ---------- 地理投影：GeoJSON(lng/lat) → SVG(x/y) ---------- */
  var _chinaGeo = null;
  function getChinaGeo(){
    if(_chinaGeo) return Promise.resolve(_chinaGeo);
    var CK = 'tm_china_geo_v2';
    try { var c = localStorage.getItem(CK); if(c){ _chinaGeo = JSON.parse(c); return Promise.resolve(_chinaGeo); } } catch(e){}
    function fetchDataV(){ return fetch('https://geo.datav.aliyun.com/areas_v3/bound/100000_full.json').then(function(r){ return r.json(); }); }
    return fetch('assets/maps/china.json')
      .then(function(r){ return r.json(); })
      .catch(fetchDataV)
      .then(function(g){ _chinaGeo = g; try{ localStorage.setItem(CK, JSON.stringify(g)); }catch(e){} return g; })
      .catch(function(){ return null; });
  }
  function _scanCoords(c, b){
    if(typeof c[0]==='number'){ var l=c[0],a=c[1];
      if(l<b.minLng)b.minLng=l; if(l>b.maxLng)b.maxLng=l; if(a<b.minLat)b.minLat=a; if(a>b.maxLat)b.maxLat=a;
    } else if(Array.isArray(c)){ for(var i=0;i<c.length;i++) _scanCoords(c[i],b); }
  }
  function geoBounds(geo){
    var b={minLng:180,maxLng:-180,minLat:90,maxLat:-90};
    var root = (geo && geo.type==='FeatureCollection' && geo.features) ? geo.features : [geo];
    root.forEach(function(f){ if(f && f.geometry) _scanCoords(f.geometry.coordinates, b); });
    return b;
  }
  function makeProjection(geo, W, H, pad){
    var b=geoBounds(geo);
    var spanLng=b.maxLng-b.minLng, spanLat=b.maxLat-b.minLat;
    var s=Math.min((W-2*pad)/spanLng,(H-2*pad)/spanLat);
    var offX=pad+((W-2*pad)-s*spanLng)/2;
    var offY=pad+((H-2*pad)-s*spanLat)/2;
    return { bounds:b, proj:function(lng,lat){ return [offX+(lng-b.minLng)*s, offY+(b.maxLat-lat)*s]; } };
  }
  function featurePath(feature, pr){
    var g=feature.geometry; if(!g||!g.coordinates) return '';
    var polys = g.type==='MultiPolygon'? g.coordinates : (g.type==='Polygon'? [g.coordinates] : []);
    var d='';
    polys.forEach(function(poly){ poly.forEach(function(ring){
      if(!ring.length) return;
      ring.forEach(function(c,i){ var pt=pr.proj(c[0],c[1]); d += (i===0?'M':'L')+pt[0].toFixed(1)+','+pt[1].toFixed(1)+' '; });
      d += 'Z ';
    });});
    return d.trim();
  }
  function isNationalBoundaryFeature(f){
    var ad = f.properties && f.properties.adcode;
    return ad === '100000_JD' || ad === 100000 || ad === '100000' || !(f.properties && f.properties.name);
  }
  function featureCenter(feature, pr){ var b=geoBounds(feature); return pr.proj((b.minLng+b.maxLng)/2,(b.minLat+b.maxLat)/2); }

  /* ---------- 渲染：可复用的中国地图 ---------- */
  /* ---------- 腾讯地图（合规底图；key 由后台 site.mapKey 配置）----------
     未配置 key 时自动降级为原有示意轮廓，页面不会空白。
     坐标系：GCJ-02。禁止改用 OSM / Google 等无资质底图。 */
  var tmapPromise = null;
  function loadTMap(key){
    if(window.TMap) return Promise.resolve(window.TMap);
    if(tmapPromise) return tmapPromise;
    tmapPromise = new Promise(function(res, rej){
      var s = document.createElement('script');
      s.src = 'https://map.qq.com/api/gljs?v=1.exp&key=' + encodeURIComponent(key);
      s.onload = function(){ window.TMap ? res(window.TMap) : rej(new Error('SDK 未就绪')); };
      s.onerror = function(){ rej(new Error('地图 SDK 加载失败')); };
      document.head.appendChild(s);
    });
    return tmapPromise;
  }
  function dotIcon(color, size){
    size = size || 22;
    var svg = '<svg xmlns="http://www.w3.org/2000/svg" width="' + size + '" height="' + size + '">'
      + '<circle cx="' + size/2 + '" cy="' + size/2 + '" r="' + (size/2 - 4) + '" fill="' + color + '" stroke="#fff" stroke-width="2"/></svg>';
    return { width: size, height: size, src: 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg) };
  }
  var MAP_FILTER = 'grayscale(.35) sepia(.22) saturate(.85) brightness(1.03)';
  function mountMapHost(el, id, height){
    var host = el.parentNode;
    var old = document.getElementById(id);
    if(old && old.parentNode) old.parentNode.removeChild(old);
    var div = document.createElement('div');
    div.id = id;
    div.style.cssText = 'width:100%;height:' + height + ';border-radius:12px;overflow:hidden;filter:' + MAP_FILTER + ';';
    el.style.display = 'none';
    host.appendChild(div);
    return div;
  }
  function addTMapPoints(TMap, map, points, onClick){
    var geos = [], labels = [];
    points.forEach(function(p, i){
      geos.push({ id: 'm' + i, styleId: p.lit ? 'lit' : 'dim', position: new TMap.LatLng(p.lat, p.lng) });
      labels.push({ id: 'l' + i, styleId: 'lb', position: new TMap.LatLng(p.lat, p.lng), content: p.name });
    });
    if(!geos.length) return;
    var mk = new TMap.MultiMarker({
      map: map,
      styles: {
        lit:  new TMap.MarkerStyle(dotIcon('#C8A882')),
        dim:  new TMap.MarkerStyle(dotIcon('#A79A8E')),
        hlit: new TMap.MarkerStyle(dotIcon('#B08A55', 32)),
        hdim: new TMap.MarkerStyle(dotIcon('#857463', 32))
      },
      geometries: geos
    });
    /* hover 高亮：悬浮放大加深，移开恢复 */
    function hoverStyle(gid, hover){
      for(var i = 0; i < geos.length; i++){
        if(geos[i].id !== gid) continue;
        var base = geos[i].styleId === 'lit' || geos[i].styleId === 'hlit' ? 'lit' : 'dim';
        var target = hover ? (base === 'lit' ? 'hlit' : 'hdim') : base;
        mk.updateGeometries([{ id: gid, styleId: target, position: geos[i].position }]);
        var dom = map.getContainer && map.getContainer();
        if(dom) dom.style.cursor = (hover && base === 'lit') ? 'pointer' : '';
        return;
      }
    }
    mk.on('mouseover', function(evt){ if(evt.geometry) hoverStyle(evt.geometry.id, true); });
    mk.on('mouseout',  function(evt){ if(evt.geometry) hoverStyle(evt.geometry.id, false); });
    mk.on('click', function(evt){
      var i = parseInt(String(evt.geometry.id || 'm0').slice(1), 10);
      if(onClick && points[i]) onClick(points[i]);
    });
    new TMap.MultiLabel({
      map: map,
      styles: { lb: new TMap.LabelStyle({ color: '#5a4c40', size: 12, offset: { x: 0, y: 16 } }) },
      geometries: labels
    });
  }

  function renderChinaMap(svgSelector, d, opts){
    opts = opts || {};
    var svg = document.querySelector(svgSelector); if(!svg || !d.places) return;
    var provinces = d.places.provinces || {};
    var W = 1000, H = 820, pad = 36;
    if(opts.mini){ W = 1000; H = 760; pad = 64; }
    svg.setAttribute('viewBox', '0 0 ' + W + ' ' + H);

    getChinaGeo().then(function(geo){
      if(!geo){
        svg.innerHTML = '<path d="'+chinaOutlinePath()+'" class="china-outline'+(opts.mini?' mini':'')+'"/>';
        return;
      }
      var pr = makeProjection(geo, W, H, pad);
      var paths = '', labels = '';
      (geo.features||[]).forEach(function(f){
        if(!f.properties || isNationalBoundaryFeature(f)) return;   // 跳过全国边界 feature，避免覆盖
        var adcode = f.properties.adcode;
        var pk = null;
        Object.keys(provinces).forEach(function(k){ if(String(provinces[k].adcode)===String(adcode)) pk=k; });
        // 只有该省份下存在有相册的城市，才高亮为"去过"
        var hasAlbums = false;
        if(pk){
          var cities = provinces[pk].cities || {};
          Object.keys(cities).forEach(function(ck){
            if((cities[ck].albums||[]).length) hasAlbums = true;
          });
        }
        var visited = hasAlbums;
        var path = featurePath(f, pr);
        if(!path) return;
        var cls = 'cn-prov' + (visited ? ' visited' : '') + (opts.mini ? ' mini' : '');
        var href = pk ? ('province.html?province='+esc(pk)) : 'javascript:void(0)';
        var tag = pk ? 'a' : 'g';
        var click = pk ? '' : ' onclick="return false"';
        paths += '<'+tag+' href="'+href+'" class="'+cls+'"'+click+' data-province="'+esc(pk||'')+'"><path d="'+path+'" fill-rule="evenodd"/></'+tag+'>';
        if(!opts.mini){
          var ctr = featureCenter(f, pr);
          var name = pk ? provinces[pk].name : (f.properties.name || '');
          if(name){
            labels += '<text class="cn-label'+(visited?' visited':'')+'" x="'+ctr[0].toFixed(1)+'" y="'+(ctr[1]+4).toFixed(1)+'">'+esc(name)+'</text>';
          }
        }
      });
      svg.innerHTML = '<g class="cn-map-group">' + paths + labels + '</g>';
    }).catch(function(){
      svg.innerHTML = '<path d="'+chinaOutlinePath()+'" class="china-outline'+(opts.mini?' mini':'')+'"/>';
    });
  }

  /* ---------- 渲染：首页 ---------- */
  function renderHome(d){
    var vid = document.querySelector('.hero video');
    if(vid && d.site.heroVideo){
      vid.muted = true;
      vid.setAttribute('muted', '');
      vid.setAttribute('playsinline', '');
      vid.src = d.site.heroVideo;
      try { vid.load(); } catch(e){}
      try { var pp = vid.play(); if(pp && pp.catch) pp.catch(function(){}); } catch(e){}
      vid.addEventListener('error', function(){
        console.error('[TM] hero video load error', vid.error && vid.error.code, vid.src);
      }, {once:true});
    }
    var poem = document.querySelector('.intro .poem');
    if(poem) poem.innerHTML = (d.site.intro||'').replace(/\n/g,'<br>');
    var at = document.querySelector('.intro .audio-toggle');
    if(at && d.site.introAudio) at.setAttribute('data-audio', d.site.introAudio);

    // MOMENTS 首页入口
    if(d.moments){
      var mhBg = document.getElementById('moments-hero-bg');
      var mhTitle = document.getElementById('moments-hero-title');
      var mhSub = document.getElementById('moments-hero-sub');
      if(mhBg && d.moments.hero){
        var heroUrl = d.moments.hero;
        var mhLink = document.querySelector('.moments-hero .mh-link');
        mhBg.src = heroUrl;
        mhBg.onload = function(){
          var w = mhBg.naturalWidth || 16, h = mhBg.naturalHeight || 9;
          if(mhLink) mhLink.style.setProperty('--mh-ratio', w + '/' + h);
        };
        if(CDN_BASE && heroUrl.indexOf(CDN_BASE)===0){
          var probe = new Image();
          probe.onerror = function(){ mhBg.src = heroUrl.slice(CDN_BASE.length); };
          probe.src = heroUrl;
        }
      }
      if(mhTitle) mhTitle.innerHTML = esc(d.moments.title || '').replace(/\n/g, '<br>');
      if(mhSub) mhSub.innerHTML = esc(d.moments.subtitle || '').replace(/\n/g, '<br>');
    }

    // FAVORITES：横向轮播，一次只显示一个收藏相册，左右箭头切换；内部 cover-slider 保留
    var wrap = document.getElementById('fav-list');
    if(wrap){
      var slides = [];
      (d.favoritesOrder||[]).slice(0, MAX_FAV).forEach(function(id, i){
        var a = d.albums[id]; if(!a) return;
        var covers = (a.photos||[]).slice(0, 8).map(function(p){ return p.thumb || p.src; });
        var rev = (i % 2 === 1) ? ' reverse' : '';
        slides.push('<div class="fav-slide'+(i===0?' active':'')+'">'
          + '<article class="album-row'+rev+'">'
          + '<div class="cover-slider" data-imgs=\''+JSON.stringify(covers)+'\'></div>'
          + '<div class="album-info">'
          + '<div class="no">'+esc(a.date ? ('No.'+('0'+(i+1)).slice(-2)) : '')+'</div>'
          + '<h3>'+esc(a.title)+'</h3>'
          + '<div class="meta">'+esc(a.place)+' &nbsp;/&nbsp; '+esc(a.date)+'</div>'
          + '<p class="desc">'+esc(a.desc)+'</p>'
          + '<a class="more" href="album.html?id='+esc(id)+'&from=favorites">看完整游记 →</a>'
          + '</div></article></div>');
      });
      if(!slides.length){
        slides.push('<div class="fav-slide active">'
          + '<article class="album-row"><div class="cover-slider" style="background:var(--bg-soft);display:flex;align-items:center;justify-content:center;color:var(--ink-soft);min-height:360px;"><span style="letter-spacing:.3em;font-size:13px;">No.01 · 待添加</span></div>'
          + '<div class="album-info"><div class="no">No.01</div><h3>即将上线</h3><div class="meta">地点待定</div><p class="desc">在后台「新建相册」即可出现在这里。</p><span class="more" style="opacity:.5;cursor:default;">敬请期待</span></div></article></div>');
      }
      wrap.innerHTML = slides.join('');
      initFavoritesSlider();
    }

    // CHAPTER 02 PLACES：完整中国地图 + 统计 + 精选 + 海外
    if(d.places) renderHomePlaces(d);

    // CHAPTER 03 GALLERY 预览段
    var gt = document.getElementById('gallery-teaser');
    if(gt){
      var gids = (d.galleryOrder||[]).slice(0,6);
      var gcards = gids.map(function(id,i){
        var a = d.albums[id]; if(!a) return '';
        var cover = coverThumb(a);
        return '<a class="gcard reveal" href="album.html?id='+esc(id)+'&from=gallery">'
          + '<div class="gc-img"><img src="'+esc(cover)+'" alt="'+esc(a.title)+'"></div>'
          + '<div class="gc-info"><div class="gc-no">No.'+('0'+(i+1)).slice(-2)+'</div>'
          + '<h4>'+esc(a.title)+'</h4><div class="gc-meta">'+esc(a.place)+' / '+esc(a.date)+'</div></div></a>';
      }).join('');
      if(!gcards) gcards = '<p class="center-note">后台「新建相册」并加入图集后，会显示在这里。</p>';
      gt.innerHTML = '<div class="gallery-grid">'+gcards+'</div>'
        + '<div class="chapter-more"><a href="gallery.html">进入完整图集 →</a></div>';
    }
  }

  /* ---------- 渲染：Moments 年份目录 + 年份相册 ---------- */
  function renderMomentsPage(d){
    var m = d.moments;
    if(!m){ document.body.innerHTML = '<p style="padding:120px;text-align:center;">暂无 Moments 数据</p>'; return; }
    // 年份图文档：?year=2026 —— 延续原有图文竖排展示模式
    var yearParam = new URLSearchParams(location.search).get('year');
    if(yearParam){ renderYearDetail(m, yearParam); return; }
    document.title = (m.navLabel || 'Moments') + ' · The Memory';
    var title = document.getElementById('moments-page-title');
    var sub = document.getElementById('moments-page-sub');
    if(title) title.textContent = m.title || '';
    if(sub) sub.textContent = m.subtitle || '';

    // 年份相册卡片：最新年份排在最上（2026 → 2016 倒序），不受存储顺序影响
    var order = (m.yearOrder || []).slice().sort(function(a, b){
      return (parseInt(b.replace('year-',''), 10) || 0) - (parseInt(a.replace('year-',''), 10) || 0);
    });
    // 顶部年份标签：保持原顺序（2016 → 2026）不动
    var years = (m.yearOrder || []).slice().sort(function(a, b){
      return (parseInt(a.replace('year-',''), 10) || 0) - (parseInt(b.replace('year-',''), 10) || 0);
    }).map(function(id){ return id.replace('year-',''); });
    var nav = document.getElementById('year-nav');
    if(nav){
      if(!years.length){
        nav.innerHTML = '';
      } else {
        nav.innerHTML = years.map(function(y){
          return '<button class="year-btn" data-year="'+esc(y)+'">'+esc(y)+'</button>';
        }).join('');
        nav.querySelectorAll('.year-btn').forEach(function(btn){
          btn.addEventListener('click', function(){
            var y = this.getAttribute('data-year');
            var target = document.getElementById('year-anchor-'+y);
            if(target) target.scrollIntoView({behavior:'smooth', block:'start'});
          });
        });
      }
    }

    var wrap = document.getElementById('year-albums');
    if(!wrap) return;
    if(!order.length){
      wrap.innerHTML = '<p class="center-note">后台「瞬间管理」中配置年份后，会显示在这里。</p>';
      return;
    }
    wrap.innerHTML = order.map(function(id){
      var a = m.yearAlbums && m.yearAlbums[id]; if(!a) return '';
      var y = id.replace('year-','');
      var cover = a.hero || (a.photos && a.photos[0] && a.photos[0].src) || '';
      var count = (a.photos || []).length;
      return '<a class="year-card reveal" id="year-anchor-'+esc(y)+'" href="moments.html?year='+esc(y)+'">'
        + (cover ? '<div class="yc-img"><img src="'+esc(cover)+'" alt="'+esc(y)+'"></div>' : '<div class="yc-img empty"></div>')
        + '<div class="yc-info"><div class="yc-year">'+esc(y)+'</div><div class="yc-count">'+count+' 个瞬间</div></div>'
        + '</a>';
    }).join('');
    // 年份相册卡片首屏即显示，不依赖滚动淡入
    Array.from(wrap.querySelectorAll('.year-card')).forEach(function(card){ card.classList.add('in'); });
  }

  /* ---------- 渲染：某一年份的图文档（沿用原 Moments 图文竖排模式） ---------- */
  function renderYearDetail(m, y){
    document.body.classList.add('is-year-view');
    document.title = y + ' · Moments · The Memory';
    var label = document.querySelector('.mh-header-label');
    if(label) label.textContent = 'Year';
    var title = document.getElementById('moments-page-title');
    if(title) title.textContent = y;
    var a = (m.yearAlbums && m.yearAlbums['year-'+y]) || {};
    var items = (m.items || []).filter(function(it){
      return String(it.date || '').indexOf(y) > -1;
    });
    var sub = document.getElementById('moments-page-sub');
    if(sub) sub.textContent = a.desc || (items.length + ' 个瞬间');
    var nav = document.getElementById('year-nav'); if(nav) nav.innerHTML = '';
    var wrap = document.getElementById('moments-list');
    if(!wrap) return;
    wrap.hidden = false;
    var html = '<div class="year-detail-top reveal"><a class="year-back" href="moments.html">← 全部年份</a>'
      + '<span class="year-detail-count">'+items.length+' 个瞬间</span></div>';
    var cover = a.hero || '';
    if(cover) html += '<figure class="year-cover reveal"><img src="'+esc(cover)+'" alt="'+esc(y)+'"></figure>';
    if(!items.length){
      html += '<p class="center-note">这一年还没有图文。后台「瞬间管理」中添加条目并填写 '+esc(y)+' 年日期后，会自动归档到这里。</p>';
    } else {
      html += items.map(function(it, i){
        var isEven = (i % 2 === 0);
        var mediaHtml;
        if(it.type === 'video' || (it.media && /\.(mp4|mov|webm)$/i.test(it.media))){
          mediaHtml = '<div class="moment-media"><video controls playsinline preload="metadata" src="'+esc(it.media)+'"></video></div>';
        } else {
          mediaHtml = '<div class="moment-media image-only"><img src="'+esc(it.media)+'" alt=""></div>';
        }
        var textHtml = '<div class="moment-text">'
          + '<div class="moment-meta"><span class="moment-date">'+esc(it.date||'')+'</span><span class="moment-place">'+esc(it.place||'')+'</span></div>'
          + '<div class="moment-body">'+formatDesc(it.text, it.align)+'</div>'
          + '</div>';
        return '<article class="moment-item reveal'+(isEven?'':' reverse')+'">' + (isEven ? mediaHtml + textHtml : textHtml + mediaHtml) + '</article>';
      }).join('');
    }
    wrap.innerHTML = html;
    // 首屏条目立即显示，避免 .reveal 未触发导致的空白
    Array.from(wrap.querySelectorAll('.reveal')).slice(0, 3).forEach(function(el){ el.classList.add('in'); });
  }

  /* ---------- 渲染：相册详情 ---------- */
  function renderAlbum(d, id){
    var params = new URLSearchParams(location.search);
    var a = d.albums[id];
    if(!a){ document.body.innerHTML = '<p style="padding:120px;text-align:center;">相册不存在</p>'; return; }
    document.title = a.title + ' · The Memory';
    var hero = document.querySelector('.detail-hero img');
    if(hero) hero.src = a.hero || (a.photos[0] && a.photos[0].src) || '';
    var ht = document.querySelector('.detail-hero .dh-text');
    if(ht) ht.innerHTML = '<div class="dh-sub">Album</div><h1>'+esc(a.title)+'</h1><div class="dh-meta">'+esc(a.place)+' &nbsp;/&nbsp; '+esc(a.date)+'</div>';
    var body = document.querySelector('.detail-body');
    if(body){
      var s = '<div class="eyebrow">The Story</div>';
      (a.story||[]).forEach(function(p, i){
        s += '<p'+(i===0?' class="first-letter"':'')+'>'+esc(p)+'</p>';
      });
      body.innerHTML = s;
    }
    // 相册视频区（紧跟故事之后）
    var vbox = document.querySelector('.album-videos');
    if(vbox){
      var vs = a.videos || [];
      vbox.innerHTML = vs.length
        ? '<div class="eyebrow">Films</div>' + vs.map(function(v){
            return '<figure class="album-video">'
              + '<video controls playsinline preload="none" poster="'+esc(v.poster||'')+'">'
              + '<source src="'+esc(v.src)+'" type="video/mp4"></video>'
              + (v.cap ? '<figcaption>'+esc(v.cap)+'</figcaption>' : '')
              + '</figure>';
          }).join('')
        : '';
    }
    var grid = document.querySelector('.grid[data-lightbox]');
    if(grid){
      grid.setAttribute('data-lightbox', id);
      grid.innerHTML = (a.photos||[]).map(function(p){
        var t = p.thumb || p.src;
          return '<div class="cell"><img data-full="'+esc(p.src)+'" data-cap="'+esc(p.cap||'')+'" src="'+esc(t)+'" alt=""></div>';
      }).join('');
      grid.classList.add('in');
    }
    var order;
    if(id.indexOf('year-') === 0 && d.moments && d.moments.yearOrder && d.moments.yearOrder.length){
      order = d.moments.yearOrder;
    } else {
      order = d.galleryOrder && d.galleryOrder.length ? d.galleryOrder : Object.keys(d.albums);
    }
    var idx = order.indexOf(id);
    var nextId = order[(idx+1) % order.length];
    var next = document.querySelector('.detail-foot a:last-child');
    if(next && d.albums[nextId]){
      var np = new URLSearchParams();
      np.set('id', nextId);
      if(params.get('from')) np.set('from', params.get('from'));
      if(params.get('province')) np.set('province', params.get('province'));
      next.href = 'album.html?'+np.toString();
    }
  }

  /* ---------- 渲染：Gallery ---------- */
  function renderGallery(d){
    var grid = document.querySelector('.gallery-list');
    if(!grid) return;
    var html = '';
    (d.galleryOrder||[]).forEach(function(id, i){
      var a = d.albums[id]; if(!a) return;
      var cover = coverThumb(a);
      var rev = (i % 2 === 1) ? ' reverse' : '';
      html += '<a class="glist-row reveal'+rev+'" href="album.html?id='+esc(id)+'&from=gallery">'
        + '<div class="glist-img"><img src="'+esc(cover)+'" alt="'+esc(a.title)+'"></div>'
        + '<div class="glist-info">'
        + '<div class="glist-no">'+esc(a.date ? ('No.'+('0'+(i+1)).slice(-2)) : '')+'</div>'
        + '<h4>'+esc(a.title)+'</h4>'
        + '<div class="glist-meta">'+esc(a.place)+' / '+esc(a.date)+'</div>'
        + '<p class="glist-desc">'+esc(a.desc)+'</p>'
        + '<span class="glist-more">看完整游记 →</span>'
        + '</div></a>';
    });
    if(!html) html = '<p class="center-note">后台「新建相册」并加入图集后，会显示在这里。</p>';
    grid.innerHTML = html;
    // Gallery 列表进入页面即显示，不依赖滚动淡入
    Array.from(grid.querySelectorAll('.glist-row')).forEach(function(row){ row.classList.add('in'); });
  }

  /* ---------- 省份是否有相册 ---------- */
  function provinceHasAlbums(p){
    return Object.keys(p.cities||{}).some(function(ck){ return ((p.cities[ck].albums||[]).length > 0); });
  }

  /* ---------- Places：统计 / 精选 / 海外 通用渲染 ---------- */
  function getPlaceStatsHTML(d){
    var provinces = d.places.provinces || {};
    var pCount = 0;
    Object.keys(provinces).forEach(function(k){ if(provinceHasAlbums(provinces[k])) pCount++; });
    var cityCount = 0;
    Object.keys(provinces).forEach(function(k){
      if(provinceHasAlbums(provinces[k])){
        cityCount += Object.keys(provinces[k].cities||{}).filter(function(ck){
          return (provinces[k].cities[ck].albums||[]).length > 0;
        }).length;
      }
    });
    var photoCount = 0;
    Object.keys(d.albums||{}).forEach(function(k){ photoCount += (d.albums[k].photos||[]).length; });
    return '<div class="stat"><b>'+pCount+'</b><span>省份</span></div>'
      + '<div class="stat"><b>'+cityCount+'</b><span>城市</span></div>'
      + '<div class="stat"><b>'+photoCount+'</b><span>张照片</span></div>';
  }
  function getPlaceFeaturedHTML(d){
    var provinces = d.places.provinces || {};
    var featured = Object.keys(provinces).filter(function(k){
      return Object.keys(provinces[k].cities||{}).some(function(ck){ return (provinces[k].cities[ck].albums||[]).length>0; });
    });
    if(!featured.length) featured = Object.keys(provinces);
    if(!featured.length) return '<p class="center-note">后台「地点地图」添加省份与城市相册后，会显示在这里。</p>';
    return featured.map(function(k){
      var p = provinces[k];
      var albumId = null;
      Object.keys(p.cities||{}).forEach(function(ck){ var al=p.cities[ck].albums||[]; if(al.length && !albumId) albumId=al[0]; });
      var cover = (albumId && d.albums[albumId]) ? coverThumb(d.albums[albumId]) : (p.hero||'');
      var href = albumId ? ('album.html?id='+esc(albumId)+'&from=place') : ('province.html?province='+esc(k));
      return '<a class="pf-card reveal" href="'+href+'">'
        + (cover ? '<div class="pf-img"><img src="'+esc(cover)+'" alt="'+esc(p.name)+'" loading="lazy"></div>' : '<div class="pf-img empty"></div>')
        + '<div class="pf-meta"><div class="pf-name">'+esc(p.name)+'</div>'
        + '<div class="pf-sub">'+(albumId && d.albums[albumId] ? esc(d.albums[albumId].title) : '查看省份')+'</div></div>'
        + '</a>';
    }).join('');
  }
  function getPlaceAbroadHTML(d){
    var abroad = d.places.abroad || {};
    var akeys = Object.keys(abroad);
    if(!akeys.length) return '';
    return '<div class="pf-head"><span class="eyebrow">Abroad</span><h3 class="serif-title">海外足迹</h3></div>'
      + '<div class="pf-grid">' + akeys.map(function(k){
          var p = abroad[k];
          var albumId = (p.albums && p.albums[0]) || null;
          var cover = (albumId && d.albums[albumId]) ? coverThumb(d.albums[albumId]) : '';
          var href = albumId ? ('album.html?id='+esc(albumId)+'&from=place') : '#';
          return '<a class="pf-card" href="'+href+'" '+(albumId?'':'onclick="return false"')+'>'
            + (cover ? '<div class="pf-img"><img src="'+esc(cover)+'" alt="'+esc(p.name)+'" loading="lazy"></div>' : '<div class="pf-img empty"></div>')
            + '<div class="pf-meta"><div class="pf-name">'+esc(p.name)+'</div><div class="pf-sub">'+(albumId?'查看相册':'敬请期待')+'</div></div>'
            + '</a>';
        }).join('') + '</div>';
  }

  /* ---------- 渲染：首页 Places 预览（完整版） ---------- */
  function renderHomePlaces(d){
    var wrap = document.getElementById('place-teaser'); if(!wrap) return;
    wrap.innerHTML =
      '<div class="place-stats reveal" id="home-place-stats"></div>'
      + '<div class="map-panel reveal">'
      +   '<div class="mapwrap mapwrap-wide">'
      +     '<svg id="home-map" role="img" aria-label="中国地图"></svg>'
      +   '</div>'
      + '</div>'
      + '<p class="map-legend reveal">浅色线描为全部省份轮廓，暖色填充为已有照片记录；点击高亮省份可进入省地图。</p>'
      + '<div class="place-featured reveal" id="home-pf-grid">'
      +   '<div class="pf-head"><span class="eyebrow">Featured</span><h3 class="serif-title">精选足迹</h3></div>'
      +   '<div class="pf-grid"></div>'
      + '</div>'
      + '<div class="place-abroad reveal" id="home-place-abroad"></div>'
      + '<div class="chapter-more"><a href="place.html">查看全部地点 →</a></div>';
    var stats = document.getElementById('home-place-stats');
    if(stats) stats.innerHTML = getPlaceStatsHTML(d);
    var grid = document.querySelector('#home-pf-grid .pf-grid');
    if(grid) grid.innerHTML = getPlaceFeaturedHTML(d);
    var ab = document.getElementById('home-place-abroad');
    if(ab) ab.innerHTML = getPlaceAbroadHTML(d);
    renderChinaMap('#home-map', d, {mini:false});
  }

  /* ---------- 渲染：Places 完整页 ---------- */
  function renderPlaces(d){
    var stats = document.getElementById('place-stats');
    if(stats) stats.innerHTML = getPlaceStatsHTML(d);
    var grid = document.querySelector('#pf-grid');
    if(grid) grid.innerHTML = getPlaceFeaturedHTML(d);
    var ab = document.getElementById('place-abroad');
    if(ab) ab.innerHTML = getPlaceAbroadHTML(d);
    // 地图
    var svg = document.querySelector('#place-svg');
    if(svg) renderChinaMap('#place-svg', d, {mini:false});
  }

  /* ---------- DataV 省界高亮（免配额、GCJ-02、有审图号） ---------- */
  function drawProvinceBoundary(TMap, map, p, pk){
    if(!p.adcode) return;
    var CK = 'tm_datav_' + p.adcode;
    var cached = null;
    try { cached = JSON.parse(localStorage.getItem(CK) || 'null'); } catch (e) { cached = null; }
    function drawGeo(geo){
      try {
        var minLat = 90, maxLat = -90, minLng = 180, maxLng = -180;
        var polys = [];
        (geo.features || []).forEach(function(f){
          var g = f.geometry; if(!g) return;
          var list = g.type === 'MultiPolygon' ? g.coordinates : (g.type === 'Polygon' ? [g.coordinates] : []);
          list.forEach(function(poly){
            poly.forEach(function(ring){
              var pts = ring.map(function(c){
                var ln = c[0], la = c[1];
                if(isNaN(la) || isNaN(ln)) return null;
                if(la < minLat) minLat = la; if(la > maxLat) maxLat = la;
                if(ln < minLng) minLng = ln; if(ln > maxLng) maxLng = ln;
                return new TMap.LatLng(la, ln);
              }).filter(Boolean);
              if(pts.length > 2) polys.push(pts);
            });
          });
        });
        if(polys.length){
          new TMap.MultiPolygon({
            map: map,
            styles: { hl: new TMap.FillStyle({
              color: 'rgba(200,168,130,0.16)',
              borderColor: '#B99A6F',
              borderWidth: 3
            }) },
            geometries: polys.map(function(g, i){ return { id: 'p' + i, styleId: 'hl', paths: g }; })
          });
          try {
            map.fitBounds(new TMap.LatLngBounds(
              new TMap.LatLng(minLat, minLng), new TMap.LatLng(maxLat, maxLng)));
          } catch (e) {}
        }
      } catch (e) {}
      try { localStorage.setItem(CK, JSON.stringify({ t: Date.now(), geo: geo })); } catch (e) {}
    }
    if(cached && cached.t && cached.geo && (Date.now() - cached.t < 7 * 24 * 3600 * 1000)){
      drawGeo(cached.geo); return;
    }
    var url = 'https://geo.datav.aliyun.com/areas_v3/bound/' + p.adcode + '_full.json';
    fetch(url).then(function(r){ return r.json(); }).then(drawGeo).catch(function(){});
  }

  /* 省份真实轮廓地图：DataV 省界 + 自动提取地级市，支持缩放拖拽 */
  function drawProvinceSVG(d, pk, p){
    var svg = document.getElementById('province-svg'); if(!svg || !p) return;
    var W = 900, H = 720, pad = 36;
    svg.setAttribute('viewBox', '0 0 ' + W + ' ' + H);
    function fallback(){ svg.innerHTML = '<ellipse cx="450" cy="360" rx="260" ry="300" class="prov-shape-path"/>'; }
    if(!p.adcode){ fallback(); return; }

    // 缩放 / 拖拽状态
    var state = { scale:1, x:0, y:0, min:.65, max:5, panning:false, sx:0, sy:0 };
    var layer;
    function setTransform(){
      if(!layer) return;
      layer.setAttribute('transform', 'translate('+state.x+','+state.y+') scale('+state.scale+')');
    }
    function zoom(delta, cx, cy){
      var old = state.scale;
      var ns = Math.min(state.max, Math.max(state.min, old * delta));
      if(ns === old) return;
      var rect = svg.getBoundingClientRect();
      var px = (cx == null ? rect.width/2 : cx) / rect.width * W;
      var py = (cy == null ? rect.height/2 : cy) / rect.height * H;
      state.x = px - (px - state.x) * ns / old;
      state.y = py - (py - state.y) * ns / old;
      state.scale = ns;
      setTransform();
    }

    function bindZoom(svgEl){
      layer = svgEl.querySelector('#prov-zoom-layer');
      // 滚轮缩放：仅在 Ctrl/Cmd 按下（双指捏合/按住缩放）时触发；普通上下滚动放行页面
      svgEl.addEventListener('wheel', function(e){
        if(!(e.ctrlKey || e.metaKey)) return;
        e.preventDefault();
        var delta = e.deltaY > 0 ? 0.9 : 1.1;
        var rect = svgEl.getBoundingClientRect();
        zoom(delta, e.clientX - rect.left, e.clientY - rect.top);
      }, {passive:false});
      // 鼠标拖拽
      svgEl.addEventListener('mousedown', function(e){ state.panning = true; state.sx = e.clientX; state.sy = e.clientY; svgEl.style.cursor = 'grabbing'; });
      window.addEventListener('mousemove', function(e){
        if(!state.panning) return;
        var dx = e.clientX - state.sx, dy = e.clientY - state.sy;
        state.sx = e.clientX; state.sy = e.clientY;
        state.x += dx / state.scale; state.y += dy / state.scale;
        setTransform();
      });
      window.addEventListener('mouseup', function(){ state.panning = false; svgEl.style.cursor = ''; });
      // 按钮
      var panel = svgEl.closest('.prov-zoom-panel');
      if(panel){
        panel.querySelector('.zoom-in') && panel.querySelector('.zoom-in').addEventListener('click', function(){ zoom(1.25); });
        panel.querySelector('.zoom-out') && panel.querySelector('.zoom-out').addEventListener('click', function(){ zoom(0.8); });
        panel.querySelector('.zoom-reset') && panel.querySelector('.zoom-reset').addEventListener('click', function(){ state.scale=1; state.x=0; state.y=0; setTransform(); });
      }
    }

    function draw(geo){
      var pr = makeProjection(geo, W, H, pad);
      var html = '<g id="prov-zoom-layer">';
      // 1) 地级市边界
      var boundaryPaths = '';
      (geo.features||[]).forEach(function(f){
        if(!f.properties) return;
        var path = featurePath(f, pr);
        if(path) boundaryPaths += '<path d="'+path+'" class="city-boundary" fill-rule="evenodd"/>';
      });
      html += '<g class="prov-cities-group">' + boundaryPaths + '</g>';
      // 2) 城市点与名称：优先用 GeoJSON 中的地级市；再与 data.json 中的 cities 匹配相册
      var dataCities = p.cities || {};
      var cityByName = {};
      Object.keys(dataCities).forEach(function(ck){
        var c = dataCities[ck];
        var key = (c.name||ck).replace(/市$/,'');
        cityByName[key] = c;
      });
      var cityDots = '';
      (geo.features||[]).forEach(function(f){
        if(!f.properties || !f.properties.name) return;
        var nameRaw = f.properties.name;
        var nameKey = nameRaw.replace(/市$/,'');
        var c = cityByName[nameKey];
        var ctr = featureCenter(f, pr);
        var albums = c ? (c.albums||[]) : [];
        var has = albums.length > 0;
        var href = has ? ('album.html?id='+esc(albums[0])+'&from=province&province='+esc(pk)) : '#';
        var cls = 'city-dot' + (has ? ' lit' : '');
        var displayName = c ? (c.name || nameRaw) : nameRaw;
        cityDots += '<a href="'+href+'" class="'+cls+'" '+(has?'':'onclick="return false"')+'>'
          + '<circle cx="'+ctr[0].toFixed(1)+'" cy="'+ctr[1].toFixed(1)+'" r="'+(has?10:6)+'"/>'
          + '<text x="'+ctr[0].toFixed(1)+'" y="'+(ctr[1]+26).toFixed(1)+'">'+esc(displayName)+'</text></a>';
      });
      html += '<g class="city-dot-group">' + cityDots + '</g>';
      html += '</g>';
      svg.innerHTML = html;
      bindZoom(svg);
    }

    var CK = 'tm_datav_v2_' + p.adcode;
    try { var c = localStorage.getItem(CK); if(c){ draw(JSON.parse(c)); return; } } catch(e){}
    function fetchDataV(){ return fetch('https://geo.datav.aliyun.com/areas_v3/bound/' + p.adcode + '_full.json').then(function(r){ return r.json(); }); }
    fetch('assets/maps/' + p.adcode + '.json')
      .then(function(r){ return r.json(); })
      .catch(fetchDataV)
      .then(function(g){ try{ localStorage.setItem(CK, JSON.stringify(g)); }catch(e){} draw(g); })
      .catch(function(){ fallback(); });
  }

  /* ---------- 渲染：Province 省地图页 ---------- */
  function renderProvince(d){
    var params = new URLSearchParams(location.search);
    var pk = params.get('province');
    var provinces = d.places && d.places.provinces || {};
    var p = provinces[pk];
    if(!p){ document.body.innerHTML = '<p style="padding:120px;text-align:center;">省份不存在</p>'; return; }

    document.title = p.name + ' · Places · The Memory';
    var heroEl = document.querySelector('.province-hero');
    var h1 = document.querySelector('.province-hero h1');
    if(h1) h1.textContent = p.name;
    var sub = document.querySelector('.province-hero .ph-sub');
    if(sub) sub.textContent = 'Province · 中国';
    var intro = document.querySelector('.province-hero .ph-intro');
    if(intro){
      if(p.intro){ intro.textContent = p.intro; intro.style.display = ''; }
      else { intro.textContent = ''; intro.style.display = 'none'; }
    }

    // Hero 背景图：按图片亮度自动切换深浅文字
    if(heroEl){
      if(p.hero){
        heroEl.classList.add('has-hero');
        heroEl.style.backgroundImage = 'url(\''+esc(p.hero)+'\')';
        detectImageBrightness(p.hero, function(err, brightness){
          heroEl.classList.remove('text-dark','text-light');
          heroEl.classList.add(brightness > 150 ? 'text-dark' : 'text-light');
        });
      } else {
        heroEl.classList.remove('has-hero','text-dark','text-light');
        heroEl.style.backgroundImage = '';
      }
    }

    // 省份真实轮廓地图（阿里 DataV 省界，免配额）
    drawProvinceSVG(d, pk, p);

    // 城市卡片：有相册的城市优先置顶
    var grid = document.getElementById('city-grid');
    if(grid){
      var cities = p.cities || {};
      var keys = Object.keys(cities).sort(function(a,b){
        var ha = ((cities[a].albums||[]).length > 0) ? 1 : 0;
        var hb = ((cities[b].albums||[]).length > 0) ? 1 : 0;
        return hb - ha;
      });
      var html = '';
      keys.forEach(function(ck){
        var c = cities[ck];
        var albums = c.albums || [];
        var firstAlbum = albums[0];
        var href = firstAlbum ? ('album.html?id='+esc(firstAlbum)+'&from=province&province='+esc(pk)) : '#';
        var cover = '';
        if(firstAlbum && d.albums[firstAlbum]){
          var a = d.albums[firstAlbum];
          cover = coverThumb(a);
        }
        html += '<a class="city-card reveal" href="'+href+'" '+(firstAlbum?'':'onclick="return false" style="opacity:.55;"')+'>'
          + (cover ? '<div class="city-img"><img src="'+esc(cover)+'" alt="'+esc(c.name)+'"></div>' : '<div class="city-img empty"><span>'+esc(c.name)+'</span></div>')
          + '<div class="city-info">'
          + '<div class="city-no">City</div>'
          + '<h4>'+esc(c.name)+'</h4>'
          + '<div class="city-meta">'+(albums.length ? (albums.length+' 个相册') : '暂无相册')+'</div>'
          + '</div></a>';
      });
      if(!html){
        html = '<p class="center-note">该省份下还没有城市相册。去后台「地点地图」添加城市与相册关联吧。</p>';
      }
      grid.innerHTML = html;
    }
  }

  /* ---------- 渲染：面包屑（逐级返回） ---------- */
  function renderBreadcrumb(d){
    var bc = document.getElementById('breadcrumb'); if(!bc) return;
    var p = location.pathname;
    var params = new URLSearchParams(location.search);
    var crumbs = [{label:'Home', href:'index.html'}];
    if(p.indexOf('province.html')>-1){
      var pk = params.get('province');
      var prov = d.places && d.places.provinces && d.places.provinces[pk];
      crumbs.push({label:'Places', href:'place.html'});
      if(prov) crumbs.push({label:prov.name, href:null});
    } else if(p.indexOf('album.html')>-1){
      var id = params.get('id');
      var a = d.albums[id];
      var from = params.get('from');
      if(from==='favorites'){ crumbs.push({label:'Favorites', href:'index.html#favorites'}); }
      else if(from==='gallery'){ crumbs.push({label:'Gallery', href:'gallery.html'}); }
      else if(from==='province'){
        var p2 = params.get('province');
        var prov2 = d.places && d.places.provinces && d.places.provinces[p2];
        crumbs.push({label:'Places', href:'place.html'});
        if(prov2) crumbs.push({label:prov2.name, href:'province.html?province='+encodeURIComponent(p2)});
      } else if(from==='place'){ crumbs.push({label:'Places', href:'place.html'}); }
      else if(from==='moments'){ crumbs.push({label:'Moments', href:'moments.html'}); }
      if(a) crumbs.push({label:a.title, href:null});
    }
    bc.innerHTML = crumbs.map(function(c,i){
      if(c.href && i < crumbs.length-1) return '<a href="'+c.href+'">'+esc(c.label)+'</a><span class="sep">/</span>';
      return '<span class="cur">'+esc(c.label)+'</span>';
    }).join('');
  }

  function organicProvinceShape(){
    // 返回一个风格化的有机多边形，作为省份占位轮廓
    var cx=200, cy=200, r=90, pts=[];
    for(var i=0;i<8;i++){
      var ang = (i/8)*Math.PI*2;
      var rr = r*(0.7+0.3*Math.random());
      pts.push((cx+rr*Math.cos(ang)).toFixed(1)+','+(cy+rr*Math.sin(ang)).toFixed(1));
    }
    return 'M'+pts.join(' L')+' Z';
  }

  /* ---------- 交互初始化 ---------- */
  function initNav(){
    var nav = document.querySelector('.site-nav'); if(!nav) return;
    var hero = document.querySelector('.hero, .detail-hero, .vpage');
    function onScroll(){
      var y = window.scrollY || document.documentElement.scrollTop;
      if(y>60){ nav.classList.add('scrolled'); nav.classList.remove('on-hero'); }
      else { nav.classList.remove('scrolled'); if(hero) nav.classList.add('on-hero'); }
    }
    if(hero) nav.classList.add('on-hero');
    window.addEventListener('scroll', onScroll, {passive:true}); onScroll();
  }
  function initReveal(){
    var els = document.querySelectorAll('.reveal');
    if(!('IntersectionObserver' in window)){ els.forEach(function(e){e.classList.add('in');}); return; }
    var io = new IntersectionObserver(function(es){ es.forEach(function(e){ if(e.isIntersecting){ e.target.classList.add('in'); io.unobserve(e.target); } }); }, {threshold:0.12});
    els.forEach(function(e){ io.observe(e); });
  }
  /* 背景轻音乐：打开页面即自动轮播播放，按钮用于暂停/继续 */
  function initBgm(playlist){
    var btn = document.querySelector('.audio-toggle');
    if(!btn || !playlist || !playlist.length) return;
    var au = new Audio(); au.volume = 0.35;
    var idx = 0;
    function start(){
      if(!au.src) au.src = playlist[idx % playlist.length];
      var pp = au.play();
      if(pp && pp.then) pp.then(function(){ btn.classList.add('playing'); }).catch(function(){});
      else btn.classList.add('playing');
    }
    function stop(){ au.pause(); btn.classList.remove('playing'); }
    au.addEventListener('ended', function(){
      idx = (idx + 1) % playlist.length;   // 轮播：一曲终了自动下一首
      au.src = playlist[idx];
      au.play().catch(function(){});
      btn.classList.add('playing');
    });
    btn.addEventListener('click', function(){
      if(au.paused){ start(); }
      else { stop(); }
    });
    // 进入页面直接尝试自动播放（静音视频可被允许；带声音常被浏览器拦截）
    start();
    // 兜底：若自动播放被拦截（仍处于 paused），在用户首次交互时补播
    function tryAutoOnGesture(){
      if(!au.paused){ removeGestureHooks(); return; }
      start();
      if(!au.paused) removeGestureHooks();
    }
    function removeGestureHooks(){
      ['pointerdown','keydown','scroll','touchstart'].forEach(function(ev){
        window.removeEventListener(ev, tryAutoOnGesture);
      });
    }
    ['pointerdown','keydown','scroll','touchstart'].forEach(function(ev){
      window.addEventListener(ev, tryAutoOnGesture, {passive:true});
    });
    au.addEventListener('playing', removeGestureHooks, {once:true});
  }
  function initFavoritesSlider(){
    var track = document.getElementById('fav-list'); if(!track) return;
    var slides = track.querySelectorAll('.fav-slide'); if(slides.length <= 1) return;
    var cur = 0;
    function go(n){
      slides[cur].classList.remove('active');
      cur = (n + slides.length) % slides.length;
      slides[cur].classList.add('active');
    }
    var prev = document.querySelector('.fav-nav.fav-prev');
    var next = document.querySelector('.fav-nav.fav-next');
    if(prev) prev.addEventListener('click', function(){ go(cur-1); });
    if(next) next.addEventListener('click', function(){ go(cur+1); });
  }

  function initCoverSliders(){
    document.querySelectorAll('.cover-slider').forEach(function(slider){
      var raw = slider.getAttribute('data-imgs'); if(!raw) return;
      var imgs = JSON.parse(raw);
      var track = document.createElement('div'); track.className='cover-track';
      imgs.forEach(function(src){ var s=document.createElement('div'); s.className='slide'; var im=document.createElement('img'); im.src=src; im.alt=''; im.loading='lazy'; s.appendChild(im); track.appendChild(s); });
      slider.appendChild(track);
      var dots=document.createElement('div'); dots.className='cover-dots';
      imgs.forEach(function(_,i){ var d=document.createElement('i'); if(i===0)d.className='on'; dots.appendChild(d); });
      slider.appendChild(dots);
      var nav=document.createElement('div'); nav.className='cover-nav';
      nav.innerHTML='<button class="cprev" aria-label="上一张">‹</button><button class="cnext" aria-label="下一张">›</button>';
      slider.appendChild(nav);
      var idx=0;
      function go(n){ idx=(n+imgs.length)%imgs.length; track.style.transform='translateX('+(-idx*100)+'%)'; dots.querySelectorAll('i').forEach(function(d,i){ d.className=(i===idx)?'on':''; }); }
      nav.querySelector('.cprev').addEventListener('click',function(){go(idx-1);});
      nav.querySelector('.cnext').addEventListener('click',function(){go(idx+1);});
      var sx=0; slider.addEventListener('touchstart',function(e){sx=e.touches[0].clientX;},{passive:true});
      slider.addEventListener('touchend',function(e){ var dx=e.changedTouches[0].clientX-sx; if(dx>40)go(idx-1); else if(dx<-40)go(idx+1); },{passive:true});
    });
  }
  function initLightbox(){
    var lb=document.getElementById('lightbox'); if(!lb) return;
    var lbImg=lb.querySelector('.lb-img'), lbCap=lb.querySelector('.lb-cap'), lbCount=lb.querySelector('.lb-count');
    var sets={};
    document.querySelectorAll('[data-lightbox]').forEach(function(grid){
      var key=grid.getAttribute('data-lightbox');
      sets[key]=Array.prototype.map.call(grid.querySelectorAll('.cell'), function(c){
        var im=c.querySelector('img'); return {src:im.getAttribute('data-full')||im.src, cap:im.getAttribute('data-cap')||''};
      });
      grid.querySelectorAll('.cell').forEach(function(c,i){ c.addEventListener('click',function(){ open(key,i); }); });
      function open(k,i){
        var arr=sets[k], cur=i;
        function render(){ lbImg.src=arr[cur].src; lbCap.textContent=arr[cur].cap||''; lbCount.textContent=(cur+1)+' / '+arr.length; }
        lb.classList.add('open'); render();
        lb.querySelector('.lb-prev').onclick=function(){cur=(cur-1+arr.length)%arr.length;render();};
        lb.querySelector('.lb-next').onclick=function(){cur=(cur+1)%arr.length;render();};
        lb.querySelector('.lb-close').onclick=close;
        lb.onclick=function(e){ if(e.target===lb) close(); };
        function keyEv(e){ if(e.key==='Escape')close(); if(e.key==='ArrowLeft'){cur=(cur-1+arr.length)%arr.length;render();} if(e.key==='ArrowRight'){cur=(cur+1)%arr.length;render();} }
        document.addEventListener('keydown',keyEv);
        lb._keyEv=keyEv;
      }
      function close(){ lb.classList.remove('open'); if(lb._keyEv) document.removeEventListener('keydown',lb._keyEv); }
    });
  }
  /* 通用：把带空行分段的文本渲染成 <p>，支持 align=center */
  function formatDesc(text, align){
    var s = (text || '').replace(/\r\n/g,'\n').replace(/\r/g,'\n');
    var style = (align === 'center') ? ' style="text-align:center;"' : '';
    var ps = s.split(/\n\s*\n/).filter(function(p){ return p.trim(); }).map(function(p){ return '<p'+style+'>'+esc(p)+'</p>'; }).join('');
    return ps || '<p style="opacity:.5;">（暂无说明）</p>';
  }

  function initVideoCarousel(){
    var vp=document.querySelector('.vpage'); if(!vp) return;
    var vids=(DATA && DATA.site && DATA.site.videos) ? DATA.site.videos : [];
    if(!vids.length) return;
    var stage=vp.querySelector('.vstage');
    var sub=vp.querySelector('.vside-sub'), main=vp.querySelector('.vside-title'), desc=vp.querySelector('.vside-desc'), count=vp.querySelector('.vcount');
    var cur=0;
    function load(i){
      cur=(i+vids.length)%vids.length; var v=vids[cur];
      stage.innerHTML='<video playsinline muted preload="auto"><source src="'+v.src+'" type="video/mp4"></video>';
      var video=stage.querySelector('video');
      video.play().catch(function(){});
      if(sub) sub.textContent=v.sub||'';
      if(main) main.textContent=v.title||'';
      if(desc) desc.innerHTML = formatDesc(v.desc, v.align);
      if(count) count.textContent=(cur+1)+' / '+vids.length;
    }
    vp.querySelector('.vprev').addEventListener('click',function(){load(cur-1);});
    vp.querySelector('.vnext').addEventListener('click',function(){load(cur+1);});
    var closeBtn=vp.querySelector('.vclose');
    if(closeBtn) closeBtn.addEventListener('click',function(){ history.length>1?history.back():(location.href='index.html'); });
    document.addEventListener('keydown',function(e){ if(e.key==='ArrowLeft')load(cur-1); if(e.key==='ArrowRight')load(cur+1); });
    load(0);
  }

  /* ---------- 渲染：会动的记忆 · film 归档区 ---------- */
  function renderFilms(d){
    var sec = document.getElementById('films'); if(!sec) return;
    var f = d.films;
    if(!f || !f.items || !f.items.length){
      sec.style.display = 'none';
      return;
    }
    var intro = document.getElementById('film-intro');
    if(intro) intro.innerHTML = esc(f.intro || '').replace(/\n/g, '<br>');
    var list = document.getElementById('film-list');
    if(list){
      list.innerHTML = f.items.map(function(v, i){
        return '<article class="film-row reveal">'
          + '<div class="film-video"><video controls playsinline preload="metadata"><source src="'+esc(v.src)+'" type="video/mp4"></video></div>'
          + '<div class="film-text">'
          + '<h3 class="film-title">'+esc(v.title || '')+'</h3>'
          + '<p class="film-desc'+(v.align==='center'?' film-desc-center':'')+'">'+esc(v.desc || '').replace(/\n/g,'<br>')+'</p>'
          + '</div></article>';
      }).join('');
    }
  }

  /* ---------- 启动 ---------- */
  function boot(){
    initNav(); initReveal();
    /* 数据始终同源加载：线上走 GitHub Pages 同源 data.json，本地后台走 /api/data。
       不再跨域 fetch COS 的 data.json —— COS 未配 CORS（且无 ACAO 头、自定义头触发预检 403），
       会导致 fetch 被浏览器拦截、boot() 永不执行、整页白屏崩溃。
       媒体（视频/图片）仍通过 data.json 里的 cdnBase/mediaBase 走 COS 提速，
       即使 COS 异常也只影响媒体，页面照常渲染（优雅降级）。 */
    var isLocal = (location.hostname === '127.0.0.1' || location.hostname === 'localhost' || !location.hostname);
    var dataUrl = isLocal ? 'api/data' : 'data.json';
    getJSON(dataUrl).then(function(d){
      DATA = applyCdn(d);
      d = DATA;
      // 媒体容错：CDN（jsDelivr 国内可达）加载失败时，回退到同站相对路径（GitHub Pages 同源）。
      // 这样电脑端（GitHub Pages 直连可用）和国内手机端（jsDelivr 国内节点）都能正常显示媒体。
      CDN_BASE = (d.site && d.site.cdnBase) || '';
      if(CDN_BASE){
        document.addEventListener('error', function(e){
          var el = e.target; if(!el || !el.tagName) return;
          var src = el.src || (el.currentSrc) || '';
          if((el.tagName==='IMG' || el.tagName==='VIDEO' || el.tagName==='SOURCE') && src.indexOf(CDN_BASE)===0 && !el.dataset.fb){
            el.dataset.fb = '1';
            var local = src.slice(CDN_BASE.length);
            if(el.tagName==='IMG'){ el.src = local; }
            else if(el.tagName==='VIDEO'){ el.src = local; try{ el.load(); }catch(_){} }
            else if(el.tagName==='SOURCE'){ el.src = local; var v=el.parentNode; if(v&&v.tagName==='VIDEO'){ try{ v.load(); }catch(_){} } }
          }
        }, true);
      }
      initBgm(d.site.bgmList);   // 曲库在 data.json，等数据就绪再起音乐
      var p = location.pathname;
      if(p.indexOf('album.html')>-1){
        var id = new URLSearchParams(location.search).get('id') || (d.galleryOrder&&d.galleryOrder[0]) || Object.keys(d.albums)[0];
        renderAlbum(d, id);
      } else if(p.indexOf('province.html')>-1){ renderProvince(d); }
      else if(p.indexOf('gallery.html')>-1){ renderGallery(d); }
      else if(p.indexOf('place.html')>-1){ renderPlaces(d); }
      else if(p.indexOf('moments.html')>-1){ renderMomentsPage(d); }
      else { renderHome(d); }
      initCoverSliders(); initLightbox();
      renderBreadcrumb(d);
      initVideoCarousel();
      renderFilms(d);
      initReveal();
    }).catch(function(e){
      console.error('load data fail', e);
      var tip = document.querySelector('.hero-center');
      if(tip){ var n=document.createElement('div'); n.style.cssText='color:#fff;margin-top:14px;font-size:13px;opacity:.85;letter-spacing:.05em'; n.textContent='内容加载失败，请刷新重试'; tip.appendChild(n); }
    });
  }
  if(document.readyState!=='loading') boot();
  else document.addEventListener('DOMContentLoaded', boot);
})();

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
  function getJSON(url){ return fetch(url, {headers:{'x-admin-token':TOKEN}}).then(function(r){ return r.json(); }); }

  /* ---------- CDN 前缀：data.json 只存相对路径，换域名只改 cdnBase ---------- */
  function abs(p, base){
    if(!p) return p;
    if(/^https?:\/\//i.test(p) || p.indexOf('//')===0) return p;
    return (base||'') + p;
  }
  function applyCdn(d){
    var base = (d.site && d.site.cdnBase) || '';
    if(!base) return d;
    if(d.site){
      if(d.site.heroVideo) d.site.heroVideo = abs(d.site.heroVideo, base);
      if(d.site.introAudio) d.site.introAudio = abs(d.site.introAudio, base);
      if(d.site.videos) d.site.videos.forEach(function(v){ v.src = abs(v.src, base); });
    }
    Object.keys(d.albums||{}).forEach(function(k){
      var a = d.albums[k];
      if(a.hero) a.hero = abs(a.hero, base);
      (a.photos||[]).forEach(function(p){
        if(p.src) p.src = abs(p.src, base);
        if(p.thumb) p.thumb = abs(p.thumb, base);
      });
      if(a.heroThumb) a.heroThumb = abs(a.heroThumb, base);
    });
    return d;
  }

  /* 卡片/列表封面统一用缩略图，灯箱与详情页大图才用原尺寸 */
  function coverThumb(a){
    if(a.heroThumb) return a.heroThumb;
    var p = (a.photos||[])[0];
    if(p && p.thumb) return p.thumb;
    if(p && p.src) return p.src;
    return a.hero || '';
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
  function dotIcon(color){
    var svg = '<svg xmlns="http://www.w3.org/2000/svg" width="22" height="22">'
      + '<circle cx="11" cy="11" r="7" fill="' + color + '" stroke="#fff" stroke-width="2"/></svg>';
    return { width: 22, height: 22, src: 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg) };
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
      styles: { lit: new TMap.MarkerStyle(dotIcon('#C8A882')), dim: new TMap.MarkerStyle(dotIcon('#A79A8E')) },
      geometries: geos
    });
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

    /* 有 key：渲染真实腾讯地图 */
    var mapKey = (d.site && d.site.mapKey) || '';
    if(mapKey){
      var abroadAll = d.places.abroad || {};
      var hostId = (svg.id || 'map') + '-tmap';
      var host = mountMapHost(svg, hostId, opts.mini ? '360px' : '560px');
      loadTMap(mapKey).then(function(TMap){
        var pts = [];
        Object.keys(provinces).forEach(function(k){
          var p = provinces[k];
          if(p.lng == null || p.lat == null) return;
          pts.push({ lng: p.lng, lat: p.lat, name: p.name,
            lit: Object.keys(p.cities || {}).length > 0,
            url: 'province.html?province=' + encodeURIComponent(k) });
        });
        if(!opts.mini){
          Object.keys(abroadAll).forEach(function(k){
            var p = abroadAll[k];
            if(p.lng == null || p.lat == null) return;
            var has = p.albums && p.albums.length;
            pts.push({ lng: p.lng, lat: p.lat, name: p.name, lit: !!has,
              url: has ? ('album.html?id=' + encodeURIComponent(p.albums[0]) + '&from=place') : 'gallery.html' });
          });
        }
        var map = new TMap.Map(host, {
          center: new TMap.LatLng(33.5, 106.5),
          zoom: opts.mini ? 3.2 : 3.6,
          pitch: 0,
          scrollwheel: !opts.mini,
          baseMap: { type: 'vector' }
        });
        addTMapPoints(TMap, map, pts, function(p){ if(p.url) location.href = p.url; });
      }).catch(function(){
        svg.style.display = '';
        var h = document.getElementById(hostId);
        if(h && h.parentNode) h.parentNode.removeChild(h);
      });
      return;
    }
    var abroad = d.places.abroad || {};
    var hasProvinces = Object.keys(provinces).length > 0;

    // 容器内容
    var html = '';
    if(!opts.mini){
      html += '<path d="'+chinaOutlinePath()+'" class="china-outline"/>';
    } else {
      // 迷你版只画一个轻盈轮廓
      html += '<path d="'+chinaOutlinePath()+'" class="china-outline mini"/>';
    }

    // 省份点
    Object.keys(provinces).forEach(function(k){
      var p = provinces[k];
      var cityCount = Object.keys(p.cities||{}).length;
      var hasAlbum = cityCount > 0;
      var cls = 'prov-dot' + (hasAlbum ? ' lit' : '') + (opts.mini ? ' mini' : '');
      var href = 'province.html?province='+esc(k);
      html += '<a href="'+href+'" class="'+cls+'">'
        + '<circle cx="'+p.cx+'" cy="'+p.cy+'" r="'+(opts.mini?7:10)+'"/>'
        + '<text x="'+p.cx+'" y="'+(p.cy+(opts.mini?22:30))+'">'+esc(p.name)+'</text>'
        + '</a>';
    });

    // 海外点（仅在非迷你版显示，放在中国轮廓右侧/下方）
    if(!opts.mini){
      Object.keys(abroad).forEach(function(k){
        var p = abroad[k];
        var cls = 'prov-dot abroad';
        var href = p.albums && p.albums.length ? ('album.html?id='+esc(p.albums[0])+'&from=place') : 'gallery.html';
        html += '<a href="'+href+'" class="'+cls+'">'
          + '<circle cx="'+p.cx+'" cy="'+p.cy+'" r="9"/>'
          + '<text x="'+p.cx+'" y="'+(p.cy+28)+'">'+esc(p.name)+'</text>'
          + '</a>';
      });
    }

    svg.innerHTML = html;
  }

  /* ---------- 渲染：首页 ---------- */
  function renderHome(d){
    var vid = document.querySelector('.hero video');
    if(vid && d.site.heroVideo){
      vid.innerHTML = '<source src="'+d.site.heroVideo+'" type="video/mp4">';
      try { vid.load(); } catch(e){}
    }
    var poem = document.querySelector('.intro .poem');
    if(poem) poem.innerHTML = (d.site.intro||'').replace(/\n/g,'<br>');
    var at = document.querySelector('.intro .audio-toggle');
    if(at && d.site.introAudio) at.setAttribute('data-audio', d.site.introAudio);

    // FAVORITES
    var wrap = document.getElementById('fav-list');
    if(wrap){
      var html = '';
      (d.favoritesOrder||[]).slice(0, MAX_FAV).forEach(function(id, i){
        var a = d.albums[id]; if(!a) return;
        var covers = (a.photos||[]).slice(0, 8).map(function(p){ return p.thumb || p.src; });
        var rev = (i % 2 === 1) ? ' reverse' : '';
        html += '<article class="album-row reveal'+rev+'">'
          + '<div class="cover-slider" data-imgs=\''+JSON.stringify(covers)+'\'></div>'
          + '<div class="album-info">'
          + '<div class="no">'+esc(a.date ? ('No.'+('0'+(i+1)).slice(-2)) : '')+'</div>'
          + '<h3>'+esc(a.title)+'</h3>'
          + '<div class="meta">'+esc(a.place)+' &nbsp;/&nbsp; '+esc(a.date)+'</div>'
          + '<p class="desc">'+esc(a.desc)+'</p>'
          + '<a class="more" href="album.html?id='+esc(id)+'&from=favorites">看完整游记 →</a>'
          + '</div></article>';
      });
      if(!html){
        html = '<article class="album-row reveal"><div class="cover-slider" style="background:var(--bg-soft);display:flex;align-items:center;justify-content:center;color:var(--ink-soft);min-height:360px;"><span style="letter-spacing:.3em;font-size:13px;">No.01 · 待添加</span></div>'
          + '<div class="album-info"><div class="no">No.01</div><h3>即将上线</h3><div class="meta">地点待定</div><p class="desc">在后台「新建相册」即可出现在这里。</p><span class="more" style="opacity:.5;cursor:default;">敬请期待</span></div></article>';
      }
      wrap.innerHTML = html;
    }

    // CHAPTER 02 PLACES 预览段：迷你中国地图
    var pt = document.getElementById('place-teaser');
    if(pt && d.places){
      pt.innerHTML = '<div class="mapwrap mini reveal">'
        + '<svg id="home-map" viewBox="0 0 800 620" role="img" aria-label="中国地图"></svg>'
        + '</div>'
        + '<div class="chapter-more"><a href="place.html">查看全部地点 →</a></div>';
      renderChinaMap('#home-map', d, {mini:true});
    }

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
          return '<div class="cell"><img data-full="'+esc(p.src)+'" data-cap="'+esc(p.cap||'')+'" src="'+esc(t)+'" alt="" loading="lazy"></div>';
      }).join('');
    }
    var order = d.galleryOrder && d.galleryOrder.length ? d.galleryOrder : Object.keys(d.albums);
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
  }

  /* ---------- 渲染：Places 完整页 ---------- */
  function renderPlaces(d){
    var svg = document.querySelector('#place-svg');
    if(svg) renderChinaMap('#place-svg', d, {mini:false});
    var legend = document.querySelector('.map-legend');
    if(legend) legend.textContent = '点亮省份 = 已有照片记录 · 点击进入省地图 · 海外地点在轮廓外';
  }

  /* ---------- 渲染：Province 省地图页 ---------- */
  function renderProvince(d){
    var params = new URLSearchParams(location.search);
    var pk = params.get('province');
    var provinces = d.places && d.places.provinces || {};
    var p = provinces[pk];
    if(!p){ document.body.innerHTML = '<p style="padding:120px;text-align:center;">省份不存在</p>'; return; }

    document.title = p.name + ' · Places · The Memory';
    var h1 = document.querySelector('.province-hero h1');
    if(h1) h1.textContent = p.name;
    var sub = document.querySelector('.province-hero .ph-sub');
    if(sub) sub.textContent = 'Province · 中国';

    // 省份真实地图：独立区块，含省界高亮（需 Key 已启用 WebServiceAPI）
    var mapKey2 = (d.site && d.site.mapKey) || '';
    var sec = document.getElementById('prov-map-sec');
    var pwrap = document.getElementById('prov-map-wrap');
    if(mapKey2 && p.lng != null && p.lat != null && sec && pwrap){
      sec.style.display = '';
      pwrap.innerHTML = '';
      var phost = document.createElement('div');
      phost.id = 'prov-map';
      phost.style.cssText = 'width:100%;height:460px;border-radius:12px;overflow:hidden;filter:' + MAP_FILTER + ';';
      pwrap.appendChild(phost);
      loadTMap(mapKey2).then(function(TMap){
        var citiesAll = p.cities || {};
        var pts = Object.keys(citiesAll).map(function(ck){
          var c = citiesAll[ck];
          var albums = c.albums || [];
          return { lng: c.lng, lat: c.lat, name: c.name || ck, lit: albums.length > 0,
            url: albums.length ? ('album.html?id=' + encodeURIComponent(albums[0])
                 + '&from=province&province=' + encodeURIComponent(pk)) : '' };
        }).filter(function(x){ return x.lng != null && x.lat != null; });
        var map = new TMap.Map(phost, {
          center: new TMap.LatLng(p.lat, p.lng),
          zoom: 7, pitch: 0, scrollwheel: false, baseMap: { type: 'vector' }
        });
        addTMapPoints(TMap, map, pts, function(x){ if(x.url) location.href = x.url; });
        // 省界高亮：拿行政区划边界，把视野框到该省
        try {
          var svc = new TMap.service.District({ polygon: 1 });
          svc.search({ keyword: p.name }).then(function(res){
            var items = (res && res.result) || [];
            var polys = [], minLat = 90, maxLat = -90, minLng = 180, maxLng = -90;
            items.forEach(function(it){
              if(!it || !it.polygon) return;
              it.polygon.split('|').forEach(function(ring){
                var ringPts = ring.split(';').map(function(s){
                  var xy = s.split(',');
                  var la = parseFloat(xy[0]), ln = parseFloat(xy[1]);
                  if(isNaN(la) || isNaN(ln)) return null;
                  if(la < minLat) minLat = la; if(la > maxLat) maxLat = la;
                  if(ln < minLng) minLng = ln; if(ln > maxLng) maxLng = ln;
                  return new TMap.LatLng(la, ln);
                }).filter(Boolean);
                if(ringPts.length > 2) polys.push(ringPts);
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
          }).catch(function(){});
        } catch (e) {}
      }).catch(function(){ sec.style.display = 'none'; });
    }

    // 城市卡片
    var grid = document.getElementById('city-grid');
    if(grid){
      var cities = p.cities || {};
      var keys = Object.keys(cities);
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
  function initAudioToggle(){
    document.querySelectorAll('.audio-toggle').forEach(function(btn){
      var src = btn.getAttribute('data-audio'); if(!src) return;
      var au = new Audio(src); au.loop = true; au.volume = 0.5;
      btn.addEventListener('click', function(){
        if(au.paused){ au.play().then(function(){ btn.classList.add('playing'); }).catch(function(){}); }
        else { au.pause(); btn.classList.remove('playing'); }
      });
    });
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
  function initVideoCarousel(){
    var vp=document.querySelector('.vpage'); if(!vp) return;
    var vids=(DATA && DATA.site && DATA.site.videos) ? DATA.site.videos
             : JSON.parse(vp.getAttribute('data-videos')||'[]');
    if(!vids.length) return;
    var stage=vp.querySelector('.vstage'), titleBox=vp.querySelector('.vtitle');
    var sub=titleBox.querySelector('.vt-sub'), main=titleBox.querySelector('.vt-main'), count=vp.querySelector('.vcount');
    var cur=0, timer=null;
    function load(i){
      cur=(i+vids.length)%vids.length; var v=vids[cur];
      stage.innerHTML='<video playsinline muted preload="auto"><source src="'+v.src+'" type="video/mp4"></video>';
      var video=stage.querySelector('video');
      titleBox.classList.remove('hide'); sub.textContent=v.sub||''; main.textContent=v.title||'';
      count.textContent=(cur+1)+' / '+vids.length;
      clearTimeout(timer);
      timer=setTimeout(function(){ titleBox.classList.add('hide'); video.muted=true; video.play().catch(function(){}); }, 3000);
    }
    vp.querySelector('.vprev').addEventListener('click',function(){load(cur-1);});
    vp.querySelector('.vnext').addEventListener('click',function(){load(cur+1);});
    vp.querySelector('.vclose').addEventListener('click',function(){ history.length>1?history.back():(location.href='index.html'); });
    document.addEventListener('keydown',function(e){ if(e.key==='ArrowLeft')load(cur-1); if(e.key==='ArrowRight')load(cur+1); });
    load(0);
  }

  /* ---------- 启动 ---------- */
  function boot(){
    initNav(); initReveal(); initAudioToggle();
    getJSON('data.json').then(function(d){
      DATA = applyCdn(d);
      d = DATA;
      var p = location.pathname;
      if(p.indexOf('album.html')>-1){
        var id = new URLSearchParams(location.search).get('id') || (d.galleryOrder&&d.galleryOrder[0]) || Object.keys(d.albums)[0];
        renderAlbum(d, id);
      } else if(p.indexOf('province.html')>-1){ renderProvince(d); }
      else if(p.indexOf('gallery.html')>-1){ renderGallery(d); }
      else if(p.indexOf('place.html')>-1){ renderPlaces(d); }
      else { renderHome(d); }
      initCoverSliders(); initLightbox();
      renderBreadcrumb(d);
      initVideoCarousel();
      initReveal();
    }).catch(function(e){ console.error('load data fail', e); });
  }
  if(document.readyState!=='loading') boot();
  else document.addEventListener('DOMContentLoaded', boot);
})();

// ==UserScript==
// @name         YouTube 悬浮小窗播放器
// @namespace    https://github.com/sin0317
// @version      1.0.0
// @author       sin (刘峻豪)
// @description  视频滚出视口时自动弹出可拖拽/可缩放的悬浮小窗，支持返回原位置、双击暂停、关闭。自包含，无需安装其他脚本，无外部 CDN 依赖。
// @license      MIT
// @match        https://www.youtube.com/watch*
// @match        https://music.youtube.com/watch*
// @match        https://m.youtube.com/watch*
// @grant        GM_addStyle
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_registerMenuCommand
// @run-at       document-idle
// @noframes
// ==/UserScript==

(function () {
  'use strict';

  /* ---------- 配置存储（Tampermonkey 沙箱内，独立保存） ---------- */
  const KEY = 'YT_MINI_';
  const get = (k, d) => GM_getValue(KEY + k, d);
  const set = (k, v) => GM_setValue(KEY + k, v);

  let enabled = get('enabled', true);   // 总开关
  let autoFloat = get('auto', true);    // 滚出视口自动弹出

  /* ---------- 运行时状态 ---------- */
  let wrap, bar, body, titleEl, resizeEl, playIcon;
  let player, container, originParent, originNext;
  let observer = null;
  let dragging = false, resizing = false;
  let dismissed = false;        // 用户点“关闭”后，在本次滚回视口前不再自动弹出
  let bootDone = false;

  /* ---------- 样式 ---------- */
  GM_addStyle(`
    .yt-mini-wrap{position:fixed;z-index:2147483647;width:400px;height:225px;
      background:#000;border-radius:10px;overflow:hidden;display:none;
      box-shadow:0 8px 30px rgba(0,0,0,.5);font-family:Roboto,Arial,sans-serif;
      border:1px solid rgba(255,255,255,.12)}
    .yt-mini-wrap.active{display:block}
    .yt-mini-bar{position:absolute;top:0;left:0;right:0;height:28px;z-index:3;
      display:flex;align-items:center;padding:0 6px;cursor:move;
      background:linear-gradient(rgba(0,0,0,.6),rgba(0,0,0,0));opacity:0;transition:opacity .15s}
    .yt-mini-wrap:hover .yt-mini-bar{opacity:1}
    .yt-mini-title{color:#fff;font-size:12px;flex:1;min-width:0;
      white-space:nowrap;overflow:hidden;text-overflow:ellipsis;pointer-events:none}
    .yt-mini-btn{width:22px;height:22px;border:none;background:transparent;color:#fff;
      font-size:14px;line-height:22px;cursor:pointer;border-radius:4px;flex:0 0 auto}
    .yt-mini-btn:hover{background:rgba(255,255,255,.22)}
    .yt-mini-body{position:absolute;inset:0;background:#000}
    .yt-mini-body .html5-video-container{width:100%!important;height:100%!important}
    .yt-mini-body video{width:100%!important;height:100%!important;object-fit:contain;
      position:static!important}
    .yt-mini-resize{position:absolute;right:0;bottom:0;width:16px;height:16px;z-index:4;
      cursor:nwse-resize;background:linear-gradient(135deg,transparent 50%,rgba(255,255,255,.55) 50%)}
    .yt-mini-playicon{position:absolute;inset:0;display:none;align-items:center;
      justify-content:center;font-size:46px;color:#fff;pointer-events:none;text-shadow:0 2px 8px #000}
    .yt-mini-wrap.paused .yt-mini-playicon{display:flex}
    .yt-mini-toggle{display:inline-flex!important;align-items:center;justify-content:center}
    .yt-mini-toggle svg{fill:#fff;opacity:.85}
    .yt-mini-toggle:hover svg{opacity:1}
    .yt-mini-toggle.active svg{fill:#ff4d4d;opacity:1}
  `);

  /* ---------- 构建 UI（只建一次） ---------- */
  function ensureUI() {
    if (wrap) return;
    wrap = document.createElement('div'); wrap.className = 'yt-mini-wrap';

    bar = document.createElement('div'); bar.className = 'yt-mini-bar';
    titleEl = document.createElement('div'); titleEl.className = 'yt-mini-title';
    const back = mkBtn('↩', '返回原位置', onBack);
    const close = mkBtn('✕', '关闭小窗', onClose);
    bar.append(titleEl, back, close);

    body = document.createElement('div'); body.className = 'yt-mini-body';
    resizeEl = document.createElement('div'); resizeEl.className = 'yt-mini-resize';
    playIcon = document.createElement('div'); playIcon.className = 'yt-mini-playicon';
    playIcon.textContent = '▶';

    wrap.append(bar, body, resizeEl, playIcon);
    document.documentElement.appendChild(wrap);

    // 播放/暂停状态同步（play/pause 事件冒泡，委托在 body 上即可）
    body.addEventListener('play', () => wrap.classList.remove('paused'), true);
    body.addEventListener('pause', () => wrap.classList.add('paused'), true);
    body.addEventListener('dblclick', () => {
      const v = container && container.querySelector('video');
      if (!v) return;
      v.paused ? v.play() : v.pause();
    });

    bindDrag();
    bindResize();

    // 恢复尺寸 / 位置
    wrap.style.width = get('w', 400) + 'px';
    wrap.style.height = get('h', 225) + 'px';
    const pos = get('pos', null);
    if (pos) {
      wrap.style.left = pos.x + 'px'; wrap.style.top = pos.y + 'px';
      wrap.style.right = 'auto'; wrap.style.bottom = 'auto';
    } else {
      wrap.style.right = '20px'; wrap.style.bottom = '20px';
    }
  }

  function mkBtn(text, tip, onclick) {
    const b = document.createElement('button');
    b.className = 'yt-mini-btn'; b.textContent = text; b.title = tip;
    b.onclick = onclick; return b;
  }

  /* ---------- 查找播放器元素 ---------- */
  function findEls() {
    player = document.querySelector('#movie_player') ||
             document.querySelector('.html5-video-player');
    if (!player) return false;
    container = player.querySelector('.html5-video-container');
    return !!container;
  }

  /* ---------- 弹出 / 收回 ---------- */
  function floatVideo() {
    if (!enabled || !autoFloat || dismissed) return;
    if (wrap.classList.contains('active')) return;
    if (!findEls()) return;
    const v = container.querySelector('video');
    if (!v) return;
    if (document.fullscreenElement) return;          // 全屏时不打扰

    originParent = container.parentElement;
    originNext = container.nextSibling;
    titleEl.textContent = (document.title || '').replace(/ - YouTube$/, '').replace(/ - YouTube Music$/, '');
    body.appendChild(container);
    wrap.classList.add('active');
    wrap.classList.toggle('paused', v.paused);
    updateToggleState();
  }

  function hideMini() {
    if (!wrap.classList.contains('active')) return;
    if (container && originParent && originParent.isConnected) {
      // 优先插回原来的“下一个兄弟”之前；若它已被 YouTube 重建，则退回 controls 之前
      let ref = (originNext && originNext.isConnected)
        ? originNext
        : (player.querySelector('.ytp-chrome-bottom') || null);
      originParent.insertBefore(container, ref);
    }
    wrap.classList.remove('active');
    updateToggleState();
  }

  function onBack() { hideMini(); dismissed = false; }
  function onClose() { hideMini(); dismissed = true; }

  /* ---------- 拖拽 ---------- */
  let sx = 0, sy = 0;
  function bindDrag() {
    bar.addEventListener('pointerdown', (e) => {
      if (e.target.closest('button')) return;
      dragging = true; bar.setPointerCapture(e.pointerId);
      sx = e.clientX - wrap.offsetLeft; sy = e.clientY - wrap.offsetTop;
    });
    bar.addEventListener('pointermove', (e) => {
      if (!dragging) return;
      let x = e.clientX - sx, y = e.clientY - sy;
      x = Math.max(0, Math.min(x, innerWidth - wrap.offsetWidth));
      y = Math.max(0, Math.min(y, innerHeight - wrap.offsetHeight));
      wrap.style.left = x + 'px'; wrap.style.top = y + 'px';
      wrap.style.right = 'auto'; wrap.style.bottom = 'auto';
    });
    bar.addEventListener('pointerup', (e) => {
      dragging = false;
      try { bar.releasePointerCapture(e.pointerId); } catch (_) {}
      snapToEdge();
      set('pos', { x: wrap.offsetLeft, y: wrap.offsetTop });
    });
  }

  /* ---------- 拖拽结束吸附最近屏幕边缘 ---------- */
  const SNAP = 16; // 距边缘小于该阈值即吸附
  function snapToEdge() {
    const r = wrap.getBoundingClientRect();
    const leftDist = r.left, rightDist = innerWidth - r.right;
    const topDist = r.top, bottomDist = innerHeight - r.bottom;
    const minH = Math.min(leftDist, rightDist);
    const minV = Math.min(topDist, bottomDist);
    if (minH >= SNAP && minV >= SNAP) return; // 离四边都够远，不吸附
    if (minH <= minV) {                        // 贴左右
      wrap.style.top = r.top + 'px'; wrap.style.bottom = 'auto';
      if (leftDist <= rightDist) { wrap.style.left = '0px'; wrap.style.right = 'auto'; }
      else { wrap.style.left = 'auto'; wrap.style.right = '0px'; }
    } else {                                   // 贴上下
      wrap.style.left = r.left + 'px'; wrap.style.right = 'auto';
      if (topDist <= bottomDist) { wrap.style.top = '0px'; wrap.style.bottom = 'auto'; }
      else { wrap.style.top = 'auto'; wrap.style.bottom = '0px'; }
    }
  }

  /* ---------- 缩放 ---------- */
  let rsx = 0, rsy = 0, rw = 0, rh = 0;
  function bindResize() {
    resizeEl.addEventListener('pointerdown', (e) => {
      resizing = true; resizeEl.setPointerCapture(e.pointerId);
      rsx = e.clientX; rsy = e.clientY;
      rw = wrap.offsetWidth; rh = wrap.offsetHeight;
      e.stopPropagation();
    });
    resizeEl.addEventListener('pointermove', (e) => {
      if (!resizing) return;
      wrap.style.width = Math.max(200, rw + (e.clientX - rsx)) + 'px';
      wrap.style.height = Math.max(120, rh + (e.clientY - rsy)) + 'px';
    });
    resizeEl.addEventListener('pointerup', (e) => {
      resizing = false;
      try { resizeEl.releasePointerCapture(e.pointerId); } catch (_) {}
      set('w', wrap.offsetWidth); set('h', wrap.offsetHeight);
    });
  }

  /* ---------- 视口监测 ---------- */
  function setupObserver() {
    if (observer) observer.disconnect();
    if (!findEls()) return;
    observer = new IntersectionObserver(([entry]) => {
      if (!entry.isIntersecting) {
        if (!dismissed) floatVideo();
      } else {
        dismissed = false;                 // 滚回视口，允许再次自动弹出
        if (wrap.classList.contains('active')) hideMini();
      }
    }, { threshold: 0 });
    observer.observe(player);
  }

  /* ---------- 菜单 ---------- */
  function setupMenu() {
    GM_registerMenuCommand('YouTube 小窗：' + (enabled ? '已启用' : '已停用'), () => {
      set('enabled', !enabled); location.reload();
    });
    GM_registerMenuCommand('滚动自动弹出：' + (autoFloat ? '开' : '关'), () => {
      set('auto', !autoFloat); location.reload();
    });
    GM_registerMenuCommand('设置小窗尺寸 (宽x高)', () => {
      const s = prompt('输入小窗尺寸，如 480x270', get('w', 400) + 'x' + get('h', 225));
      if (s && /^\d+\s*x\s*\d+$/i.test(s)) {
        const [w, h] = s.toLowerCase().split('x').map(Number);
        set('w', w); set('h', h); alert('已保存，刷新页面后生效');
      }
    });
    GM_registerMenuCommand('重置小窗位置', () => {
      set('pos', null); alert('已重置，刷新页面后生效');
    });
  }

  /* ---------- 播放器控制栏上的“小窗”按钮 ---------- */
  let toggleBtn = null;
  function ensureToggleBtn() {
    const ctrlBar = document.querySelector('.ytp-right-controls');
    if (!ctrlBar || ctrlBar.querySelector('.yt-mini-toggle')) return;
    const btn = document.createElement('button');
    btn.className = 'ytp-button yt-mini-toggle';
    btn.title = '悬浮小窗（点击弹出/收回）';
    btn.innerHTML = '<svg viewBox="0 0 24 24" width="36" height="36">' +
      '<path d="M19 7h-8v6h8V7zm2-4H3c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h18c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm0 16.01H3V4.98h18v14.03z"/>' +
      '</svg>';
    btn.addEventListener('click', toggleMini);
    ctrlBar.insertBefore(btn, ctrlBar.firstChild);
    toggleBtn = btn;
    updateToggleState();
  }
  function toggleMini() {
    ensureUI();
    dismissed = false;
    if (wrap.classList.contains('active')) onBack();
    else floatVideo();
  }
  function updateToggleState() {
    if (toggleBtn) toggleBtn.classList.toggle('active', wrap.classList.contains('active'));
  }

  /* ---------- 启动 / 重新绑定（应对 YouTube SPA） ---------- */
  function boot() {
    if (bootDone || !enabled) return;
    bootDone = true;
    ensureUI();
    setupMenu();
    ensureToggleBtn();
    if (!toggleBtn) {                       // 控制栏可能还没渲染，稍后重试
      const t2 = setInterval(() => {
        ensureToggleBtn(); if (toggleBtn) clearInterval(t2);
      }, 800);
      setTimeout(() => clearInterval(t2), 15000);
    }
    if (findEls()) setupObserver();
    else {
      const t = setInterval(() => {
        if (findEls()) { clearInterval(t); setupObserver(); }
      }, 800);
      setTimeout(() => clearInterval(t), 15000);
    }
  }

  document.addEventListener('yt-navigate-finish', () => {
    if (wrap && wrap.classList.contains('active')) hideMini();
    dismissed = false;
    setTimeout(() => { if (findEls()) setupObserver(); }, 300);
    ensureToggleBtn();
  });

  if (document.readyState === 'loading') {
    window.addEventListener('load', boot, { once: true });
  } else {
    boot();
  }
})();

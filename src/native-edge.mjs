// Only the native backdrop changes. The page, wallpaper and controls are never styled.
export function edgePixels(snapshot, color, mode, base, targetColor = null) {
    const { width: w, height: h, insets: s } = snapshot;
    const target = typeof targetColor === 'string' && /^#[0-9a-f]{6}$/i.test(targetColor)
        ? [1, 3, 5].map(i => parseInt(targetColor.slice(i, i + 2), 16)) : null;
    const pixels = new Uint8ClampedArray(w * h * 4);
    const write = (x, y, distance) => {
        const i = (y * w + x) * 4;
        const mix = mode === 'soft' ? (target ? 1 : .12) * distance : 0;
        for (let c = 0; c < 3; c++) pixels[i + c] = Math.round(color[c] * (1 - mix) + (target || base)[c] * mix);
        pixels[i + 3] = 255;
    };
    for (let y = 0; y < s.top; y++) for (let x = 0; x < w; x++) write(x, y, s.top > 1 ? (s.top - 1 - y) / (s.top - 1) : 0);
    for (let y = h - s.bottom; y < h; y++) for (let x = 0; x < w; x++) write(x, y, s.bottom > 1 ? (y - (h - s.bottom)) / (s.bottom - 1) : 0);
    for (let y = s.top; y < h - s.bottom; y++) {
        for (let x = 0; x < s.left; x++) write(x, y, s.left > 1 ? (s.left - 1 - x) / (s.left - 1) : 0);
        for (let x = w - s.right; x < w; x++) write(x, y, s.right > 1 ? (x - (w - s.right)) / (s.right - 1) : 0);
    }
    return pixels;
}

// Pick one dominant toolbar background, rather than stretching individual pixels.
// Icons and text occupy a minority; sidebar artwork is outside the sampling rectangle.
export function toolbarColor(pixels) {
    const counts = new Map(); let winner = null, most = 0;
    for (let i = 0; i < pixels.length; i += 4) {
        if (pixels[i + 3] < 128) continue;
        const key = (pixels[i] << 16) | (pixels[i + 1] << 8) | pixels[i + 2];
        const count = (counts.get(key) || 0) + 1; counts.set(key, count);
        if (count > most) { most = count; winner = key; }
    }
    if (winner === null) throw Error('未能识别图标栏底色');
    return [(winner >> 16) & 255, (winner >> 8) & 255, winner & 255];
}

export function createNativeEdge(doc, headers = () => ({}), installGuard = null) {
    const win = doc.defaultView;
    const owned = new Set();
    let sequence = 0, cached = null, enabled = false, guardReady = null, replayTask = null;
    const session = Math.random().toString(36).slice(2);
    const abi = () => {
        const host = win.__TAURITAVERN__;
        if (!host?.invoke?.safeInvoke) throw Error('此环境没有 TT 原生边缘取样接口');
        return host;
    };
    const invoke = (name, args) => abi().invoke.safeInvoke(name, args);
    function cachedRequest(snapshot) {
        if (cached.request.windowRevision === snapshot.revision) return { ...cached.request, windowRevision: snapshot.revision };
        // Geometry changed: keep the known toolbar color until the new strip is ready.
        return { windowRevision: snapshot.revision, color: cached.color, wallpaper: { resourcePath: null, size: 'cover', position: '0px 0px' } };
    }
    async function guard(command, args) {
        if (command === 'set_window_backdrop' && enabled && cached && args?.request) {
            const revision = args.request.windowRevision;
            // Same geometry: keep the existing strips, rather than clearing/decoding them.
            const request = cached.request.windowRevision === revision
                ? { windowRevision: revision, color: cached.color }
                : cachedRequest({ revision });
            return invoke(command, { ...args, request });
        }
        return invoke(command, args);
    }
    async function ensureGuard() {
        if (!installGuard) return;
        if (!guardReady) guardReady = Promise.resolve().then(() => installGuard(guard)).catch(error => { guardReady = null; throw error; });
        await guardReady;
    }
    function replay(isCurrent = () => true) {
        if (!enabled || !cached) return Promise.resolve(false);
        if (replayTask) return replayTask;
        replayTask = (async () => {
            const snapshot = await invoke('get_window_snapshot');
            if (!snapshot || !enabled || !cached || !isCurrent()) return false;
            const request = cached.request.windowRevision === snapshot.revision
                ? { windowRevision: snapshot.revision, color: cached.color }
                : cachedRequest(snapshot);
            await invoke('set_window_backdrop', { request });
            return true;
        })().finally(() => { replayTask = null; });
        return replayTask;
    }

    async function post(path, data) {
        const res = await win.fetch(path, { method: 'POST', headers: { ...headers(), 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
        if (!res.ok) throw Error('本地色带保存失败：' + res.status);
        return res.json();
    }
    async function cleanup(except) {
        for (const path of [...owned]) if (path !== except) {
            try { await post('/api/images/delete', { path }); owned.delete(path); } catch { /* Retry only our own temporary files next time. */ }
        }
    }
    function baseColor() {
        const canvas = doc.createElement('canvas'); canvas.width = canvas.height = 1;
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = 'white'; ctx.fillRect(0, 0, 1, 1);
        ctx.fillStyle = win.getComputedStyle(doc.body).backgroundColor; ctx.fillRect(0, 0, 1, 1);
        return [...ctx.getImageData(0, 0, 1, 1).data].slice(0, 3);
    }
    async function restore() {
        enabled = false;
        const snapshot = await invoke('get_window_snapshot');
        const bg = doc.getElementById('bg1');
        const style = bg && win.getComputedStyle(bg);
        let resourcePath = null;
        if (style && style.display !== 'none' && style.visibility !== 'hidden') {
            const match = /^url\(["']?(.*?)["']?\)$/.exec(style.backgroundImage);
            if (match) { const url = new URL(match[1], win.location.href); if (url.origin === win.location.origin) resourcePath = url.pathname; }
        }
        await invoke('set_window_backdrop', { request: { windowRevision: snapshot.revision, color: baseColor(), wallpaper: { resourcePath, size: style?.backgroundSize || 'cover', position: `${style?.backgroundPositionX || '50%'} ${style?.backgroundPositionY || '50%'}` } } });
        cached = null;
        await cleanup();
    }
    function appearanceSignature() {
        const toolbar = [doc.getElementById('top-settings-holder'), doc.getElementById('top-bar')]
            .filter(Boolean).find(el => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 && r.height < 160 && r.bottom > 0 && r.top < win.innerHeight; });
        if (!toolbar) throw Error('未找到顶部图标栏，无法识别底色');
        const nodes = new Set([doc.documentElement, doc.body, doc.getElementById('top-bar'), doc.getElementById('bg1'), doc.getElementById('bg_custom')]);
        for (let node = toolbar; node; node = node.parentElement) nodes.add(node);
        const properties = ['background-color', 'background-image', 'background-size', 'background-position', 'opacity', 'filter', 'backdrop-filter', '-webkit-backdrop-filter', 'mix-blend-mode', 'display', 'visibility', 'color', '--sb-bar-bg', '--SmartThemeBlurTintColor'];
        return { toolbar, signature: [...nodes].filter(Boolean).map(node => { const style = win.getComputedStyle(node); return properties.map(key => style.getPropertyValue(key)); }) };
    }
    async function apply(mode, isCurrent = () => true, targetColor = null) {
        if (mode === 'off') return restore();
        enabled = true;
        await ensureGuard();
        if (!isCurrent()) return;
        if (!abi().api?.layout?.capture) throw Error('TT 未提供页面边缘取样接口');
        if (doc.querySelector('dialog[open]')) return;
        const snapshot = await invoke('get_window_snapshot');
        if (!snapshot) throw Error('此宿主没有移动端窗口背景');
        const { width: w, height: h, insets: s, scale } = snapshot;
        if (!w || !h || w * h > 20000000) throw Error('不支持的窗口尺寸');
        const contentW = w - s.left - s.right, contentH = h - s.top - s.bottom;
        // A docked keyboard changes the content height, not the native window snapshot.
        if (Math.abs(win.innerHeight * scale - contentH) > 8 || Math.abs(win.innerWidth * scale - contentW) > 8) return;
        const appearance = appearanceSignature();
        const rect = appearance.toolbar.getBoundingClientRect();
        const inputKey = JSON.stringify([snapshot.revision, w, h, scale, s, mode, mode === 'soft' ? targetColor : null, appearance.signature, [rect.left, rect.top, rect.width, rect.height]]);
        // Menu/chat state mutations do not necessarily change the rendered background.
        if (cached?.inputKey === inputKey) return;
        const blob = await abi().api.layout.capture();
        if (!isCurrent()) return;
        const url = win.URL.createObjectURL(blob), image = new win.Image();
        try {
            await new Promise((resolve, reject) => { image.onload = resolve; image.onerror = () => reject(Error('边缘取样失败')); image.src = url; });
            const source = doc.createElement('canvas'); source.width = contentW; source.height = contentH;
            const ctx = source.getContext('2d', { willReadFrequently: true });
            ctx.drawImage(image, 0, 0, contentW, contentH);
            const toolbar = appearance.toolbar.getBoundingClientRect();
            const x = Math.max(0, Math.min(contentW - 1, Math.floor(toolbar.left * scale)));
            const y = Math.max(0, Math.min(contentH - 1, Math.floor(toolbar.top * scale)));
            const sampleW = Math.max(1, Math.min(contentW - x, Math.floor(toolbar.width * scale)));
            const sampleH = Math.max(1, Math.min(contentH - y, Math.floor(toolbar.height * scale)));
            const color = toolbarColor(ctx.getImageData(x, y, sampleW, sampleH).data);
            const base = baseColor();
            const visualKey = JSON.stringify([snapshot.revision, w, h, scale, s, mode, color, mode === 'soft' ? (targetColor || base) : null]);
            // Even a changed stylesheet/wallpaper can produce the same toolbar color.
            // Keep the native strip intact instead of clearing it for an identical image.
            if (cached?.visualKey === visualKey) { if (isCurrent()) cached.inputKey = inputKey; return; }
            const pixels = edgePixels(snapshot, color, mode, base, targetColor);
            const output = doc.createElement('canvas'); output.width = w; output.height = h;
            const paint = output.getContext('2d'); const data = paint.createImageData(w, h); data.data.set(pixels); paint.putImageData(data, 0, 0);
            // Only generated edge pixels are saved locally. The page screenshot is discarded.
            if (!isCurrent()) return;
            const saved = await post('/api/images/upload', { image: output.toDataURL('image/png').split(',')[1], format: 'png', ch_name: 'tvrm-edge-cache', filename: `edge-${session}-${++sequence}` });
            const path = saved.path;
            if (typeof path !== 'string' || !path.includes('/tvrm-edge-cache/')) throw Error('本地色带路径无效');
            owned.add(path);
            if (!isCurrent()) { await cleanup(); return; }
            const latest = await invoke('get_window_snapshot');
            if (!isCurrent() || latest.revision !== snapshot.revision) { await cleanup(); return; }
            const request = { windowRevision: snapshot.revision, color, wallpaper: { resourcePath: new URL('/' + path.replace(/^\/+/, ''), win.location.href).pathname, size: '100% 100%', position: '0px 0px' } };
            await invoke('set_window_backdrop', { request });
            cached = { request, color, inputKey, visualKey };
            await cleanup(path);
        } catch (error) {
            if (!cached) { try { await restore(); } catch { /* Preserve the original failure for the settings panel. */ } }
            throw error;
        } finally { win.URL.revokeObjectURL(url); }
    }
    return { apply, replay };
}

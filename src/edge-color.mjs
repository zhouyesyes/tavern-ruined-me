// No CSS overlay, body recoloring or wallpaper hiding: only publish native edge pixels.
export function createEdgeColor(doc, publish, report = () => {}, replay = null) {
    let mode = 'off', targetColor = null, observer = null, timer = null, generation = 0;
    let pending = false, running = false, destroyed = false;
    const win = doc.defaultView;
    const media = win.matchMedia?.('(prefers-color-scheme: dark)');
    async function sync() {
        pending = true;
        if (running) return;
        running = true;
        try {
            while (pending) {
                pending = false;
                const current = generation, value = mode, color = targetColor;
                try {
                    if (!publish) throw Error('缺少 TT 原生背景接口');
                    await publish(value, () => current === generation, color);
                    if (current === generation) report('');
                } catch (error) {
                    if (current === generation) report('外层颜色未同步：' + (error?.message || '取样失败') + '。页面和原壁纸保持不变。');
                }
            }
        } finally { running = false; }
    }
    function schedule() {
        if (mode === 'off' || destroyed) return;
        generation++;
        win.clearTimeout(timer);
        timer = win.setTimeout(sync, 250);
    }
    function resume() {
        if (mode === 'off' || destroyed || doc.visibilityState === 'hidden') return;
        schedule();
        const selected = mode, color = targetColor;
        // Cached native colors do not wait for the normal sampling debounce/upload.
        if (replay) Promise.resolve().then(() => replay(() => mode === selected && targetColor === color && mode !== 'off' && !destroyed)).catch(() => {});

    }
    function watch() {
        if (observer || !win.MutationObserver) return;
        observer = new win.MutationObserver(schedule);
        for (const node of [doc.documentElement, doc.body, doc.head, doc.getElementById('bg1'), doc.getElementById('bg_custom'), doc.getElementById('top-bar'), doc.getElementById('top-settings-holder'), doc.getElementById('send_form')].filter(Boolean)) {
            observer.observe(node, { attributes: true, attributeFilter: ['style', 'class', 'href', 'media'], childList: node === doc.head, subtree: node === doc.head, characterData: node === doc.head });
        }
        win.addEventListener('tt-window-changed', resume);
        win.addEventListener('resize', schedule);
        win.addEventListener('focus', resume);
        win.addEventListener('pageshow', resume);
        doc.addEventListener('visibilitychange', resume);
        media?.addEventListener?.('change', schedule);
        doc.addEventListener('close', schedule, true);
    }
    function unwatch() {
        observer?.disconnect(); observer = null; win.clearTimeout(timer);
        win.removeEventListener('tt-window-changed', resume);
        win.removeEventListener('resize', schedule);
        win.removeEventListener('focus', resume);
        win.removeEventListener('pageshow', resume);
        doc.removeEventListener('visibilitychange', resume);
        media?.removeEventListener?.('change', schedule);
        doc.removeEventListener('close', schedule, true);
    }
    function apply(value, color = null) {
        const next = ['dark', 'soft'].includes(value) ? value : 'off';
        const target = typeof color === 'string' && /^#[0-9a-f]{6}$/i.test(color) ? color.toLowerCase() : null;
        if (destroyed || (next === mode && target === targetColor)) return;
        targetColor = target;
        if (next === 'off' && mode === 'off') return;
        mode = next; generation++;
        mode === 'off' ? unwatch() : watch();
        sync();
    }
    return { apply, retry: sync, destroy() { if (mode !== 'off') apply('off'); destroyed = true; unwatch(); } };
}

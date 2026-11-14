// No CSS overlay, body recoloring or wallpaper hiding: only publish native edge pixels.
export function createEdgeColor(doc, publish, report = () => {}) {
    let mode = 'off', observer = null, timer = null, generation = 0;
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
                const current = generation, value = mode;
                try {
                    if (!publish) throw Error('缺少 TT 原生背景接口');
                    await publish(value, () => current === generation);
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
    function watch() {
        if (observer || !win.MutationObserver) return;
        observer = new win.MutationObserver(schedule);
        for (const node of [doc.documentElement, doc.body, doc.head, doc.getElementById('bg1'), doc.getElementById('bg_custom'), doc.getElementById('top-bar'), doc.getElementById('top-settings-holder'), doc.getElementById('send_form')].filter(Boolean)) {
            observer.observe(node, { attributes: true, attributeFilter: ['style', 'class', 'href', 'media'], childList: node === doc.head, subtree: node === doc.head, characterData: node === doc.head });
        }
        win.addEventListener('tt-window-changed', schedule);
        win.addEventListener('resize', schedule);
        win.addEventListener('focus', schedule);
        media?.addEventListener?.('change', schedule);
        doc.addEventListener('close', schedule, true);
    }
    function unwatch() {
        observer?.disconnect(); observer = null; win.clearTimeout(timer);
        win.removeEventListener('tt-window-changed', schedule);
        win.removeEventListener('resize', schedule);
        win.removeEventListener('focus', schedule);
        media?.removeEventListener?.('change', schedule);
        doc.removeEventListener('close', schedule, true);
    }
    function apply(value) {
        const next = ['dark', 'soft'].includes(value) ? value : 'off';
        if (next === mode || destroyed) return;
        mode = next; generation++;
        mode === 'off' ? unwatch() : watch();
        sync();
    }
    return { apply, retry: sync, destroy() { if (mode !== 'off') apply('off'); destroyed = true; unwatch(); } };
}

// TT draws the system areas itself. Publish through its first-party backdrop writer;
// never overwrite the wallpaper URL, fitting or saved theme settings.
export function createEdgeColor(doc, publish, report = () => {}) {
    let mode = 'off', style = null, overlay = null, observer = null, generation = 0;
    const css = `
body.tvrm-edge-dark {background-color:#101012!important}
body.tvrm-edge-soft {background-color:#503b43!important}
body:is(.tvrm-edge-dark,.tvrm-edge-soft) :is(#bg1,#bg_custom) {display:none!important}
#tvrm-edge-fade {position:fixed;inset:0;pointer-events:none!important;z-index:2147480000;background:linear-gradient(to bottom,#503b43 0,rgba(80,59,67,.55) 12px,transparent 64px,transparent calc(100% - 64px),rgba(80,59,67,.55) calc(100% - 12px),#503b43 100%)}
`;
    async function sync() {
        const current = ++generation;
        try { await publish?.(); if (current === generation) report(''); }
        catch { if (current === generation) report('页面效果已应用，但外层颜色同步失败；请确认使用 TT 2.4.0，并重试。'); }
    }
    function apply(value) {
        const next = ['dark', 'soft'].includes(value) ? value : 'off';
        if (next === mode) return;
        mode = next;
        doc.body.classList.remove('tvrm-edge-dark', 'tvrm-edge-soft');
        overlay?.remove(); overlay = null;
        if (mode !== 'off') {
            if (!style) { style = doc.createElement('style'); style.textContent = css; doc.head.append(style); }
            doc.body.classList.add('tvrm-edge-' + mode);
            if (mode === 'soft') { overlay = doc.createElement('div'); overlay.id = 'tvrm-edge-fade'; overlay.setAttribute('aria-hidden', 'true'); doc.body.append(overlay); }
            if (!observer && doc.defaultView.MutationObserver) {
                observer = new doc.defaultView.MutationObserver(() => sync());
                // Wallpaper changes still update their original DOM, ready to restore on exit.
                for (const el of [doc.body, doc.getElementById('bg1')].filter(Boolean)) observer.observe(el, { attributes: true, attributeFilter: ['style', 'class'] });
            }
        } else { observer?.disconnect(); observer = null; style?.remove(); style = null; }
        sync();
    }
    return { apply, retry: sync, destroy() { apply('off'); } };
}

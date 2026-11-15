// Fold only the native inline Quick Reply bar. Keep every native button and
// handler intact, and place the disclosure before the form, never in the textarea row.
export function createQuickReplyFold(doc, changed = () => {}) {
    const win = doc.defaultView, flag = 'tvrm-quick-replies-folded';
    let active = false, open = false, form = null, handle = null, style = null, observer = null, life = null, queued = false;
    let hadClass = false;
    function sync() {
        if (!active || !form?.isConnected) return;
        const bar = form.querySelector('#qr--bar');
        if (!bar?.querySelector('.qr--button')) { handle?.remove(); handle = null; return; }
        if (!handle) {
            handle = doc.createElement('button'); handle.type = 'button'; handle.id = 'tvrm-quick-reply-toggle';
            handle.innerHTML = '<svg viewBox="0 0 28 8" aria-hidden="true"><path d="M5 4H23"/></svg>';
            handle.addEventListener('click', () => { open = !open; paint(); changed(open); });
        }
        if (handle.parentElement !== form.parentElement || handle.nextElementSibling !== form) form.before(handle);
        handle.style.order = win.getComputedStyle(form).order;
        paint();
    }
    function paint() {
        if (doc.documentElement.classList.contains(flag) !== !open) doc.documentElement.classList.toggle(flag, !open);
        if (handle) { handle.setAttribute('aria-expanded', String(open)); handle.setAttribute('aria-controls', 'qr--bar'); handle.title = open ? '收起快捷回复' : '展开快捷回复'; handle.setAttribute('aria-label', handle.title); }
    }
    function schedule() {
        if (!active || queued) return; queued = true;
        win.queueMicrotask(() => { queued = false; sync(); });
    }
    function bind(next = doc.getElementById('send_form')) {
        observer?.disconnect(); form = next;
        if (form) { observer.observe(form, { childList:true, subtree:true }); sync(); }
        else { handle?.remove(); handle = null; }
    }
    function start() {
        active = true; hadClass = doc.documentElement.classList.contains(flag);
        style = doc.createElement('style'); style.textContent = `
html.${flag} #send_form #qr--bar{display:none!important}
#tvrm-quick-reply-toggle{display:flex!important;justify-content:center;align-items:center;box-sizing:border-box;flex:0 0 18px;width:100%;height:18px;min-height:18px;max-height:18px;margin:0;padding:0;border:0;border-radius:0;background:transparent;color:var(--sb-bar-accent,var(--SmartThemeBodyColor,currentColor));opacity:.65;box-shadow:none;cursor:pointer;touch-action:manipulation}
#tvrm-quick-reply-toggle svg{display:block;width:28px;height:8px;fill:none;stroke:currentColor;stroke-width:2.5;stroke-linecap:round;pointer-events:none}
#tvrm-quick-reply-toggle:focus-visible{outline:1px solid currentColor;outline-offset:-2px;opacity:1}
`;
        doc.head.append(style); observer = new win.MutationObserver(schedule);
        life = new win.MutationObserver(records => {
            if (form?.isConnected) return;
            for (const record of records) for (const node of record.addedNodes) {
                if (node.nodeType !== 1) continue;
                const next = node.id === 'send_form' ? node : node.querySelector('#send_form');
                if (next?.isConnected) { bind(next); return; }
            }
            if (form) bind(null);
        });
        life.observe(doc.body, { childList:true, subtree:true }); bind(); paint();
    }
    function destroy() {
        if (!active) return; active = false; observer?.disconnect(); life?.disconnect(); handle?.remove(); handle = null; style?.remove(); form = null;
        doc.documentElement.classList.toggle(flag, hadClass);
    }
    function apply(options = {}) {
        open = options.open === true;
        if (options.enabled === false) { destroy(); return; }
        if (!active) start(); else sync();
        paint();
    }
    return { apply, sync, destroy };
}

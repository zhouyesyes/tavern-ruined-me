// Reveal the native inline Quick Reply bar while using the composer. Preserve
// native nodes/handlers; visibility is transient and never saved as a preference.
export function createQuickReplyFold(doc) {
    const win = doc.defaultView, flag = 'tvrm-quick-replies-folded';
    let active = false, open = false, form = null, style = null, life = null;
    let hadClass = false;
    const editor = target => target?.closest?.('#send_textarea') && form?.contains(target);
    const inBar = target => target?.closest?.('#qr--bar') && form?.contains(target);
    function paint(value) {
        open = value;
        if (doc.documentElement.classList.contains(flag) !== !open) doc.documentElement.classList.toggle(flag, !open);
    }
    function sync() {
        if (!active) return;
        const next = doc.getElementById('send_form');
        if (next !== form) { form = next; paint(false); }
    }
    function click(event) { if (editor(event.target)) paint(true); }
    function outside(event) {
        if (open && !editor(event.target) && !inBar(event.target)) paint(false);
    }
    function gesture(event) {
        if (open && !editor(event.target) && !inBar(event.target)) paint(false);
    }
    function key(event) {
        if (event.key === 'Escape') paint(false);
        else if (editor(event.target) && event.key !== 'Tab') paint(true);
    }
    function focus(event) {
        if (open && !editor(event.target) && !inBar(event.target)) paint(false);
    }
    const listeners = [['click',click],['pointerdown',outside],['touchstart',outside],['touchmove',gesture],['wheel',gesture],['keydown',key],['focusin',focus]];
    function start() {
        active = true; hadClass = doc.documentElement.classList.contains(flag);
        style = doc.createElement('style');
        style.textContent = `html.${flag} #send_form #qr--bar{display:none!important}`;
        doc.head.append(style);
        life = new win.MutationObserver(() => { if (!form?.isConnected) sync(); });
        life.observe(doc.body, { childList:true, subtree:true });
        for (const [name, handler] of listeners) doc.addEventListener(name, handler, { capture:true, passive:true });
        sync(); paint(false);
    }
    function destroy() {
        if (!active) return;
        active = false; life?.disconnect(); style?.remove(); form = null; open = false;
        for (const [name, handler] of listeners) doc.removeEventListener(name, handler, true);
        doc.documentElement.classList.toggle(flag, hadClass);
    }
    function apply(options = {}) {
        if (options.enabled === false) { destroy(); return; }
        if (!active) start(); else sync();
    }
    return { apply, sync, destroy };
}

// Preserve static-chat geometry through late media/layout changes. All position
// writes use the host's scroll API; bounded ChatSurface retains full ownership.
export function createChatStability(doc, getContext, preferences = () => ({})) {
    const win = doc.defaultView;
    let enabled = false, root = null, resize = null, mutation = null, watched = new Set();
    let state = null, anchor = null, following = false, frame = null, idle = null, touch = false, browsing = false;
    const measure = () => root ? { top:root.scrollTop, height:root.scrollHeight, view:root.clientHeight } : null;
    const atEnd = value => value && value.height - value.view - value.top < 24;
    const supported = () => enabled && root?.isConnected && root.getAttribute('data-tt-chat-surface') !== 'bounded'
        && typeof getContext()?.scrollChatSurfaceTo === 'function';
    const autoBottom = () => preferences()?.autoBottom !== false;
    const editing = () => root?.contains(doc.activeElement) && doc.activeElement.matches('input,textarea,[contenteditable=true]');
    function pickAnchor() {
        if (!root || !root.clientHeight) return null;
        const top = root.getBoundingClientRect().top + root.clientTop, bottom = top + root.clientHeight;
        // Prefer the visible paragraph/block, so growth within a long message is handled.
        let fallback = null;
        for (const message of root.querySelectorAll(':scope > .mes')) {
            const r = message.getBoundingClientRect(); if (r.bottom <= top || r.top >= bottom) continue;
            fallback ??= { node:message, offset:r.top - top };
            for (const node of message.querySelectorAll('.mes_text > *')) {
                const box = node.getBoundingClientRect();
                if (box.height && box.bottom > top + 1 && box.top < bottom) return { node, offset:box.top - top };
            }
        }
        return fallback;
    }
    function remember() {
        state = measure(); following = !!(autoBottom() && atEnd(state)); anchor = following ? null : pickAnchor();
    }
    function settle() {
        win.clearTimeout(idle);
        idle = win.setTimeout(() => { if (!enabled || touch || !supported()) return; browsing = false; remember(); }, 180);
    }
    function reconcile() {
        frame = null;
        if (!supported()) return;
        const current = measure();
        if (!state) { remember(); return; }
        if (browsing || touch || editing()) { state = current; anchor = pickAnchor(); return; }
        const changed = Math.abs(current.height - state.height) > 1 || Math.abs(current.view - state.view) > 1;
        if (!changed) return;
        let target = null;
        if (following && autoBottom()) target = current.height - current.view;
        else if (anchor?.node.isConnected && root.contains(anchor.node)) {
            const top = root.getBoundingClientRect().top + root.clientTop;
            target = current.top + anchor.node.getBoundingClientRect().top - top - anchor.offset;
        }
        if (target !== null) {
            target = Math.max(0, Math.min(current.height - current.view, target));
            if (Math.abs(target - current.top) > 1) getContext().scrollChatSurfaceTo({ top:target, behavior:'instant' });
        }
        // Preserve the existing follow/reading intent; a layout shift is not user input.
        state = measure(); if (!following) anchor = pickAnchor();
    }
    function schedule() {
        if (!supported() || frame !== null) return;
        frame = win.requestAnimationFrame(reconcile);
    }
    function watchMessages() {
        if (!resize || !root) return;
        const next = new Set([root, ...root.querySelectorAll(':scope > .mes, :scope > .mes .mes_text')]);
        for (const node of watched) if (!next.has(node)) resize.unobserve(node);
        for (const node of next) if (!watched.has(node)) resize.observe(node);
        watched = next;
    }
    function attach() {
        const next = doc.getElementById('chat');
        if (next === root) return;
        resize?.disconnect(); mutation?.disconnect(); watched.clear(); root = next; state = anchor = null;
        if (!root || !win.ResizeObserver) return;
        resize = new win.ResizeObserver(schedule); watchMessages();
        mutation = new win.MutationObserver(() => { watchMessages(); schedule(); });
        mutation.observe(root, { childList:true, attributes:true, attributeFilter:['data-tt-chat-surface'] });
    }
    function chatChanged() {
        if (!enabled) return;
        if (frame !== null) win.cancelAnimationFrame(frame); frame = null;
        win.clearTimeout(idle); const activeTouch = touch; attach(); browsing = touch = activeTouch; remember(); if (activeTouch) following = false; schedule();
    }
    const scroll = event => {
        if (event.target !== root || !supported()) return;
        if (browsing || touch) { state = measure(); anchor = pickAnchor(); settle(); return; }
        const current = measure();
        // Capture deliberate host navigation only when the geometry itself stayed stable.
        if (state && Math.abs(current.height - state.height) <= 1 && Math.abs(current.view - state.view) <= 1) {
            state = current; following = !!(autoBottom() && atEnd(current));
            anchor = following ? null : pickAnchor();
        }
    };
    const input = event => {
        if (!enabled) return;
        if (root?.contains(event.target)) {
            browsing = true; following = false;
            if (event.type === 'touchstart' || event.type === 'touchmove') touch = true;
            if (event.type === 'touchend' || event.type === 'touchcancel') touch = false;
            state = measure(); anchor = pickAnchor(); settle();
        } else if (event.type !== 'touchend' && event.type !== 'touchcancel') {
            // Searching/jumping/editing via other controls is an explicit navigation intent.
            following = false; anchor = null; state = measure();
        }
    };
    const listeners = [['scroll',scroll],['pointerdown',input],['touchstart',input],['touchmove',input],['touchend',input],['touchcancel',input],['wheel',input],['keydown',input],['focusin',input]];
    function apply(value) {
        if (!!value === enabled) return;
        enabled = !!value;
        if (enabled) {
            attach(); remember();
            for (const [name, fn] of listeners) doc.addEventListener(name, fn, { capture:true, passive:true });
        } else {
            for (const [name, fn] of listeners) doc.removeEventListener(name, fn, true);
            resize?.disconnect(); mutation?.disconnect(); watched.clear();
            win.clearTimeout(idle); if (frame !== null) win.cancelAnimationFrame(frame); frame = null;
            root = state = anchor = null; following = touch = browsing = false;
        }
    }
    return { apply, chatChanged, destroy() { apply(false); } };
}

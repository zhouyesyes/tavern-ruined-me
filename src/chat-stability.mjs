// Preserve static-chat geometry through late media/layout changes. All position
// writes use the host's scroll API; bounded ChatSurface retains full ownership.
export function createChatStability(doc, getContext, preferences = () => ({}), trace = () => {}) {
    const win = doc.defaultView;
    let enabled = false, root = null, resize = null, mutation = null, watched = new Set();
    let state = null, anchor = null, following = false, frame = null, idle = null, touch = false, browsing = false;
    let lastIntent = -Infinity, editTarget = null, chromeUntil = 0, pinnedReply = false;
    const cardDocuments = new Map();
    const measure = () => root ? { top:root.scrollTop, height:root.scrollHeight, view:root.clientHeight } : null;
    const atEnd = value => value && value.height - value.view - value.top < 24;
    const supported = () => enabled && root?.isConnected && root.getAttribute('data-tt-chat-surface') !== 'bounded'
        && typeof getContext()?.scrollChatSurfaceTo === 'function';
    const autoBottom = () => preferences()?.autoBottom !== false;
    const editing = () => editTarget && editTarget.ownerDocument.activeElement === editTarget
        && (root?.contains(editTarget) || [...cardDocuments.values()].some(record => record.document === editTarget.ownerDocument));
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
        if (browsing || touch || editing()) { trace({ action:'让出用户操作', following, touch, browsing, editing:!!editing() }); state = current; anchor = pickAnchor(); return; }
        const changed = Math.abs(current.height - state.height) > 1 || Math.abs(current.view - state.view) > 1;
        const tailDrift = following && autoBottom() && !atEnd(current);
        const menuDrift = win.performance.now() < chromeUntil && anchor?.node.isConnected;
        if (!changed && !tailDrift && !menuDrift) return;
        let target = null;
        if (following && autoBottom()) target = current.height - current.view;
        else if (anchor?.node.isConnected && root.contains(anchor.node)) {
            const top = root.getBoundingClientRect().top + root.clientTop;
            target = current.top + anchor.node.getBoundingClientRect().top - top - anchor.offset;
        }
        if (target !== null) {
            target = Math.max(0, Math.min(current.height - current.view, target));
            if (Math.abs(target - current.top) > 1) {
                trace({ action:following ? '维持末尾' : '维持段落', from:current.top, to:target, height:current.height, following, changed, tailDrift });
                getContext().scrollChatSurfaceTo({ top:target, behavior:'instant' });
            }
        }
        // Preserve the existing follow/reading intent; a layout shift is not user input.
        state = measure(); if (!following && !pinnedReply) anchor = pickAnchor();
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
        resize = new win.ResizeObserver(schedule); watchMessages(); syncCards();
        mutation = new win.MutationObserver(records => {
            if (records.some(record => record.target === root)) { watchMessages(); schedule(); }
            if (records.some(record => [...record.addedNodes, ...record.removedNodes].some(node => node.nodeType === 1 && (node.matches('iframe') || node.querySelector('iframe'))))) syncCards();
        });
        mutation.observe(root, { childList:true, subtree:true, attributes:true, attributeFilter:['data-tt-chat-surface'] });
    }
    function chatChanged() {
        if (!enabled) return;
        if (frame !== null) win.cancelAnimationFrame(frame); frame = null;
        win.clearTimeout(idle); editTarget = null; lastIntent = -Infinity; chromeUntil = 0; pinnedReply = false; const activeTouch = touch; attach(); browsing = touch = activeTouch; remember(); if (activeTouch) following = false; schedule();
    }
    const scroll = event => {
        if (event.target !== root || !supported()) return;
        if (browsing || touch) { state = measure(); anchor = pickAnchor(); settle(); return; }
        const current = measure();
        // Correct observable layout/menu drift, but do not infer lack of user
        // intent just because an iframe did not deliver its gesture to this document.
        const changed = state && (Math.abs(current.height - state.height) > 1 || Math.abs(current.view - state.view) > 1);
        if ((following && autoBottom() && !atEnd(current) && changed) || (win.performance.now() < chromeUntil && (following || anchor?.node.isConnected))) { schedule(); return; }
        if (state && Math.abs(current.height - state.height) <= 1 && Math.abs(current.view - state.view) <= 1) {
            if (Math.abs(current.top - state.top) > 1) pinnedReply = false;
            state = current;
            // Cross-origin card gestures are invisible here. Do not interpret every
            // unchanged-layout scroll as a fault and fight it indefinitely.
            following = !!(!pinnedReply && autoBottom() && atEnd(current));
            if (!pinnedReply) anchor = following ? null : pickAnchor();
        }
    };
    const input = (event, fromCard = false) => {
        if (!enabled) return;
        const menu = !fromCard && event.target.closest?.('#options_button,#options,.options-content,#extensionsMenuButton,#extensionsMenu,#top-settings-holder,#top-bar');
        if (menu || (event.type === 'keydown' && event.key === 'Escape' && win.performance.now() < chromeUntil)) {
            // Opening/closing chrome is not a request to move the conversation.
            chromeUntil = win.performance.now() + 2000;
            if (!following && !anchor) anchor = pickAnchor();
            trace({ action:'菜单保留位置', event:event.type, following });
            return;
        }
        const isEditable = event.target.matches?.('input,textarea,[contenteditable=true]');
        if (event.type === 'focusin') {
            // Programmatic autofocus is trusted too; require preceding user intent.
            if (win.performance.now() - lastIntent > 1000) { trace({ action:'忽略自动焦点', tag:event.target.tagName, following }); return; }
            editTarget = isEditable && (fromCard || root?.contains(event.target)) ? event.target : null;
            return;
        }
        lastIntent = win.performance.now(); chromeUntil = 0; pinnedReply = false;
        if (event.type === 'pointerdown' || event.type === 'keydown') editTarget = isEditable && (fromCard || root?.contains(event.target)) ? event.target : null;
        if (fromCard || root?.contains(event.target)) {
            browsing = true; following = false;
            if (event.type === 'touchstart' || event.type === 'touchmove') touch = true;
            if (event.type === 'touchend' || event.type === 'touchcancel') touch = false;
            state = measure(); anchor = pickAnchor(); settle();
        } else if (event.type !== 'touchend' && event.type !== 'touchcancel') {
            // Searching/jumping/editing via other controls is an explicit navigation intent.
            trace({ action:'明确导航', event:event.type, following });
            following = false; anchor = null; state = measure();
        }
    };
    // Events inside an iframe do not bubble to the outer document. Observe only
    // accessible card documents; never inject scripts or read their content.
    function syncCards() {
        const seen = new Map();
        function visit(container) {
            for (const frame of container?.querySelectorAll('iframe') || []) {
                try {
                    const child = frame.contentDocument;
                    if (!child || seen.has(frame)) continue;
                    seen.set(frame, child); visit(child);
                } catch { /* Opaque cards are handled conservatively by scroll(). */ }
            }
        }
        if (enabled) visit(root);
        for (const [frame, record] of cardDocuments) if (seen.get(frame) !== record.document) {
            for (const name of cardEvents) record.document.removeEventListener(name, record.input, true);
            record.document.removeEventListener('load', syncCards, true);
            cardDocuments.delete(frame);
        }
        for (const [frame, child] of seen) if (!cardDocuments.has(frame)) {
            const handler = event => input(event, true);
            for (const name of cardEvents) child.addEventListener(name, handler, { capture:true, passive:true });
            child.addEventListener('load', syncCards, true);
            cardDocuments.set(frame, { document:child, input:handler });
        }
    }
    const cardEvents = ['pointerdown','touchstart','touchmove','touchend','touchcancel','wheel','keydown','focusin'];
    const cardLoaded = event => { if (event.target.matches?.('iframe') && root?.contains(event.target)) syncCards(); };
    function navigateReply(node, automatic = false) {
        const targetRoot = doc.getElementById('chat'), context = getContext();
        if (!node?.isConnected || !targetRoot?.contains(node) || typeof context?.scrollChatSurfaceTo !== 'function') return false;
        if (automatic && (touch || browsing || editing())) return false;
        if (frame !== null) win.cancelAnimationFrame(frame); frame = null; win.clearTimeout(idle);
        following = false; browsing = touch = false; pinnedReply = true; chromeUntil = 0; editTarget = null;
        const top = targetRoot.getBoundingClientRect().top + targetRoot.clientTop;
        const target = Math.max(0, Math.min(targetRoot.scrollHeight - targetRoot.clientHeight, targetRoot.scrollTop + node.getBoundingClientRect().top - top));
        context.scrollChatSurfaceTo({ top:target, behavior:'instant' });
        if (root === targetRoot) { state = measure(); anchor = { node, offset:0 }; }
        trace({ action:automatic ? '回复完成定位开头' : '手动定位回复开头', to:target });
        return true;
    }
    function releaseReply() { pinnedReply = false; if (enabled) { remember(); if (!following) anchor = null; } }
    const listeners = [['scroll',scroll],['pointerdown',input],['touchstart',input],['touchmove',input],['touchend',input],['touchcancel',input],['wheel',input],['keydown',input],['focusin',input]];
    function apply(value) {
        if (!!value === enabled) return;
        enabled = !!value;
        if (enabled) {
            pinnedReply = false; attach(); remember();
            for (const [name, fn] of listeners) doc.addEventListener(name, fn, { capture:true, passive:true });
            doc.addEventListener('load', cardLoaded, true);
        } else {
            for (const [name, fn] of listeners) doc.removeEventListener(name, fn, true);
            doc.removeEventListener('load', cardLoaded, true); syncCards();
            resize?.disconnect(); mutation?.disconnect(); watched.clear();
            win.clearTimeout(idle); if (frame !== null) win.cancelAnimationFrame(frame); frame = null;
            root = state = anchor = editTarget = null; following = touch = browsing = pinnedReply = false; lastIntent = -Infinity; chromeUntil = 0;
        }
    }
    return { apply, chatChanged, navigateReply, releaseReply, destroy() { apply(false); } };
}

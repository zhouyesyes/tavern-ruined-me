// Temporary diagnostics for #chat only. Forward scroll calls unchanged; never correct
// positions, read message text, store media URLs, or persist the trace.
export function createChatJumpProbe(doc, preferences = () => ({}), changed = () => {}) {
    const win = doc.defaultView;
    let running = false, root = null, timer = null, frame = null, started = 0, epoch = 0;
    let rows = [], dropped = 0, release = [], mutation = null, resize = null, watched = new Set(), heights = new WeakMap();
    let lastInput = null, lastScroll = null, lastScrollLog = -Infinity;
    const now = () => win.performance.now();
    const round = value => Math.round(Number(value) || 0);
    function geometry() {
        if (!root) return {};
        const messages = root.querySelectorAll(':scope > .mes');
        return { top:round(root.scrollTop), height:round(root.scrollHeight), viewport:round(root.clientHeight),
            gap:round(root.scrollHeight - root.clientHeight - root.scrollTop), mounted:messages.length,
            first:messages[0]?.getAttribute('mesid') ?? null, last:messages[messages.length - 1]?.getAttribute('mesid') ?? null,
            surface:root.getAttribute('data-tt-chat-surface') || 'static' };
    }
    function log(kind, extra = {}) {
        if (!running) return;
        rows.push({ ms:round(now() - started), kind, chat:epoch, ...extra });
        if (rows.length > 500) { rows.shift(); dropped++; }
    }
    function caller() {
        // Keep function names only, never source URLs or query strings.
        return String(new Error().stack || '').split('\n').slice(1).map(line => {
            const value = line.trim().replace(/^at\s+/, '').split('@')[0].split('(')[0].trim();
            return /^[\w.$<> ]{1,90}$/.test(value) ? value : null;
        }).filter(value => value && !/^(caller|log|wrappedScrollTo|set|geometry)$/.test(value)).slice(0, 7);
    }
    function hookScroll(target) {
        const own = Object.getOwnPropertyDescriptor(target, 'scrollTop');
        let prototype = target, descriptor = own;
        while (!descriptor && (prototype = Object.getPrototypeOf(prototype))) descriptor = Object.getOwnPropertyDescriptor(prototype, 'scrollTop');
        if (descriptor?.get && descriptor?.set && (!own || own.configurable)) {
            const get = function () { return descriptor.get.call(this); };
            const set = function (value) {
                if (running) log('scrollTop命令', { requested:typeof value === 'number' ? round(value) : '非数值', ...geometry(), caller:caller() });
                return descriptor.set.call(this, value);
            };
            try {
                Object.defineProperty(target, 'scrollTop', { get, set, configurable:true, enumerable:descriptor.enumerable });
                release.push(() => { const current = Object.getOwnPropertyDescriptor(target, 'scrollTop'); if (current?.get === get && current?.set === set) { if (own) Object.defineProperty(target, 'scrollTop', own); else delete target.scrollTop; } });
            } catch { log('scrollTop来源不可记录'); }
        }
        const previous = Object.getOwnPropertyDescriptor(target, 'scrollTo'), scrollTo = target.scrollTo;
        if (typeof scrollTo === 'function' && (!previous || previous.configurable)) {
            function wrappedScrollTo(...args) {
                const value = typeof args[0] === 'object' ? args[0]?.top : args[1];
                if (running) log('scrollTo命令', { requested:typeof value === 'number' ? round(value) : null, ...geometry(), caller:caller() });
                return scrollTo.apply(this, args);
            }
            try {
                Object.defineProperty(target, 'scrollTo', { value:wrappedScrollTo, configurable:true, writable:true });
                release.push(() => { if (target.scrollTo === wrappedScrollTo) { if (previous) Object.defineProperty(target, 'scrollTo', previous); else delete target.scrollTo; } });
            } catch { log('scrollTo来源不可记录'); }
        }
    }
    function watchMessages() {
        if (!resize || !root) return;
        const next = new Set([root, ...root.querySelectorAll(':scope > .mes, :scope > .mes .mes_text')]);
        for (const node of watched) if (!next.has(node)) resize.unobserve(node);
        for (const node of next) if (!watched.has(node)) resize.observe(node);
        watched = next;
    }
    function detach() {
        mutation?.disconnect(); resize?.disconnect(); mutation = resize = null;
        for (const restore of release.splice(0).reverse()) restore();
        watched.clear(); heights = new WeakMap();
    }
    function attach() {
        const next = doc.getElementById('chat');
        if (next === root) { watchMessages(); return; }
        detach(); root = next;
        if (!root) { log('未找到聊天容器'); return; }
        hookScroll(root);
        if (win.ResizeObserver) resize = new win.ResizeObserver(entries => {
            const changes = [];
            for (const entry of entries) {
                const height = round(entry.borderBoxSize?.[0]?.blockSize ?? entry.contentRect.height), old = heights.get(entry.target);
                heights.set(entry.target, height);
                if (old !== undefined && Math.abs(old - height) > 2) changes.push({ message:entry.target.closest('.mes')?.getAttribute('mesid') ?? null, area:entry.target === root ? 'chat' : entry.target.matches('.mes_text') ? 'text' : 'message', from:old, to:height });
            }
            if (changes.length) log('高度变化', { changes:changes.slice(0, 12), ...geometry() });
        });
        watchMessages();
        if (win.MutationObserver) {
            mutation = new win.MutationObserver(() => { watchMessages(); log('消息节点变化', geometry()); });
            mutation.observe(root, { childList:true });
        }
    }
    const input = event => {
        if (!event.target.closest?.('#chat')) return;
        lastInput = now();
        if (event.type !== 'touchmove' || now() - lastScrollLog > 100) log(event.type, geometry());
    };
    const scroll = event => {
        if (event.target !== root || frame !== null) return;
        const run = () => {
            frame = null;
            if (!running) return;
            const state = geometry(), delta = lastScroll === null ? 0 : state.top - lastScroll;
            lastScroll = state.top;
            if (Math.abs(delta) > 80 || now() - lastScrollLog > 60) {
                log('scroll事件', { delta, sinceInput:lastInput === null ? null : round(now() - lastInput), ...state }); lastScrollLog = now();
            }
        };
        frame = win.requestAnimationFrame ? win.requestAnimationFrame(run) : win.setTimeout(run, 0);
    };
    const media = event => { if (event.target.closest?.('#chat') && event.target.matches('img,video,audio,iframe')) log('媒体加载', { tag:event.target.tagName, message:event.target.closest('.mes')?.getAttribute('mesid') ?? null, ...geometry() }); };
    const fonts = () => log('字体加载完成', geometry());
    const viewport = () => log('视口变化', { width:win.innerWidth, visualHeight:win.visualViewport?.height ?? win.innerHeight, ...geometry() });
    const listeners = [['touchstart',input],['touchmove',input],['touchend',input],['wheel',input],['pointerdown',input],['scroll',scroll],['load',media],['loadeddata',media]];
    function stop(notify = true) {
        if (!running) return;
        log('停止', geometry()); running = false;
        win.clearTimeout(timer); if (win.requestAnimationFrame) win.cancelAnimationFrame?.(frame); else win.clearTimeout(frame); frame = null;
        for (const [name, fn] of listeners) doc.removeEventListener(name, fn, true);
        doc.fonts?.removeEventListener?.('loadingdone', fonts); win.removeEventListener('resize', viewport); win.visualViewport?.removeEventListener('resize', viewport);
        detach(); root = null;
        if (notify) changed();
    }
    function start() {
        stop(false); rows = []; dropped = 0; epoch = 0; lastInput = lastScroll = null; lastScrollLog = -Infinity; started = now(); running = true;
        attach();
        let settings = {}; try { settings = preferences(); } catch {}
        log('开始', { width:win.innerWidth, visualHeight:win.visualViewport?.height ?? win.innerHeight, barTheme:doc.documentElement.classList.contains('sb-bar'), blankFix:doc.body.classList.contains('tvrm-tidy-smooth'), fonts:doc.fonts?.status ?? 'unknown', settings, ...geometry() });
        for (const [name, fn] of listeners) doc.addEventListener(name, fn, { capture:true, passive:true });
        doc.fonts?.addEventListener?.('loadingdone', fonts); win.addEventListener('resize', viewport); win.visualViewport?.addEventListener('resize', viewport);
        timer = win.setTimeout(stop, 60000); changed();
    }
    function chatChanged() { if (running) { epoch++; attach(); log('聊天切换', geometry()); } }
    function report() { return ['聊天跳动检测（仅内存，最多60秒）', '不读取正文、角色名、图片地址；scroll命令原样转发，不校正位置。', `记录 ${rows.length} 条，丢弃较早记录 ${dropped} 条。`, ...rows.map(row => JSON.stringify(row))].join('\n'); }
    return { start, stop, chatChanged, report, get running() { return running; }, destroy() { stop(false); } };
}

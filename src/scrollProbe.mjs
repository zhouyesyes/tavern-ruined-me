// 临时、被动的滚动测量：不读文本，不改变事件默认行为，不永久保存。
export function createScrollProbe(doc, changed = () => {}) {
    const win = doc.defaultView;
    let running = false, timer = null, raf = null, lastFrame = null, lastInput = null;
    let rows = [], current = null;
    const now = () => win.performance.now();
    const pageOf = el => el?.closest?.('#persona-management-block') ? '人设'
        : el?.closest?.('#right-nav-panel,#rm_print_characters_block') ? '角色' : null;
    const delay = event => {
        let stamp = event.timeStamp;
        if (stamp > 1e12) stamp -= win.performance.timeOrigin;
        const value = now() - stamp;
        return Number.isFinite(value) && value >= 0 && value < 60000 ? value : null;
    };
    const startTouch = e => {
        const page = pageOf(e.target);
        current = null;
        if (!page || e.touches.length !== 1 || rows.length >= 80) return;
        current = { page, start: now(), moves: 0, scrolls: 0, maxEventDelay: 0, maxFrameGap: 0, maxScrollGap: 0, firstMove: null, firstScroll: null, lastScroll: null, ended: null };
        rows.push(current); lastInput = now();
    };
    const move = e => {
        if (!current) return;
        const t = now(); lastInput = t; current.moves++;
        current.firstMove ??= t;
        current.maxEventDelay = Math.max(current.maxEventDelay, delay(e) ?? 0);
    };
    const end = () => { if (current) current.ended = now(); };
    const scroll = e => {
        if (!current || pageOf(e.target) !== current.page) return;
        const t = now();
        if (current.ended !== null && t - current.ended > 1500) return;
        current.scrolls++; current.firstScroll ??= t;
        if (current.lastScroll !== null && lastInput !== null && t - lastInput < 150) current.maxScrollGap = Math.max(current.maxScrollGap, t - current.lastScroll);
        current.lastScroll = t;
    };
    const frame = t => {
        if (!running) return;
        if (current && current.ended === null && lastFrame !== null) current.maxFrameGap = Math.max(current.maxFrameGap, t - lastFrame);
        lastFrame = t; raf = win.requestAnimationFrame(frame);
    };
    const listeners = [['touchstart', startTouch], ['touchmove', move], ['touchend', end], ['touchcancel', end], ['scroll', scroll]];
    function stop(notify = true) {
        if (!running) return;
        running = false;
        win.clearTimeout(timer); win.cancelAnimationFrame?.(raf);
        for (const [name, fn] of listeners) doc.removeEventListener(name, fn, true);
        current = null;
        if (notify) changed();
    }
    function start() {
        stop(false); rows = []; current = null; lastFrame = null; lastInput = null; running = true;
        for (const [name, fn] of listeners) doc.addEventListener(name, fn, { capture: true, passive: true });
        if (win.requestAnimationFrame) raf = win.requestAnimationFrame(frame);
        timer = win.setTimeout(stop, 60000); changed();
    }
    const ms = v => v == null ? '未测到' : Math.round(v) + 'ms';
    function report() {
        const lines = ['角色 / 人设持续滑动检测', '仅为网页事件测量；滚动事件可能合并，不能直接等同于手指或画面延迟。'];
        for (const [i, r] of rows.entries()) {
            lines.push(`${i + 1}. ${r.page}：移动事件 ${r.moves}，滚动事件 ${r.scrolls}，触摸事件最大等待 ${ms(r.maxEventDelay)}，最大帧回调间隔 ${ms(r.maxFrameGap)}，持续输入时最大滚动事件间隔 ${ms(r.maxScrollGap)}，首个移动至首个滚动 ${ms(r.firstMove === null || r.firstScroll === null ? null : Math.max(0, r.firstScroll - r.firstMove))}`);
        }
        if (!rows.length) lines.push('尚未收到角色 / 人设页面的单指触摸。');
        return lines.join('\n');
    }
    return { start, stop, report, get running() { return running; }, destroy() { stop(false); } };
}

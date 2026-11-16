// Reply-start navigation is explicit or tied to a confirmed assistant generation.
// Opening menus, loading history, aborted/quiet runs and chat changes never trigger it.
export function createReplyNavigation(doc, getContext, navigate, release, toast = () => {}) {
    const win = doc.defaultView;
    let showButton = true, auto = false, button = null, generation = null, version = 0, frame = null, disposed = false;
    const identity = () => { const c = getContext(); return [c.characterId,c.groupId,c.chatId].join('|'); };
    const cancel = () => { version++; if (frame !== null) win.cancelAnimationFrame(frame); frame = null; };
    function latest() {
        const rows = doc.querySelectorAll('#chat > .mes[mesid]:not([is_user="true"]):not([is_system="true"])');
        return rows[rows.length - 1] || null;
    }
    function jump(automatic = false, id = null) {
        const row = id === null ? latest() : [...doc.querySelectorAll('#chat > .mes[mesid]')].find(row => Number(row.getAttribute('mesid')) === id && row.getAttribute('is_user') !== 'true' && row.getAttribute('is_system') !== 'true');
        const target = row?.querySelector('.mes_text') || row;
        if (!target || !navigate(target, automatic)) { if (!automatic) toast('info', '当前没有可定位的回复，或宿主未提供滚动接口'); return false; }
        return true;
    }
    function syncButton() {
        const menu = doc.querySelector('#options .options-content') || doc.querySelector('.options-content') || doc.getElementById('options');
        if (!showButton || !menu || !doc.getElementById('send_form') || disposed) { button?.remove(); button = null; return; }
        if (button?.parentElement === menu) return;
        button?.remove(); button = doc.createElement('a'); button.id = 'tvrm-reply-start';
        button.className = 'list-group-item tvrm-reply-start'; button.setAttribute('role','button'); button.tabIndex = 0;
        button.title = '跳到最新回复开头'; button.setAttribute('aria-label', button.title);
        const icon = doc.createElement('i'); icon.className = 'fa-solid fa-arrow-up'; icon.setAttribute('aria-hidden','true');
        const label = doc.createElement('span'); label.textContent = '最新回复开头'; button.append(icon,label);
        const activate = event => { event.preventDefault(); event.stopPropagation(); cancel(); jump(); };
        button.addEventListener('click', activate);
        button.addEventListener('keydown', event => { if (event.key === 'Enter' || event.key === ' ') activate(event); });
        menu.append(button);
    }
    function apply(options = {}) { showButton = options.button !== false; auto = options.auto === true; if (!auto) cancel(); syncButton(); }
    function started(type, options, dryRun) {
        cancel(); generation = null;
        if (disposed || dryRun || ['quiet','impersonate'].includes(type)) return;
        release(); generation = { identity:identity(), reply:null, minimum:getContext().chat?.length || 0, canReplace:['swipe','regenerate','continue'].includes(type) };
    }
    function received(id, type) {
        syncButton();
        if (!generation || generation.identity !== identity() || type === 'first_message' || id === null || id === undefined || id === '') return;
        const index = Number(id), message = getContext().chat?.[index];
        if (!Number.isInteger(index) || !message || message.is_user || message.is_system || (!generation.canReplace && index < generation.minimum)) return;
        generation.reply = index;
        if (generation.ended) scheduleJump();
    }
    function scheduleJump() {
        const run = generation;
        if (!auto || disposed || !run?.ended || run.reply === null || run.identity !== identity()) return;
        cancel(); const current = version;
        // Streaming TT emits GENERATION_ENDED before MESSAGE_RECEIVED. Wait for
        // both signals, then let final message rendering and host scrolling settle.
        frame = win.requestAnimationFrame(() => { frame = win.requestAnimationFrame(() => {
            frame = null;
            if (!disposed && auto && version === current && generation === run && run.identity === identity()) {
                generation = null; jump(true, run.reply);
            }
        }); });
    }
    function ended() {
        if (!generation) return;
        generation.ended = true; scheduleJump();
    }
    function stopped() { generation = null; cancel(); }
    function chatChanged() { stopped(); syncButton(); }
    return { apply, jump:() => { cancel(); return jump(); }, started, received, ended, stopped, chatChanged, syncButton,
        destroy() { disposed = true; stopped(); button?.remove(); button = null; } };
}

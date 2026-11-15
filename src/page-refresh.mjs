// Reload only the current chat through the host API; never reload the WebView.
export function createPageRefresh(doc, reload, getContext = () => ({}), toast = () => {}) {
    let enabled = false, button = null, busy = false;
    async function refresh() {
        if (busy) return;
        const context = getContext();
        if (context.chatId == null) { toast('info', '请先打开一个聊天'); return; }
        if (context.isSendPress || context.isGroupGenerating) { toast('info', '请等回复结束后再刷新聊天'); return; }
        if (typeof reload !== 'function') { toast('warning', '当前环境未提供聊天刷新接口'); return; }
        busy = true;
        try { await reload(); }
        catch (error) { toast('warning', '聊天刷新失败：' + (error?.message || '请稍后再试')); }
        finally { busy = false; }
    }
    function sync() {
        const menu = doc.querySelector('#options .options-content') || doc.getElementById('options');
        if (!enabled || !menu || !doc.getElementById('send_form')) { button?.remove(); button = null; return; }
        if (button?.parentElement === menu) return;
        button?.remove(); button = doc.createElement('a'); button.id = 'tvrm-page-refresh';
        button.className = 'list-group-item'; button.setAttribute('role', 'button'); button.tabIndex = 0;
        button.title = '重新载入当前聊天'; button.setAttribute('aria-label', '刷新当前聊天');
        const icon = doc.createElement('i'); icon.className = 'fa-solid fa-rotate-right'; icon.setAttribute('aria-hidden', 'true');
        const label = doc.createElement('span'); label.textContent = '刷新当前聊天'; button.append(icon, label);
        const activate = event => { event.preventDefault(); event.stopPropagation(); void refresh(); };
        button.addEventListener('click', activate);
        button.addEventListener('keydown', event => { if (event.key === 'Enter' || event.key === ' ') activate(event); });
        menu.append(button);
    }
    return { apply(value) { enabled = !!value; sync(); }, sync, destroy() { enabled = false; button?.remove(); button = null; } };
}

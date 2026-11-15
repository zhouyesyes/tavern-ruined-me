// An explicit reload action in the existing composer menu.
export function createPageRefresh(doc, reload = () => doc.defaultView.location.reload()) {
    let enabled = false, button = null;
    function sync() {
        const menu = doc.querySelector('#options .options-content') || doc.getElementById('options');
        if (!enabled || !menu || !doc.getElementById('send_form')) { button?.remove(); button = null; return; }
        if (button?.parentElement === menu) return;
        button?.remove(); button = doc.createElement('a'); button.id = 'tvrm-page-refresh';
        button.className = 'list-group-item'; button.setAttribute('role', 'button'); button.tabIndex = 0;
        button.title = '刷新当前酒馆页面'; button.setAttribute('aria-label', '刷新页面');
        const icon = doc.createElement('i'); icon.className = 'fa-solid fa-rotate-right'; icon.setAttribute('aria-hidden', 'true');
        const label = doc.createElement('span'); label.textContent = '刷新页面'; button.append(icon, label);
        const activate = event => { event.preventDefault(); event.stopPropagation(); reload(); };
        button.addEventListener('click', activate);
        button.addEventListener('keydown', event => { if (event.key === 'Enter' || event.key === ' ') activate(event); });
        menu.append(button);
    }
    return { apply(value) { enabled = !!value; sync(); }, sync, destroy() { enabled = false; button?.remove(); button = null; } };
}

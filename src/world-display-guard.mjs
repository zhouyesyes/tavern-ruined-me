// Guard an upstream async-pagination append race. Only hide identical rendered
// copies; never remove native nodes or change any world-info data/field values.
export function createWorldDisplayGuard(doc) {
    const win = doc.defaultView, marker = 'tvrm-world-duplicate';
    let list = null, observer = null, life = null, style = null, queued = false, active = false;
    const hidden = new Set();
    function fingerprint(row) {
        const uid = row.getAttribute('uid');
        if (uid === null || uid === '') return null;
        const fields = [...row.querySelectorAll('input[name],textarea[name],select[name]')].map(field => [field.tagName, field.getAttribute('type') || '', field.name,
            field.matches('select[multiple]') ? [...field.selectedOptions].map(option => option.value) : field.value,
            field.matches('input[type=checkbox],input[type=radio]') ? field.checked : null]);
        if (!fields.length) return null;
        fields.sort((a,b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
        // Different field values may represent an in-progress edit: do not hide them.
        return JSON.stringify([uid, fields]);
    }
    function sync() {
        if (!active || !list?.isConnected) return;
        const keep = new Map(), duplicates = new Set();
        const groups = new Map();
        for (const row of list.querySelectorAll(':scope > .world_entry[uid]')) {
            const uid = row.getAttribute('uid'); if (!uid) continue;
            if (!groups.has(uid)) groups.set(uid, []); groups.get(uid).push(row);
        }
        // Most pages have no duplicate IDs: do not inspect their content fields.
        for (const group of groups.values()) {
            if (group.length < 2) continue;
            for (const row of group) {
                const key = fingerprint(row); if (key === null) continue;
                const previous = keep.get(key);
                if (!previous) { keep.set(key, row); continue; }
                if (row.contains(doc.activeElement) && !previous.contains(doc.activeElement)) {
                    duplicates.add(previous); keep.set(key, row);
                } else duplicates.add(row);
            }
        }
        for (const row of hidden) if (!duplicates.has(row)) row.classList.remove(marker);
        for (const row of duplicates) row.classList.add(marker);
        hidden.clear(); for (const row of duplicates) hidden.add(row);
    }
    function schedule() {
        if (!active || queued) return;
        queued = true;
        win.queueMicrotask(() => { queued = false; sync(); });
    }
    function bind(next = doc.getElementById('world_popup_entries_list')) {
        if (next === list && next?.isConnected) return;
        observer?.disconnect();
        for (const row of hidden) row.classList.remove(marker);
        hidden.clear(); list = next;
        if (list) { observer.observe(list, { childList:true, subtree:true, attributes:true, attributeFilter:['uid','name','value','checked','selected'] }); schedule(); }
    }
    function event(event) {
        if (event.target.id === 'world_editor_select') { for (const row of hidden) row.classList.remove(marker); hidden.clear(); }
        if (event.target.id === 'world_editor_select' || event.target.closest?.('#world_popup_entries_list')) schedule();
    }
    function start() {
        if (active) return; active = true;
        style = doc.createElement('style'); style.textContent = `#world_popup_entries_list > .world_entry.${marker}{display:none!important}`; doc.head.append(style);
        observer = new win.MutationObserver(schedule);
        life = new win.MutationObserver(records => {
            if (list?.isConnected) return;
            // Unrelated character/persona updates must not rescan the whole document.
            for (const record of records) for (const node of record.addedNodes) {
                if (node.nodeType !== 1) continue;
                const next = node.id === 'world_popup_entries_list' ? node : node.querySelector('#world_popup_entries_list');
                if (next?.isConnected) { bind(next); return; }
            }
            if (list) bind(null);
        });
        life.observe(doc.body, { childList:true, subtree:true });
        for (const name of ['input','change','click']) doc.addEventListener(name, event, true);
        bind();
    }
    function destroy() {
        if (!active) return;
        active = false; observer?.disconnect(); life?.disconnect();
        for (const name of ['input','change','click']) doc.removeEventListener(name, event, true);
        for (const row of hidden) row.classList.remove(marker);
        hidden.clear(); style?.remove(); list = null;
    }
    return { start, sync, destroy };
}

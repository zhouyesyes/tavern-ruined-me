// 酒馆接口由 host 传入；聊天切换、原书修改共用队列，避免异步结果串窗。
import {
    NS, BUCKET, normalizeSettings, newBookCfg, newGroupId, bucketOf,
    removeGroup, setBucket, getChatSlot, setChatSlot, emptyWorldChat,
    resolveEntry, snapshotBook, bookMeta, planWriteBack, createDebouncer,
    entryLabel, entrySub, boundBookNames, reconcileBook,
} from './core.mjs';

export function createApp(host) {
    const doc = host.document;
    const ctx = () => host.getContext();
    const timers = host.timers || { setTimeout, clearTimeout };
    const toast = (kind, msg) => host.toast?.(kind, msg);
    let panelRoot = null;
    let ready = null;
    let selectedBook = null;
    let chatPopup = null;
    const managementChats = new Map();
    const displayChat = name => bookNames().includes(name) ? chatWorld() : managementChats.get(name);
    let queue = Promise.resolve();
    let revision = 0;
    let ownSave = false;
    const entryCache = new Map();
    const pending = new Map();
    function h(tag, attrs, ...kids) {
        const el = doc.createElement(tag);
        for (const [k, v] of Object.entries(attrs || {})) {
            if (v === undefined || v === null || v === false) continue;
            if (k === 'class') el.className = v;
            else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
            else if (k === 'value') el.value = v;
            else if (['checked', 'disabled', 'selected', 'open'].includes(k)) el[k] = !!v;
            else el.setAttribute(k, v === true ? '' : v);
        }
        for (const kid of kids.flat(Infinity)) if (kid !== null && kid !== undefined && kid !== false) el.append(kid.nodeType ? kid : String(kid));
        return el;
    }
    const button = (text, onclick, cls = '') => h('button', { type: 'button', class: 'menu_button ' + cls, onclick }, text);
    const clone = value => JSON.parse(JSON.stringify(value));
    function settings() {
        const c = ctx();
        if (!c.extensionSettings[NS]?.__ok) {
            const s = normalizeSettings(c.extensionSettings[NS]);
            Object.defineProperty(s, '__ok', { value: true });
            c.extensionSettings[NS] = s;
        }
        return c.extensionSettings[NS];
    }
    const saveSettings = () => ctx().saveSettingsDebounced();
    const chatWorld = () => getChatSlot(ctx().chatMetadata, 'world');
    const allNames = () => Array.from(host.worldNames() || []);
    const visibleNames = () => boundBookNames(ctx(), host.bindings?.(), allNames());
    const bookNames = () => visibleNames().filter(n => !settings().world.hidden?.includes(n));
    const signature = () => JSON.stringify([visibleNames().slice().sort(), ctx().chatMetadata?.world_info ?? null]);
    function token() {
        const c = ctx();
        return { id: c.chatId, character: c.characterId, group: c.groupId, meta: c.chatMetadata, rev: revision, binding: signature() };
    }
    function current(t) {
        const c = ctx();
        return t && c.chatId != null && t.id === c.chatId && t.character === c.characterId && t.group === c.groupId && t.meta === c.chatMetadata && t.rev === revision && t.binding === signature();
    }
    function enqueue(fn) {
        const task = queue.then(fn);
        queue = task.catch(e => { console.warn('[酒馆你害我不浅] 同步失败', e); toast('error', '世界书同步失败，请重试；没有继续覆盖原书'); });
        return queue;
    }
    function persistChat(t) {
        if (!current(t)) return;
        const c = ctx();
        // 直接请求保存，避免酒馆的全局防抖在快速切聊天时取消上一窗的修改。
        return c.saveMetadata ? c.saveMetadata() : c.saveMetadataDebounced();
    }
    function ensureBook(name) {
        const s = settings();
        if (!s.world.books[name] && !s.world.wholeBooks.includes(name)) s.world.books[name] = newBookCfg();
    }
    async function readBook(name) {
        const loaded = await host.loadWorldInfo(name);
        const data = loaded ? clone(loaded) : null;
        if (!data?.entries) throw new Error('无法读取世界书：' + name);
        entryCache.set(name, Object.values(data.entries).sort((a, b) => (a.displayIndex ?? a.uid) - (b.displayIndex ?? b.uid)));
        return data;
    }
    async function synchronize(t) {
        if (!current(t)) return;
        const s = settings();
        const chat = clone(chatWorld() || emptyWorldChat());
        const reset = chat.binding !== t.binding;
        const loaded = [];
        for (const name of bookNames()) {
            ensureBook(name);
            const data = await readBook(name);
            if (!current(t)) return;
            reconcileBook(s, chat, name, data, reset);
            loaded.push([name, data]);
        }
        if (!current(t)) return;
        chat.binding = t.binding;
        setChatSlot(t.meta, 'world', chat);
        ready = t;
        await persistChat(t);
        saveSettings();
        for (const [name] of loaded) {
            if (!current(t)) return;
            // 保存前再读一次：载入过程中别的扩展也可能改书。
            const data = await readBook(name);
            if (!current(t)) return;
            reconcileBook(s, chat, name, data);
            await writePlan(t, name, data, chat);
        }
        if (!current(t)) return;
        await persistChat(t);
        saveSettings();
        if (selectedBook && !bookNames().includes(selectedBook) && allNames().includes(selectedBook)) await loadManagement(selectedBook, t);
        if (!current(t)) return;
        renderPanel();
        syncNative();
    }
    async function writePlan(t, name, data, chat, manual = false) {
        if (!current(t) || (!manual && !bookNames().includes(name))) return;
        const s = settings();
        const meta = bookMeta(s, name, true);
        if (meta?.restored) return;
        const plan = planWriteBack(s, chat, name, data);
        if (!plan.length) return;
        if (!meta.backup) { meta.backup = snapshotBook(data); saveSettings(); }
        for (const change of plan) data.entries[change.uid].disable = change.disable;
        ownSave = true;
        try { await host.saveWorldInfo(name, data, true); }
        finally { ownSave = false; }
        // 记录已经发出的写入，即使此时换窗，下一窗也能识别这是插件刚写的。
        s.world.physical[name] = Object.fromEntries(Object.values(data.entries).map(e => [String(e.uid), e.disable !== true]));
        entryCache.set(name, Object.values(data.entries));
        saveSettings();
    }
    async function flushWriteBack() {
        const t = token();
        return enqueue(() => synchronize(t));
    }
    const scheduleWriteBack = createDebouncer(flushWriteBack, 300, timers);
    function onChatChanged() {
        revision++;
        pending.clear();
        ready = null;
        scheduleWriteBack.cancel();
        if (chatPopup) chatPopup.content.replaceChildren(h('p', null, '聊天已变化，请关闭后重新打开'));
        chatPopup = null;
        managementChats.clear();
        if (panelRoot) panelRoot.replaceChildren(h('p', { class: 'tvrm-empty' }, '正在读取当前聊天…'));
        const t = token();
        return enqueue(() => synchronize(t));
    }
    const onChatCreated = onChatChanged;
    function onWorldChanged() {
        if (ownSave) return;
        // 绑定变化立即让旧界面失效；原书变化重新核对后再恢复本聊天选择。
        if (!current(ready)) return onChatChanged();
        scheduleWriteBack();
    }
    async function onEntriesLoaded(payload) {
        const source = ctx();
        const metadata = source.chatMetadata;
        const id = source.chatId;
        const character = source.characterId;
        const group = source.groupId;
        if (!current(ready)) await onChatChanged();
        if (!current(ready) || metadata !== ctx().chatMetadata || id !== ctx().chatId || character !== ctx().characterId || group !== ctx().groupId) return;
        const s = settings();
        const chat = chatWorld();
        const names = new Set(bookNames());
        const all = [...(payload?.globalLore || []), ...(payload?.characterLore || []), ...(payload?.chatLore || []), ...(payload?.personaLore || [])];
        let changed = false;
        for (const entry of all) {
            if (!names.has(entry.world) || bookMeta(s, entry.world)?.restored) continue;
            const prior = s.world.physical?.[entry.world]?.[String(entry.uid)];
            const on = entry.disable !== true;
            if (prior !== undefined && prior !== on) {
                chat.entries[entry.world] ??= {};
                chat.entries[entry.world][String(entry.uid)] = on;
                chat.books[entry.world] = true;
                s.world.physical[entry.world][String(entry.uid)] = on;
                changed = true;
            }
            const want = resolveEntry(s, chat, entry.world, entry.uid, entry.disable === true);
            if (want !== null) entry.disable = !want;
        }
        if (changed) { persistChat(ready); saveSettings(); renderPanel(); }
    }
    function changeChat(t, name, fn) {
        if (!current(t) || !current(ready)) { toast('info', '聊天已变化，请等面板重新载入'); return; }
        const chat = displayChat(name);
        if (!chat) return;
        const before = clone(chat);
        fn(chat);
        const changes = pending.get(name) || { entries: {} };
        if (before.books[name] !== chat.books[name]) changes.book = chat.books[name];
        for (const [uid, on] of Object.entries(chat.entries[name])) {
            if (before.entries[name][uid] !== on) changes.entries[uid] = on;
        }
        pending.set(name, changes);
        bookMeta(settings(), name, true).restored = false;
        persistChat(t); saveSettings();
        enqueue(async () => {
            if (!current(t)) return;
            const data = await readBook(name);
            if (!current(t)) return;
            const dirty = pending.get(name);
            if (!dirty) return;
            reconcileBook(settings(), chat, name, data);
            Object.assign(chat.entries[name], dirty.entries);
            if (dirty.book !== undefined) chat.books[name] = dirty.book;
            await persistChat(t);
            const written = clone(dirty);
            await writePlan(t, name, data, chat, true);
            if (!current(t)) return;
            const latest = pending.get(name);
            for (const [uid, value] of Object.entries(written.entries)) if (latest?.entries[uid] === value) delete latest.entries[uid];
            if (latest?.book === written.book) delete latest.book;
            if (latest && !Object.keys(latest.entries).length && latest.book === undefined) pending.delete(name);
            renderPanel(); syncNative();
        });
        renderPanel(); syncNative();
    }

    async function confirm(text) { return host.popup(h('div', { class: 'tvrm-popup' }, text), '确认'); }
    async function restoreBook(name, t) {
        const meta = bookMeta(settings(), name);
        if (!meta?.backup || !await confirm(`恢复「${name}」的首次修改备份？这会替换当前原书内容。`)) return;
        return enqueue(async () => {
            if (!current(t)) return;
            ownSave = true;
            try { await host.saveWorldInfo(name, clone(meta.backup.data), true); }
            finally { ownSave = false; }
            meta.restored = true;
            settings().world.physical[name] = Object.fromEntries(Object.values(meta.backup.data.entries).map(e => [String(e.uid), !e.disable]));
            entryCache.delete(name); saveSettings();
            if (current(t)) { renderPanel(); syncNative(); }
            toast('success', '已恢复原书；再次手动修改开关后才重新接管');
        });
    }
    function switchRow({ name, checked, onToggle, cls = '' }) {
        const input = h('input', { type: 'checkbox', checked, 'aria-label': name });
        input.addEventListener('change', () => onToggle(input.checked));
        return h('label', { class: 'tvrm-row ' + cls + (checked ? '' : ' is-off') },
            h('span', { class: 'tvrm-name' }, name), h('span', { class: 'tvrm-switch' }, input, h('i')));
    }
    function restoreAction(name, t) {
        return h('button', { type: 'button', class: 'tvrm-restore', disabled: !bookMeta(settings(), name)?.backup, onclick: () => restoreBook(name, t) }, '恢复原书');
    }
    function wholeCard(name, t) {
        const chat = displayChat(name);
        const card = h('section', { class: 'tvrm-card' });
        const header = switchRow({ name, checked: chat.books[name] !== false, cls: 'tvrm-master',
            onToggle: on => changeChat(t, name, c => { c.books[name] = on; }) });
        const tools = h('div', { class: 'tvrm-card-tools' }, button('删除', async () => {
            if (!await confirm('从本面板移除「' + name + '」？原书和备份都会保留，可重新显示。') || !current(t)) return;
            settings().world.hidden ??= [];
            settings().world.hidden.push(name); saveSettings(); renderPanel();
        }, 'tvrm-delete'));
        card.append(h('div', { class: 'tvrm-book-header' }, header, tools), restoreAction(name, t));
        return card;
    }
    function bookCard(name, t) {
        const s = settings();
        const cfg = s.world.books[name];
        const chat = displayChat(name);
        const entries = entryCache.get(name) || [];
        const card = wholeCard(name, t);
        const groups = h('details', { class: 'tvrm-group-settings' }, h('summary', null, '分组设置', h('span', { class: 'tvrm-count' }, String(cfg.groups.length))));
        for (const g of cfg.groups) {
            const input = h('input', { class: 'text_pole', value: g.name, 'aria-label': '分组名称' });
            const feedback = h('small', { role: 'status', class: 'tvrm-save-feedback' });
            const body = h('details', { class: 'tvrm-group-edit' });
            const head = h('summary', null, h('span', { class: 'tvrm-name' }, g.name),
                button('删除', async e => {
                    e.preventDefault(); e.stopPropagation();
                    if (!await confirm(`删除分组「${g.name}」？条目会回到未分组，原书条目不会删除。`) || !current(t)) return;
                    removeGroup(cfg, g.id); saveSettings(); renderPanel();
                }, 'tvrm-delete'), h('span', { class: 'tvrm-triangle', 'aria-hidden': 'true' }, '▸'));
            body.append(head, h('div', { class: 'tvrm-group-edit-fields' }, input, button('保存', () => {
                if (!current(t)) return;
                const value = input.value.trim();
                if (!value) { feedback.textContent = '请填写组名'; return; }
                g.name = value; saveSettings(); head.querySelector('.tvrm-name').textContent = value;
                feedback.textContent = '已保存'; toast('success', '分组名称已保存');
            }), feedback));
            groups.append(body);
        }
        groups.append(button('＋ 新建分组', () => {
            if (!current(t)) return;
            cfg.groups.push({ id: newGroupId(), name: '新分组 ' + (cfg.groups.length + 1) }); saveSettings(); renderPanel();
        }));
        card.insertBefore(groups, card.lastChild);
        const area = h('div', { class: 'tvrm-entries' });
        const sections = [{ id: BUCKET.ON, name: '常开' }, { id: BUCKET.OFF, name: '常关' }, ...cfg.groups, { id: BUCKET.FREE, name: '未分组' }];
        for (const group of sections) {
            const members = entries.filter(e => {
                const bucket = bucketOf(cfg, e.uid);
                return group.id === BUCKET.FREE ? bucket === BUCKET.FREE || !sections.some(g => g.id === bucket) : bucket === group.id;
            });
            if (!members.length && group.id !== BUCKET.FREE) continue;
            const section = h('section', { class: 'tvrm-entry-section' }, h('h4', null, `${group.name}（${members.length}）`));
            for (const entry of members) {
                const uid = String(entry.uid);
                const row = h('div', { class: 'tvrm-entry' });
                row.append(switchRow({ name: entryLabel(entry), checked: resolveEntry(s, chat, name, uid, entry.disable === true) ?? !entry.disable,
                    onToggle: on => changeChat(t, name, c => { c.entries[name][uid] = on; }) }));
                const select = h('select', { class: 'text_pole tvrm-bucket', 'aria-label': entryLabel(entry) + '归组' },
                    sections.map(g => h('option', { value: g.id, selected: g.id === group.id }, g.name)));
                select.addEventListener('change', () => {
                    if (!current(t)) return;
                    setBucket(cfg, uid, select.value); saveSettings();
                    if (select.value === BUCKET.ON || select.value === BUCKET.OFF) changeChat(t, name, c => { c.entries[name][uid] = select.value === BUCKET.ON; });
                    else renderPanel();
                });
                row.append(h('div', { class: 'tvrm-entry-tools' }, h('small', { class: 'tvrm-sub' }, entrySub(entry)), select,
                    button('编辑', () => editEntry(name, uid, t), 'tvrm-edit')));
                section.append(row);
            }
            area.append(section);
        }
        card.insertBefore(area, card.lastChild);
        const toggle = button('▾', () => {
            const collapsed = !area.hidden;
            area.hidden = collapsed; groups.hidden = collapsed;
            toggle.textContent = collapsed ? '▸' : '▾'; toggle.setAttribute('aria-expanded', String(!collapsed));
        }, 'tvrm-collapse');
        toggle.setAttribute('aria-label', '展开或折叠世界书条目'); toggle.setAttribute('aria-expanded', 'true');
        card.querySelector('.tvrm-card-tools').append(toggle);
        return card;
    }
    async function editEntry(name, uid, t) {
        const data = await readBook(name);
        if (!current(t)) return;
        const original = clone(data.entries[uid]);
        if (!original) return;
        const title = h('input', { class: 'text_pole', value: original.comment || '', 'aria-label': '条目名称' });
        const keys = h('input', { class: 'text_pole', value: (original.key || []).join(', '), 'aria-label': '关键词（英文逗号分隔）' });
        const content = h('textarea', { class: 'text_pole', 'aria-label': '条目正文', rows: 10 }); content.value = original.content || '';
        const ok = await host.popup(h('div', { class: 'tvrm-popup tvrm-editor' }, h('h3', null, '编辑条目'), title, keys, content), '保存');
        if (!ok || !current(t)) return;
        return enqueue(async () => {
            const fresh = await readBook(name);
            if (!current(t)) return;
            const entry = fresh.entries[uid];
            if (!entry || ['comment', 'key', 'content'].some(k => JSON.stringify(entry[k]) !== JSON.stringify(original[k]))) {
                toast('warning', '条目已被其他地方修改，请重新打开编辑'); return;
            }
            const meta = bookMeta(settings(), name, true);
            if (!meta.backup) meta.backup = snapshotBook(fresh);
            entry.comment = title.value; entry.key = keys.value.split(',').map(k => k.trim()).filter(Boolean); entry.content = content.value;
            saveSettings(); ownSave = true;
            try { await host.saveWorldInfo(name, fresh, true); } finally { ownSave = false; }
            entryCache.set(name, Object.values(fresh.entries));
            if (current(t)) renderPanel();
            toast('success', '条目已保存');
        });
    }
    // 未绑定书只手动管理，不加入聊天候选或自动同步范围。
    async function loadManagement(name, t) {
        const data = await readBook(name);
        if (!current(t)) return;
        ensureBook(name);
        managementChats.set(name, { groups: {}, books: { [name]: true }, entries: {
            [name]: Object.fromEntries(Object.values(data.entries).map(e => [String(e.uid), !e.disable])),
        } });
    }
    async function showChat(status = false) {
        await flushWriteBack();
        if (!current(ready)) return;
        const content = h('div', { class: 'tvrm-popup' });
        const popup = { content, status };
        chatPopup = popup;
        renderChatPopup();
        try { await host.popup(content, null); }
        finally { if (chatPopup === popup) chatPopup = null; }
    }
    function renderChatPopup() {
        if (!chatPopup || !current(ready)) return;
        const { content, status } = chatPopup;
        const t = token();
        content.replaceChildren(h('h3', null, status ? '世界书状态' : '重选当前聊天'));
        for (const name of bookNames()) content.append(settings().world.books[name] && settings().world.books[name].mode !== 'whole' ? bookCard(name, t) : wholeCard(name, t));
        if (!bookNames().length) content.append('当前角色没有绑定世界书，也没有启用的全局世界书。');
        if (status) for (const el of content.querySelectorAll('input, select, button')) el.disabled = true;
    }
    function renderPanel() {
        if (!panelRoot || !current(ready)) return;
        renderChatPopup();
        const t = token();
        panelRoot.replaceChildren(h('div', { class: 'tvrm-tabs' }, button('世界书', () => {}, 'tvrm-tab is-active'),
            h('button', { type: 'button', disabled: true, class: 'tvrm-tab is-disabled' }, '预设'), h('button', { type: 'button', disabled: true, class: 'tvrm-tab is-disabled' }, 'API')));
        panelRoot.append(h('div', { class: 'tvrm-tabs' }, button('重选当前聊天', () => showChat()), button('看世界书状态', () => showChat(true))));
        const chooser = h('select', { class: 'text_pole', 'aria-label': '世界书下拉选择' },
            h('option', { value: '' }, '当前聊天选定'), allNames().map(n => h('option', { value: n, selected: n === selectedBook }, n)));
        chooser.addEventListener('change', () => {
            selectedBook = chooser.value || null;
            const name = selectedBook;
            enqueue(async () => {
                if (!current(t)) return;
                if (name && !bookNames().includes(name)) await loadManagement(name, t);
                if (current(t)) renderPanel();
            });
        });
        panelRoot.append(chooser);
        if (selectedBook && !allNames().includes(selectedBook)) selectedBook = null;
        if (selectedBook) {
            const name = selectedBook;
            const cfg = settings().world.books[name];
            const mode = h('select', { class: 'text_pole', 'aria-label': '世界书管理方式' },
                h('option', { value: 'entries', selected: cfg && cfg.mode !== 'whole' }, '按条目分组'),
                h('option', { value: 'whole', selected: !cfg || cfg.mode === 'whole' }, '整本开关'));
            mode.addEventListener('change', () => {
                if (!current(t)) return;
                // 切换显示方式保留原分组、归属和首次备份。
                settings().world.books[name] ??= { ...newBookCfg(), ...settings().world.wholeMeta[name] };
                settings().world.books[name].mode = mode.value;
                saveSettings(); renderPanel();
            });
            panelRoot.append(mode);
            if (displayChat(name)) panelRoot.append(cfg && cfg.mode !== 'whole' ? bookCard(name, t) : wholeCard(name, t));
            return;
        }
        if (!bookNames().length) panelRoot.append(h('p', { class: 'tvrm-empty' }, '当前角色没有绑定世界书，也没有启用的全局世界书。'));
        const hidden = visibleNames().filter(n => settings().world.hidden?.includes(n));
        if (hidden.length) {
            const select = h('select', { class: 'text_pole', 'aria-label': '重新显示世界书' }, h('option', { value: '' }, '重新显示世界书…'), hidden.map(n => h('option', { value: n }, n)));
            select.addEventListener('change', () => {
                if (!select.value || !current(t)) return;
                settings().world.hidden = settings().world.hidden.filter(n => n !== select.value); saveSettings(); onChatChanged();
            });
            panelRoot.append(select);
        }
        for (const name of bookNames()) panelRoot.append(settings().world.books[name] && settings().world.books[name].mode !== 'whole' ? bookCard(name, t) : wholeCard(name, t));
    }
    function mountPanel() {
        const target = doc.getElementById('extensions_settings2') || doc.getElementById('extensions_settings');
        if (!target || doc.getElementById('tvrm-drawer')) return;
        panelRoot = h('div', { class: 'tvrm-panel' });
        target.append(h('div', { class: 'inline-drawer', id: 'tvrm-drawer' },
            h('div', { class: 'inline-drawer-toggle inline-drawer-header' }, h('b', null, '酒馆你害我不浅'), h('div', { class: 'inline-drawer-icon fa-solid fa-circle-chevron-down down' })),
            h('div', { class: 'inline-drawer-content' }, panelRoot)));
    }
    function syncNative() {
        if (!current(ready)) return;
        const value = doc.getElementById('world_editor_select')?.value;
        const book = value == null || value === '' ? null : allNames()[Number(value)];
        const managed = bookNames().includes(book);
        nativeObserver?.disconnect();
        for (const row of doc.querySelectorAll('#world_popup_entries_list .world_entry[uid]')) {
            const sw = row.querySelector('[name="entryKillSwitch"]');
            if (!sw) continue;
            const want = managed ? resolveEntry(settings(), chatWorld(), book, row.getAttribute('uid')) : null;
            row.querySelector('.tvrm-note-line')?.remove();
            sw.classList.remove('tvrm-lock');
            if (want === null) continue;
            sw.classList.toggle('fa-toggle-on', want); sw.classList.toggle('fa-toggle-off', !want);
            row.classList.toggle('disabledWIEntry', !want);
            row.prepend(h('small', { class: 'tvrm-note-line' }, '聊天配置 · 会同步到原书'));
        }
        if (watchedList?.isConnected) nativeObserver?.observe(watchedList, { childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'uid'] });
    }
    let nativeObserver = null;
    let watchedList = null;
    const scheduleNative = createDebouncer(syncNative, 50, timers);
    function watchNative() {
        const Observer = doc.defaultView?.MutationObserver;
        if (!Observer) return;
        nativeObserver = new Observer(scheduleNative);
        const life = new Observer(() => {
            const list = doc.getElementById('world_popup_entries_list');
            if (list !== watchedList) { watchedList = list; nativeObserver.disconnect(); scheduleNative(); }
        });
        life.observe(doc.body, { childList: true, subtree: true });
        watchedList = doc.getElementById('world_popup_entries_list');
        doc.addEventListener('change', e => { if (e.target.id === 'world_editor_select') scheduleNative(); });
    }
    function init() {
        settings(); mountPanel(); watchNative();
        return onChatChanged();
    }
    return { init, onChatChanged, onChatCreated, onWorldChanged, onEntriesLoaded, settings, mountPanel, flushWriteBack, scheduleWriteBack, syncNative, renderPanel, whenIdle: () => queue };
}

// 界面 + 和酒馆的衔接。所有酒馆的东西都从 host 传进来，方便在模拟环境里测试。
import {
    NS, BUCKET, normalizeSettings, newBookCfg, newGroupId, bucketOf, isCustomBucket,
    removeGroup, setBucket, needsPicker, getChatSlot, setChatSlot, emptyWorldChat, seedWorldChat,
    resolveEntry, snapshotBook, bookMeta, planWriteBack, createDebouncer, entryLabel, entrySub,
} from './core.mjs';

const WRITE_DELAY = 800;
const NOTE_TEXT = '聊天配置 · 会同步到原书';

export function createApp(host) {
    const doc = host.document;
    const ctx = () => host.getContext();
    const timers = host.timers || { setTimeout: (f, m) => setTimeout(f, m), clearTimeout: t => clearTimeout(t) };
    let panelRoot = null;
    let activeTab = 'world';
    const entryCache = new Map(); // 书名 -> 条目数组（只用来显示）

    // ---------- 小工具 ----------
    function h(tag, attrs, ...kids) {
        const el = doc.createElement(tag);
        for (const [k, v] of Object.entries(attrs || {})) {
            if (v === undefined || v === null || v === false) continue;
            if (k === 'class') el.className = v;
            else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
            else if (k === 'value') el.value = v;
            else if (k === 'checked' || k === 'disabled' || k === 'selected' || k === 'open') el[k] = !!v;
            else el.setAttribute(k, v === true ? '' : v);
        }
        for (const kid of kids.flat(Infinity)) if (kid !== null && kid !== undefined && kid !== false) el.append(kid.nodeType ? kid : String(kid));
        return el;
    }
    const toast = (kind, msg) => host.toast?.(kind, msg);

    // ---------- 设置和聊天配置 ----------
    function settings() {
        const c = ctx();
        const raw = c.extensionSettings[NS];
        if (!raw || raw.__ok !== true) {
            const s = normalizeSettings(raw);
            Object.defineProperty(s, '__ok', { value: true, enumerable: false });
            c.extensionSettings[NS] = s;
        }
        return c.extensionSettings[NS];
    }
    const saveSettings = () => ctx().saveSettingsDebounced();
    const chatWorld = () => getChatSlot(ctx().chatMetadata, 'world');
    function saveChatWorld(value) {
        const c = ctx();
        if (!c.chatMetadata) return;
        setChatSlot(c.chatMetadata, 'world', value);
        c.saveMetadataDebounced();
        scheduleWriteBack();
        scheduleNative();
        refreshStatusIfOpen();
    }
    const bookNames = () => Array.from(host.worldNames() || []);

    async function loadEntries(book, fresh = false) {
        if (!fresh && entryCache.has(book)) return entryCache.get(book);
        const data = await host.loadWorldInfo(book);
        const list = data?.entries ? Object.values(data.entries) : [];
        list.sort((a, b) => (a.displayIndex ?? a.uid) - (b.displayIndex ?? b.uid));
        entryCache.set(book, list);
        return list;
    }

    // ---------- 生成时：按这个聊天过滤 ----------
    function onEntriesLoaded(payload) {
        const s = settings();
        const chat = chatWorld();
        const all = [...(payload?.globalLore || []), ...(payload?.characterLore || []), ...(payload?.chatLore || []), ...(payload?.personaLore || [])];
        for (const entry of all) {
            const meta = bookMeta(s, entry.world);
            if (!meta) continue;
            const orig = meta.backup?.data?.entries?.[entry.uid]?.disable ?? entry.disable;
            const want = resolveEntry(s, chat, entry.world, entry.uid, orig === true);
            if (want !== null) entry.disable = !want;
        }
    }

    // ---------- 写回原书 ----------
    let flushing = false;
    async function flushWriteBack() {
        if (flushing) { scheduleWriteBack(); return; }
        flushing = true;
        try {
            const s = settings();
            const startId = ctx().chatId;
            const chat = chatWorld();
            const names = [...Object.keys(s.world.books), ...s.world.wholeBooks];
            for (const name of names) {
                const data = await host.loadWorldInfo(name);
                if (!data || ctx().chatId !== startId) { if (ctx().chatId !== startId) return; continue; }
                const meta = bookMeta(s, name, true);
                if (meta.restored) continue;
                // 备份要拍在「还没被我们改过」的书上，所以先算再备份
                const probe = planWriteBack(s, chat, name, data);
                if (!probe.length) continue;
                if (!meta.backup) {
                    meta.backup = snapshotBook(data); saveSettings();
                    for (const button of doc.querySelectorAll('.tvrm-restore')) {
                        if (button.dataset.book === name) button.disabled = false;
                    }
                }
                const plan = planWriteBack(s, chat, name, data);
                for (const c of plan) data.entries[c.uid].disable = c.disable;
                await host.saveWorldInfo(name, data, true);
                entryCache.delete(name);
            }
        } catch (e) {
            console.warn('[酒馆你害我不浅] 写回原书失败', e);
        } finally {
            flushing = false;
        }
    }
    const scheduleWriteBack = createDebouncer(flushWriteBack, WRITE_DELAY, timers);

    async function restoreBook(name) {
        const meta = bookMeta(settings(), name);
        if (!meta?.backup) { toast('info', '这本书还没有备份'); return; }
        await host.saveWorldInfo(name, JSON.parse(JSON.stringify(meta.backup.data)), true);
        meta.restored = true; // 再次选择或调整配置后重新接管
        entryCache.delete(name);
        saveSettings();
        scheduleNative();
        toast('success', `「${name}」已恢复成备份，再次选择或调整配置后会重新同步`);
        renderPanel();
    }

    // ---------- 三处共用的「条目开关」画面 ----------
    // mode: 'pick'（可改）| 'status'（只看）
    // chat: 当前正在编辑的聊天配置（pick）或已保存的（status）
    async function renderLoreView(box, { mode, chat, onChange }) {
        const s = settings();
        box.replaceChildren();
        box.classList.add('tvrm-view');
        const bookList = Object.keys(s.world.books).filter(n => bookNames().includes(n));
        let any = false;
        for (const name of bookList) {
            const cfg = s.world.books[name];
            const entries = await loadEntries(name, mode === 'pick');
            const groups = [];
            if (mode === 'status') {
                groups.push({ id: BUCKET.ON, name: '常开', desc: '', mode: 'any', fixed: true });
                groups.push({ id: BUCKET.OFF, name: '常关', desc: '', mode: 'any', fixed: true });
            }
            for (const g of cfg.groups) groups.push(g);
            const sections = [];
            for (const g of groups) {
                const members = entries.filter(e => bucketOf(cfg, e.uid) === g.id);
                if (!members.length && mode === 'status') continue;
                sections.push(groupSection(name, g, members, cfg, { mode, chat, onChange, s }));
            }
            if (!sections.length) continue;
            any = true;
            box.append(h('section', { class: 'tvrm-book' }, h('h4', { class: 'tvrm-book-title' }, name), sections));
        }
        const whole = s.world.wholeBooks.filter(n => bookNames().includes(n));
        if (whole.length) {
            any = true;
            const rows = whole.map(name => {
                const on = mode === 'pick' ? chat?.books?.[name] !== false : wholeEffective(s, chat, name);
                return switchRow({
                    name, sub: '整本书', checked: on, readonly: mode === 'status',
                    onToggle: v => { chat.books[name] = v; onChange?.(); },
                });
            });
            box.append(h('section', { class: 'tvrm-book' }, h('h4', { class: 'tvrm-book-title' }, '整本开关'), rows));
        }
        if (!any) box.append(h('p', { class: 'tvrm-empty' }, mode === 'pick' ? '还没有需要选的分组。先在扩展面板里给世界书建组。' : '还没有受管的条目。'));
    }

    function wholeEffective(s, chat, name) {
        const v = chat?.books?.[name];
        return v === undefined ? null : v;
    }

    function groupSection(book, g, members, cfg, { mode, chat, onChange, s }) {
        const picked = chat?.groups?.[book]?.[g.id];
        const details = h('details', { class: 'tvrm-group', open: true },
            h('summary', null, h('span', { class: 'tvrm-group-name' }, g.name), h('span', { class: 'tvrm-count' }, `${members.length}`)),
        );
        if (!members.length) details.append(h('p', { class: 'tvrm-note' }, '分类还没有条目，请在扩展面板下方的条目菜单中归类。'));
        if (g.desc) details.append(h('p', { class: 'tvrm-desc' }, g.desc));
        for (const e of members) {
            const uid = String(e.uid);
            let checked;
            if (mode === 'status') {
                const want = resolveEntry(s, chat, book, uid);
                checked = want;
            } else checked = Array.isArray(picked) && picked.includes(uid);
            details.append(switchRow({
                name: entryLabel(e), sub: entrySub(e), checked, readonly: mode === 'status',
                onToggle: v => {
                    chat.groups[book] ??= {};
                    const cur = new Set(chat.groups[book][g.id] || []);
                    if (v) cur.add(uid); else cur.delete(uid);
                    chat.groups[book][g.id] = [...cur];
                    onChange?.();
                },
            }));
        }
        return details;
    }

    // 一行：名字在左、开关在右、小字在名字下方
    function switchRow({ name, sub, checked, readonly, onToggle }) {
        const input = h('input', { type: 'checkbox', checked: checked === true, disabled: readonly });
        if (!readonly) input.addEventListener('change', () => onToggle(input.checked));
        const state = checked === null ? '未设置' : checked ? '开' : '关';
        return h('label', { class: 'tvrm-row' + (readonly ? ' is-readonly' : '') + (checked === false ? ' is-off' : '') },
            h('span', { class: 'tvrm-main' }, h('span', { class: 'tvrm-name' }, name), sub ? h('small', { class: 'tvrm-sub' }, sub) : null),
            h('span', { class: 'tvrm-switch', title: state }, input, h('i')));
    }

    // ---------- 弹窗：选哪些 ----------
    let pickerBusy = false;
    async function openPicker(automatic = false) {
        if (pickerBusy) return;
        const s = settings();
        if (!needsPicker(s)) { if (!automatic) toast('info', '没有可选择的条目，请在扩展面板将条目归入自定义分类；常开、常关会自动应用。'); return; }
        if (ctx().chatId === undefined || ctx().chatId === null) return;
        const startId = ctx().chatId;
        pickerBusy = true;
        try {
            let chat = chatWorld();
            if (!chat) {
                const by = {};
                for (const n of [...Object.keys(s.world.books), ...s.world.wholeBooks]) by[n] = await loadEntries(n, true);
                chat = seedWorldChat(s, by);
            } else chat = JSON.parse(JSON.stringify(chat));
            const box = h('div', { class: 'tvrm-popup' }, h('h3', { class: 'tvrm-popup-title' }, '这个聊天用哪些世界书内容'));
            const body = h('div');
            box.append(body);
            await renderLoreView(body, { mode: 'pick', chat, onChange: () => {} });
            if (ctx().chatId !== startId) return;
            if (!body.querySelector('input:not(:disabled)')) {
                if (!automatic) toast('info', '没有可选择的条目：请先把条目归入自定义分类；常开、常关会自动应用。');
                return;
            }
            const ok = await host.popup(box, '确定');
            if (ok && ctx().chatId === startId) {
                // 画面上看到什么就存什么：没碰过的组按「没选」存下来
                for (const [n, cfg] of Object.entries(s.world.books)) {
                    cfg.restored = false;
                    chat.groups[n] ??= {};
                    for (const g of cfg.groups) chat.groups[n][g.id] ??= [];
                }
                for (const n of s.world.wholeBooks) { chat.books[n] ??= true; bookMeta(s, n, true).restored = false; }
                saveSettings();
                saveChatWorld(chat);
            }
        } finally {
            pickerBusy = false;
        }
    }

    // ---------- 状态 ----------
    let statusBox = null;
    async function openStatus() {
        const box = h('div', { class: 'tvrm-popup' }, h('h3', { class: 'tvrm-popup-title' }, '世界书状态'));
        const body = h('div');
        box.append(body, h('p', { class: 'tvrm-note' }, '这是当前聊天的配置结果；条目还要满足关键词、概率等原本的触发条件才会真的进提示词。'));
        statusBox = body;
        await renderLoreView(body, { mode: 'status', chat: chatWorld() });
        await host.popup(box, null);
        statusBox = null;
    }
    function refreshStatusIfOpen() {
        if (statusBox?.isConnected) renderLoreView(statusBox, { mode: 'status', chat: chatWorld() });
    }

    // ---------- 打开酒馆自带世界书页面：开关、变暗、小字跟着当前聊天 ----------
    let nativeTimer = null;
    let nativeObserver = null;
    function scheduleNative() {
        if (nativeTimer !== null) return;
        nativeTimer = timers.setTimeout(() => { nativeTimer = null; syncNative(); }, 50);
    }
    function currentBookInEditor() {
        const sel = doc.getElementById('world_editor_select');
        if (!sel || sel.value === '') return null;
        return bookNames()[Number(sel.value)] ?? null;
    }
    function syncNative() {
        const list = doc.getElementById('world_popup_entries_list');
        if (!list) return;
        nativeObserver?.disconnect();
        try {
            const s = settings();
            const chat = chatWorld();
            const book = currentBookInEditor();
            for (const row of list.querySelectorAll('.world_entry[uid]')) {
                const uid = row.getAttribute('uid');
                const want = book ? resolveEntry(s, chat, book, uid, false) : null;
                const sw = row.querySelector('[name="entryKillSwitch"]');
                const note = row.querySelector(':scope > .tvrm-note-line');
                if (want === null || !sw) {
                    if (note) { note.remove(); row.classList.remove('tvrm-governed'); sw?.classList.remove('tvrm-lock'); }
                    continue;
                }
                row.classList.add('tvrm-governed');
                sw.classList.add('tvrm-lock');
                sw.classList.toggle('fa-toggle-on', want);
                sw.classList.toggle('fa-toggle-off', !want);
                row.classList.toggle('disabledWIEntry', !want);
                if (!note) {
                    // 单独一行，放在条目最上面，不盖住任何原有按钮
                    row.prepend(h('small', { class: 'tvrm-note-line' }, NOTE_TEXT));
                }
            }
        } catch (e) {
            console.warn('[酒馆你害我不浅] 同步世界书页面失败', e);
        } finally {
            if (list.isConnected) nativeObserver?.observe(list, { childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'uid'] });
        }
    }
    function startNativeWatch() {
        if (typeof MutationObserver !== 'function') return;
        nativeObserver = new MutationObserver(scheduleNative);
        // 世界书页面是后来才出现、会被重建的，所以盯住 body 的增减
        const life = new MutationObserver(() => {
            const list = doc.getElementById('world_popup_entries_list');
            if (list && list !== watchedList) { watchedList = list; nativeObserver.disconnect(); scheduleNative(); }
        });
        let watchedList = null;
        life.observe(doc.body, { childList: true, subtree: true });
        scheduleNative();
    }

    // ---------- 扩展面板 ----------
    function mountPanel() {
        const target = doc.getElementById('extensions_settings2') || doc.getElementById('extensions_settings');
        if (!target || doc.getElementById('tvrm-drawer')) return;
        panelRoot = h('div', { class: 'tvrm-panel' });
        const drawer = h('div', { class: 'inline-drawer', id: 'tvrm-drawer' },
            h('div', { class: 'inline-drawer-toggle inline-drawer-header' },
                h('b', null, '酒馆你害我不浅'),
                h('div', { class: 'inline-drawer-icon fa-solid fa-circle-chevron-down down' })),
            h('div', { class: 'inline-drawer-content' }, panelRoot));
        target.append(drawer);
        renderPanel();
    }

    function tabs() {
        const mk = (id, label, on) => h('button', {
            type: 'button', class: 'tvrm-tab' + (activeTab === id ? ' is-active' : '') + (on ? '' : ' is-disabled'),
            disabled: !on, title: on ? '' : '还没做',
            onclick: () => { activeTab = id; renderPanel(); },
        }, label, on ? null : h('small', null, '还没做'));
        return h('div', { class: 'tvrm-tabs' }, mk('world', '世界书', true), mk('preset', '预设', false), mk('api', 'API', false));
    }

    function renderPanel() {
        if (!panelRoot) return;
        panelRoot.replaceChildren(tabs());
        if (activeTab === 'world') panelRoot.append(worldPane());
    }

    function worldPane() {
        const s = settings();
        const pane = h('div', { class: 'tvrm-pane' });
        pane.append(h('div', { class: 'tvrm-actions' },
            h('button', { type: 'button', class: 'menu_button', onclick: () => openPicker() }, '重选当前聊天'),
            h('button', { type: 'button', class: 'menu_button', onclick: () => openStatus() }, '看 世界书状态')));

        // 添加书
        const names = bookNames();
        const used = new Set([...Object.keys(s.world.books), ...s.world.wholeBooks]);
        const sel = h('select', { class: 'text_pole tvrm-select' }, h('option', { value: '' }, '选一本世界书…'),
            names.filter(n => !used.has(n)).map(n => h('option', { value: n }, n)));
        const add = kind => () => {
            if (!sel.value) return;
            if (kind === 'entry') s.world.books[sel.value] = newBookCfg();
            else s.world.wholeBooks.push(sel.value);
            saveSettings(); renderPanel();
        };
        pane.append(h('div', { class: 'tvrm-add' }, sel,
            h('button', { type: 'button', class: 'menu_button', onclick: add('entry') }, '按条目分组'),
            h('button', { type: 'button', class: 'menu_button', onclick: add('whole') }, '整本开关')));

        for (const name of Object.keys(s.world.books)) pane.append(bookCard(name, s));
        for (const name of s.world.wholeBooks) pane.append(wholeCard(name, s));
        return pane;
    }

    function cardHead(name, tag, meta, onRemove) {
        return h('div', { class: 'tvrm-card-head' },
            h('span', { class: 'tvrm-card-title' }, h('b', null, name), h('small', null, tag)),
            h('span', { class: 'tvrm-card-tools' },
                h('button', { type: 'button', class: 'menu_button tvrm-icon', title: '移除', onclick: () => onRemove() }, '✕')));
    }

    function restoreAction(name) {
        return h('button', { type: 'button', class: 'tvrm-restore', 'data-book': name, disabled: !bookMeta(settings(), name)?.backup, onclick: () => restoreBook(name) }, '恢复原书');
    }
    function wholeCard(name, s) {
        return h('section', { class: 'tvrm-card' },
            cardHead(name, '整本开关', bookMeta(s, name), () => {
                s.world.wholeBooks = s.world.wholeBooks.filter(n => n !== name);
                delete s.world.wholeMeta[name];
                saveSettings(); renderPanel();
            }), restoreAction(name));
    }

    function bookCard(name, s) {
        const cfg = s.world.books[name];
        const det = h('details', { class: 'tvrm-card' });
        det.append(h('summary', null, cardHead(name, '按条目分组', cfg, () => { delete s.world.books[name]; saveSettings(); renderPanel(); })));
        const body = h('div', { class: 'tvrm-card-body' });
        det.append(body, restoreAction(name));
        let loaded = false;
        det.addEventListener('toggle', () => { if (det.open && !loaded) { loaded = true; fillBook(body, name, cfg); } });
        return det;
    }

    async function fillBook(body, name, cfg) {
        body.replaceChildren(h('p', { class: 'tvrm-empty' }, '读取中…'));
        const entries = await loadEntries(name, true);
        const refresh = () => { cfg.restored = false; saveSettings(); scheduleWriteBack(); scheduleNative(); fillBook(body, name, cfg); };

        body.replaceChildren();
        // 组的编辑
        body.append(h('div', { class: 'tvrm-sub-title' }, '分组'));
        for (const g of cfg.groups) {
            const nameIn = h('input', { class: 'text_pole', value: g.name, placeholder: '组名' });
            nameIn.addEventListener('change', () => { g.name = nameIn.value.trim() || g.name; saveSettings(); });
            const descIn = h('input', { class: 'text_pole', value: g.desc || '', placeholder: '说明（选的时候会显示）' });
            descIn.addEventListener('change', () => { g.desc = descIn.value; saveSettings(); });
            body.append(h('div', { class: 'tvrm-group-edit' }, nameIn, descIn,
                h('button', { type: 'button', class: 'menu_button', onclick: () => { removeGroup(cfg, g.id); refresh(); } }, '删除这组')));
        }
        body.append(h('button', { type: 'button', class: 'menu_button', onclick: () => { cfg.groups.push({ id: newGroupId(), name: '新分组 ' + (cfg.groups.length + 1), desc: '' }); refresh(); } }, '＋ 新建分组'));
        body.append(h('p', { class: 'tvrm-note' }, '建好分类后，用下方条目右侧的菜单归类。常开、常关不需要在聊天中选择。'));

        // 条目分桶
        body.append(h('div', { class: 'tvrm-sub-title' }, `条目（${entries.length}）`));
        const bucketOptions = cur => [
            h('option', { value: BUCKET.FREE, selected: cur === BUCKET.FREE }, '不管'),
            h('option', { value: BUCKET.ON, selected: cur === BUCKET.ON }, '常开'),
            h('option', { value: BUCKET.OFF, selected: cur === BUCKET.OFF }, '常关'),
            cfg.groups.map(g => h('option', { value: g.id, selected: cur === g.id }, g.name)),
        ];
        for (const e of entries) {
            const cur = bucketOf(cfg, e.uid);
            const stale = isCustomBucket(cur) && !cfg.groups.some(g => g.id === cur);
            const sel = h('select', { class: 'text_pole tvrm-bucket' }, bucketOptions(stale ? BUCKET.FREE : cur));
            sel.addEventListener('change', () => { setBucket(cfg, e.uid, sel.value); cfg.restored = false; saveSettings(); scheduleWriteBack(); scheduleNative(); });
            body.append(h('div', { class: 'tvrm-row' },
                h('span', { class: 'tvrm-main' }, h('span', { class: 'tvrm-name' }, entryLabel(e)), h('small', { class: 'tvrm-sub' }, entrySub(e))), sel));
        }
    }

    // ---------- 事件 ----------
    const prompted = new Set();
    function maybePrompt() {
        const id = ctx().chatId;
        if (id == null || chatWorld() || prompted.has(id) || !needsPicker(settings())) return;
        prompted.add(id);
        timers.setTimeout(() => { if (ctx().chatId === id && !chatWorld()) return openPicker(true); }, 300);
    }
    function onChatChanged() {
        maybePrompt();
        scheduleWriteBack();
        scheduleNative();
        refreshStatusIfOpen();
    }
    function onChatCreated() {
        maybePrompt();
    }

    function init() {
        settings();
        mountPanel();
        startNativeWatch();

    }

    return { init, onEntriesLoaded, onChatChanged, onChatCreated, openPicker, openStatus, flushWriteBack, scheduleWriteBack, syncNative, renderLoreView, settings, mountPanel };
}

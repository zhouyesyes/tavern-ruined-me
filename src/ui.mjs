// 酒馆接口由 host 传入；聊天切换、原书修改共用队列，避免异步结果串窗。
import {
    NS, BUCKET, normalizeSettings, newBookCfg, newGroupId, bucketOf,
    removeGroup, setBucket, getChatSlot, setChatSlot, emptyWorldChat,
    resolveEntry, snapshotBook, bookMeta, planWriteBack, createDebouncer,
    entryLabel, entrySub, boundBookNames, bindingKinds, reconcileBook, isClassified,
} from './core.mjs';

export function createApp(host) {
    const doc = host.document;
    const ctx = () => host.getContext();
    const timers = host.timers || { setTimeout, clearTimeout };
    const toast = (kind, msg) => host.toast?.(kind, msg);
    let panelRoot = null;
    let mode = 'world'; // 面板当前标签：world / preset
    let ready = null;
    let chatPopup = null;
    const openBooks = new Set(); // 面板里展开的书，默认都折叠
    const filters = new Map(); // 每本书当前点中、正在改名的分组
    const closedSections = new Set(); // 点收起的分组（书名|组id），默认全展开
    const openEntries = new Set(); // 点开看内容的条目（书名|uid）
    const managementChats = new Map();
    const displayChat = name => bookNames().includes(name) ? chatWorld() : managementChats.get(name);
    // 面板里列出的书：当前聊天绑定的，加上她分过类但没绑到当前聊天的（排在后面）
    const extraNames = () => allNames().filter(n => !bookNames().includes(n) && !settings().world.hidden?.includes(n) && isClassified(settings(), n));
    const listedNames = () => [...bookNames(), ...extraNames()];
    let queue = Promise.resolve();
    let revision = 0;
    let ownSave = false;
    let lockToken = null; // 切聊天时上锁：读出新聊天自己的配置、写回原书完成前，任何开关变化都不记
    const hasChat = () => ctx().chatId != null;
    const locked = () => lockToken !== null && current(lockToken);
    let missedWhileLocked = false; // 上锁期间收到过原书更新：解锁后再按聊天自己的配置还原一次
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
        return t && t.id === c.chatId && t.character === c.characterId && t.group === c.groupId && t.meta === c.chatMetadata && t.rev === revision && t.binding === signature();
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
        if (s.world.books[name]) return;
        // 旧版「整本开关」的书也改成按条目分类；备份和原来的设置接过来，wholeBooks 里的记录原样留着
        s.world.books[name] = { ...newBookCfg(), ...(s.world.wholeBooks.includes(name) ? s.world.wholeMeta[name] : null) };
    }
    async function readBook(name) {
        const loaded = await host.loadWorldInfo(name);
        const data = loaded ? clone(loaded) : null;
        if (!data?.entries) throw new Error('无法读取世界书：' + name);
        entryCache.set(name, Object.values(data.entries).sort((a, b) => (a.displayIndex ?? a.uid) - (b.displayIndex ?? b.uid)));
        return data;
    }
    async function synchronize(t, restore = false) {
        if (!current(t)) return;
        const s = settings();
        if (!hasChat()) return syncNoChat(t); // 没开聊天：只读所有世界书给面板看，不碰任何开关
        // 新聊天第一次进来没有自己的配置：沿用原书现状（等同切进聊天，不当成手动修改）
        if (!chatWorld()) restore = true;
        if (restore) lockToken = t;
        try { await synchronizeInner(t, restore, s); }
        finally { if (lockToken === t) lockToken = null; } // 写回完成（或被新切换取代）才解锁
        if (missedWhileLocked && lockToken === null && current(t)) {
            missedWhileLocked = false;
            const again = token();
            enqueue(() => synchronize(again, true)); // 别的插件在上锁期间动过书：以聊天自己的配置再还原一遍，不记录
        }
    }
    async function syncNoChat(t) {
        ready = t;
        managementChats.clear();
        for (const name of extraNames()) {
            try { await loadManagement(name, t); } catch (e) { console.warn('[酒馆你害我不浅] 读不到世界书', name, e); }
            if (!current(t)) return;
        }
        renderPanel();
    }
    async function synchronizeInner(t, restore, s) {
        const chat = clone(chatWorld() || emptyWorldChat());
        const loaded = [];
        for (const name of bookNames()) {
            ensureBook(name);
            const data = await readBook(name);
            if (!current(t)) return;
            reconcileBook(s, chat, name, data, restore);
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
            reconcileBook(s, chat, name, data, restore); // 上锁期间第二遍也只当还原，不记录
            await writePlan(t, name, data, chat);
        }
        if (!current(t)) return;
        await persistChat(t);
        saveSettings();
        // 分过类但没绑到这个聊天的书：只读进来给面板显示，不碰聊天配置
        for (const name of extraNames()) {
            try { await loadManagement(name, t); } catch (e) { console.warn('[酒馆你害我不浅] 读不到世界书', name, e); }
            if (!current(t)) return;
        }
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
        // 先记下「插件自己写成了什么」再保存：保存引起的事件晚到也认得出是自己写的，不算外部修改。
        s.world.physical[name] = Object.fromEntries(Object.values(data.entries).map(e => [String(e.uid), e.disable !== true]));
        ownSave = true;
        try { await host.saveWorldInfo(name, data, true); }
        finally { ownSave = false; }
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
        if (panelRoot && hasChat()) panelRoot.replaceChildren(h('p', { class: 'tvrm-empty' }, '正在读取当前聊天…'));
        const t = token();
        // 切进聊天：以这个聊天自己存的选择为准写回原书（restore）
        return enqueue(() => synchronize(t, true));
    }
    const onChatCreated = () => onChatChanged(); // 新开聊天不再弹窗
    function onWorldChanged() {
        if (ownSave) return;
        if (locked()) { missedWhileLocked = true; return; } // 切聊天还没处理完：上一个聊天留在原书里的状态不是手动修改
        if (current(ready)) return scheduleWriteBack();
        // 还没读完这个聊天（或换了聊天）：按切聊天处理，以聊天自己存的选择为准
        const same = ready && ready.id === ctx().chatId && ready.character === ctx().characterId && ready.group === ctx().groupId && ready.meta === ctx().chatMetadata;
        if (!same) return onChatChanged();
        // 同一个聊天里绑定变了（开场白换书、别的插件改绑定）：旧界面失效，按当前原书实际状态核对，手拨/脚本开关记进本聊天
        revision++; pending.clear(); ready = null; scheduleWriteBack.cancel();
        const t = token();
        return enqueue(() => synchronize(t));
    }
    async function onEntriesLoaded(payload) {
        const source = ctx();
        const metadata = source.chatMetadata;
        const id = source.chatId;
        const character = source.characterId;
        const group = source.groupId;
        if (!hasChat()) return;
        if (locked()) await queue;
        else if (!current(ready)) await onChatChanged();
        if (!current(ready) || metadata !== ctx().chatMetadata || id !== ctx().chatId || character !== ctx().characterId || group !== ctx().groupId) return;
        const s = settings();
        const chat = chatWorld();
        const names = new Set(bookNames());
        const all = [...(payload?.globalLore || []), ...(payload?.characterLore || []), ...(payload?.chatLore || []), ...(payload?.personaLore || [])];
        // 只把本聊天的选择套到这次要用的条目副本上；副本里别的插件临时改的开关不记进聊天，
        // 真正写进原书的修改（手拨开关、开场白/脚本存书）走 WORLDINFO_UPDATED 记录。
        for (const entry of all) {
            if (!names.has(entry.world) || bookMeta(s, entry.world)?.restored) continue;
            const want = resolveEntry(s, chat, entry.world, entry.uid, entry.disable === true);
            if (want !== null) entry.disable = !want;
        }
    }
    function changeChat(t, name, fn) {
        if (!hasChat()) return;
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
    // 一本书的分类：常开、常关、自定义组；其余是未分类。弹窗和面板共用。
    function bookSections(name) {
        const cfg = settings().world.books[name];
        const entries = entryCache.get(name) || [];
        const cats = [{ id: BUCKET.ON, name: '常开' }, { id: BUCKET.OFF, name: '常关' }, ...cfg.groups];
        const ids = new Set(cats.map(g => g.id));
        const of = e => { const b = bucketOf(cfg, e.uid); return ids.has(b) ? b : BUCKET.FREE; };
        const sections = [...cats, { id: BUCKET.FREE, name: '未分类' }].map(g => ({ ...g, custom: g.id !== BUCKET.ON && g.id !== BUCKET.OFF && g.id !== BUCKET.FREE, members: entries.filter(e => of(e) === g.id) }));
        return { cfg, cats, sections, classified: entries.length - sections.at(-1).members.length, free: sections.at(-1).members.length };
    }
    // 这个条目现在开不开：绑定的书看这个聊天的选择，没绑的书看原书
    function entryOn(name, entry) {
        if (!hasChat() || !bookNames().includes(name)) return entry.disable !== true;
        return resolveEntry(settings(), chatWorld(), name, entry.uid, entry.disable === true) ?? entry.disable !== true;
    }
    // 点开一个条目才看到的内容：关键词和正文，只读
    function entryDetail(entry) {
        const keys = Array.isArray(entry.key) ? entry.key.filter(Boolean).join('、') : '';
        const secondary = Array.isArray(entry.keysecondary) ? entry.keysecondary.filter(Boolean).join('、') : '';
        return h('div', { class: 'tvrm-detail' },
            h('div', { class: 'tvrm-detail-line' }, h('b', null, '关键词'), keys || '（无）'),
            secondary && h('div', { class: 'tvrm-detail-line' }, h('b', null, '次要词'), secondary),
            h('pre', { class: 'tvrm-detail-text' }, (entry.content || '').trim() || '（正文是空的）'));
    }
    // 管理面板里的一本书：默认折叠，标题旁一行状态；点开是分组小标签 + 所有条目（按组可折叠）
    function bookCard(name, t, zone = 'bound') {
        ensureBook(name);
        const { cfg, cats, sections, classified } = bookSections(name);
        const entries = entryCache.get(name) || [];
        const bound = hasChat() && bookNames().includes(name);
        const loaded = entryCache.has(name);
        const onCount = entries.filter(e => entryOn(name, e)).length;
        const card = h('details', { class: 'tvrm-card', open: openBooks.has(zone + '|' + name) });
        card.dataset.book = name; card.dataset.zone = zone;
        card.addEventListener('toggle', () => {
            if (card.open) openBooks.add(zone + '|' + name); else openBooks.delete(zone + '|' + name);
            // 还没读过的书：点开时才读，读完重画
            if (card.open && !entryCache.has(name)) enqueue(async () => { await loadManagement(name, t); if (current(t)) renderPanel(); }).catch(() => {});
        });
        card.append(h('summary', null, h('span', { class: 'tvrm-name' }, name),
            h('small', { class: 'tvrm-count' }, loaded ? `分类${classified} · 开${onCount}/${entries.length}${zone === 'all' && bound ? ' · 本聊天用着' : ''}` : '点开读取')));
        const body = h('div', { class: 'tvrm-card-body' });
        let pick = filters.get(name) || null;
        if (pick && !cfg.groups.some(g => g.id === pick)) pick = null;
        const select = id => { if (id) filters.set(name, id); else filters.delete(name); openBooks.add(zone + '|' + name); renderPanel(); };
        // 小标签 = 自定义分组；点一下出现改名/删除，再点收起
        body.append(h('div', { class: 'tvrm-chips' },
            cfg.groups.map(g => h('button', { type: 'button', class: 'tvrm-chip' + (pick === g.id ? ' is-on' : ''), onclick: () => select(pick === g.id ? null : g.id) },
                `${g.name} ${sections.find(x => x.id === g.id)?.members.length ?? 0}`)),
            h('button', { type: 'button', class: 'tvrm-chip tvrm-chip-add', 'aria-label': '新建分组', onclick: () => {
                if (!current(t)) return;
                const g = { id: newGroupId(), name: '新分组 ' + (cfg.groups.length + 1) };
                cfg.groups.push(g); saveSettings(); select(g.id);
            } }, '＋ 新建')));
        const shown = pick && sections.find(g => g.id === pick);
        if (shown?.custom) {
            const input = h('input', { class: 'text_pole', value: shown.name, 'aria-label': '分组名称' });
            const feedback = h('small', { role: 'status', class: 'tvrm-save-feedback' });
            // 改名只在点「保存」时才存，不会因为失焦偷偷保存
            body.append(h('div', { class: 'tvrm-group-edit' }, input,
                button('保存', () => {
                    if (!current(t)) return;
                    const value = input.value.trim();
                    if (!value) { feedback.textContent = '请填写组名'; return; }
                    const g = cfg.groups.find(x => x.id === shown.id); g.name = value; saveSettings();
                    feedback.textContent = '已保存'; toast('success', '分组名称已保存');
                    for (const el of card.querySelectorAll('.tvrm-chip.is-on')) el.textContent = `${value} ${shown.members.length}`;
                }),
                button('删除分组', async () => {
                    if (!await confirm(`删除分组「${shown.name}」？条目会回到未分类，原书条目不会删除。`) || !current(t)) return;
                    removeGroup(cfg, shown.id); filters.delete(name); saveSettings(); renderPanel();
                }, 'tvrm-delete'), feedback));
        }
        const area = h('div', { class: 'tvrm-entries' });
        for (const g of sections) {
            if (!g.members.length && !g.custom) continue;
            const key = name + '|' + g.id;
            const on = g.members.filter(e => entryOn(name, e)).length;
            const section = h('details', { class: 'tvrm-entry-section', open: !closedSections.has(key) },
                h('summary', null, h('span', null, `${g.name}（${g.members.length}）`), h('small', null, `开${on}`)));
            section.addEventListener('toggle', () => { if (section.open) closedSections.delete(key); else closedSections.add(key); });
            for (const entry of g.members) {
                const uid = String(entry.uid);
                const ekey = zone + '|' + name + '|' + uid;
                const isOn = entryOn(name, entry);
                const sel = h('select', { class: 'text_pole tvrm-bucket', 'aria-label': entryLabel(entry) + '归组' },
                    [{ id: BUCKET.FREE, name: '未分类' }, ...cats].map(x => h('option', { value: x.id, selected: x.id === g.id }, x.name)));
                sel.addEventListener('change', () => {
                    if (!current(t)) return;
                    setBucket(cfg, uid, sel.value); saveSettings();
                    if (hasChat() && (sel.value === BUCKET.ON || sel.value === BUCKET.OFF)) changeChat(t, name, c => { c.entries[name][uid] = sel.value === BUCKET.ON; });
                    else renderPanel();
                });
                const wrap = h('div', { class: 'tvrm-entry-wrap' });
                const arrow = h('button', { type: 'button', class: 'tvrm-expand' + (openEntries.has(ekey) ? ' is-open' : ''), 'aria-label': entryLabel(entry) + '展开内容', 'aria-expanded': openEntries.has(ekey) ? 'true' : 'false' }, '▸');
                let detail = null;
                const showDetail = () => { detail = entryDetail(entry); wrap.append(detail); };
                arrow.addEventListener('click', () => {
                    if (openEntries.has(ekey)) { openEntries.delete(ekey); detail?.remove(); detail = null; }
                    else { openEntries.add(ekey); showDetail(); }
                    arrow.classList.toggle('is-open', openEntries.has(ekey)); arrow.setAttribute('aria-expanded', openEntries.has(ekey) ? 'true' : 'false');
                });
                wrap.append(h('div', { class: 'tvrm-entry' + (isOn ? '' : ' is-off') },
                    h('span', { class: 'tvrm-state ' + (isOn ? 'is-on' : 'is-off'), 'aria-label': isOn ? '开着' : '关着' }, isOn ? '开' : '关'),
                    h('span', { class: 'tvrm-name', title: entrySub(entry) }, entryLabel(entry)), sel, arrow));
                if (openEntries.has(ekey)) showDetail();
                section.append(wrap);
            }
            if (!g.members.length) section.append(h('p', { class: 'tvrm-empty' }, '这一组还没有条目；在条目右边的下拉里选这个组。'));
            area.append(section);
        }
        if (!entries.length) area.append(h('p', { class: 'tvrm-empty' }, loaded ? '这本书里还没有条目。' : '正在读取…'));
        body.append(area);
        const hasBackup = !!bookMeta(settings(), name)?.backup;
        body.append(h('div', { class: 'tvrm-foot' },
            h('button', { type: 'button', class: 'tvrm-restore', disabled: !hasBackup, onclick: () => restoreBook(name, t) }, '恢复原书'),
            h('button', { type: 'button', class: 'tvrm-restore tvrm-delete', onclick: async () => {
                if (!await confirm('从本面板移除「' + name + '」？原书和备份都会保留，可重新显示。') || !current(t)) return;
                (settings().world.hidden ??= []).push(name); saveSettings(); renderPanel();
            } }, '从面板移除')));
        card.append(body);
        return card;
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
    // 这个聊天开哪些：只有分了类的条目和没分类的条目，勾一下就走
    async function showChat() {
        await flushWriteBack();
        return openChatPopup();
    }
    async function openChatPopup() {
        if (!current(ready)) return;
        const content = h('div', { class: 'tvrm-popup' });
        const popup = { content };
        chatPopup = popup;
        renderChatPopup();
        try { await host.popup(content, null); }
        finally { if (chatPopup === popup) chatPopup = null; }
    }
    function renderChatPopup() {
        if (!chatPopup || !current(ready)) return;
        const { content } = chatPopup;
        const t = token();
        const s = settings(), chat = chatWorld();
        // 重画会丢滚动位置，先记下来
        const scrolls = []; for (let p = content; p; p = p.parentElement) scrolls.push([p, p.scrollTop]);
        content.replaceChildren(h('h3', { class: 'tvrm-title' }, '这个聊天开哪些'));
        for (const name of bookNames()) {
            const { sections } = bookSections(name);
            const book = h('section', { class: 'tvrm-pop-book' }, h('h4', null, name));
            for (const g of sections) {
                if (!g.members.length) continue;
                const box = h('details', { class: 'tvrm-pop-group', open: true }, h('summary', null, `${g.name}（${g.members.length}）`));
                for (const entry of g.members) {
                    const uid = String(entry.uid);
                    box.append(switchRow({ name: entryLabel(entry), checked: resolveEntry(s, chat, name, uid, entry.disable === true) ?? !entry.disable,
                        onToggle: on => changeChat(t, name, c => { c.entries[name][uid] = on; c.books[name] = true; }) }));
                }
                book.append(box);
            }
            content.append(book);
        }
        if (!bookNames().length) content.append(h('p', { class: 'tvrm-empty' }, '当前角色没有绑定世界书，也没有启用的全局世界书。'));
        for (const [p, top] of scrolls) p.scrollTop = top;
    }
    function renderPanel() {
        if (!panelRoot || !current(ready)) return;
        renderChatPopup();
        const t = token();
        const keeper = host.presetKeeper;
        panelRoot.replaceChildren(h('div', { class: 'tvrm-tabs' }, button('世界书', () => { mode = 'world'; renderPanel(); }, 'tvrm-tab' + (mode === 'world' ? ' is-active' : '')),
            keeper ? button('预设', () => { mode = 'preset'; renderPanel(); }, 'tvrm-tab' + (mode === 'preset' ? ' is-active' : '')) : h('button', { type: 'button', disabled: true, class: 'tvrm-tab is-disabled' }, '预设'),
            h('button', { type: 'button', disabled: true, class: 'tvrm-tab is-disabled' }, 'API')));
        if (mode === 'preset' && keeper) { const box = h('div', { class: 'tvrm-presets' }); panelRoot.append(box); keeper.render(box); return; }
        const chatOn = hasChat();
        if (chatOn) panelRoot.append(h('div', { class: 'tvrm-actions' }, button('这个聊天开哪些', () => showChat())));
        // 第一块：这个聊天绑定的（没开聊天就不显示）
        if (chatOn) {
            const kinds = bindingKinds(ctx(), host.bindings?.(), allNames());
            const shown = n => !settings().world.hidden?.includes(n);
            panelRoot.append(h('h4', { class: 'tvrm-heading' }, '这个聊天绑定的'));
            for (const [label, list] of [['角色世界书', kinds.character], ['聊天世界书', kinds.chat], ['全局世界书', kinds.global]]) {
                const names = list.filter(shown);
                panelRoot.append(h('h5', { class: 'tvrm-sub' }, `${label}（${names.length}）`));
                if (!names.length) panelRoot.append(h('p', { class: 'tvrm-empty' }, '没有'));
                for (const name of names) panelRoot.append(bookCard(name, t, 'bound'));
            }
        }
        // 第二块：酒馆里所有世界书（分没分类的都列）
        const everything = allNames().filter(n => !settings().world.hidden?.includes(n));
        panelRoot.append(h('h4', { class: 'tvrm-heading tvrm-heading-all' }, `所有世界书（${everything.length}）`));
        if (!everything.length) panelRoot.append(h('p', { class: 'tvrm-empty' }, '酒馆里还没有世界书。'));
        for (const name of everything) panelRoot.append(bookCard(name, t, 'all'));
        const hidden = allNames().filter(n => settings().world.hidden?.includes(n));
        if (hidden.length) {
            const select = h('select', { class: 'text_pole', 'aria-label': '重新显示世界书' }, h('option', { value: '' }, '重新显示世界书…'), hidden.map(n => h('option', { value: n }, n)));
            select.addEventListener('change', () => {
                if (!select.value || !current(t)) return;
                settings().world.hidden = settings().world.hidden.filter(n => n !== select.value); saveSettings(); onChatChanged();
            });
            panelRoot.append(select);
        }
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

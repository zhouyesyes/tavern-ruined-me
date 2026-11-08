// 预设格：每个聊天记自己用的预设、条目开关和顺序。全部自己写。
// 切聊天时先上锁：读出这个聊天自己的配置 → 换回预设、写回开关和顺序 → 等写完才解锁；
// 上锁期间的任何变化都不记，插件自己写回造成的变化也不记（和世界书同一套做法）。

const clone = x => JSON.parse(JSON.stringify(x));
const KEY = 'tavern_ruined_me_presets';

// ---- 纯逻辑 ----
export const snapshotOrder = order => (order || []).map(o => ({ id: String(o.identifier), on: o.enabled !== false }));
// 把存下的顺序套到现在的预设上：后加的条目保留（排在后面，保持它现在的开关），删掉的条目跳过
export function applyOrder(current, saved) {
    const cur = new Map((current || []).map(o => [String(o.identifier), o]));
    const out = []; const used = new Set();
    for (const s of saved || []) {
        const o = cur.get(s.id); if (!o || used.has(s.id)) continue;
        used.add(s.id); out.push({ ...o, enabled: s.on });
    }
    for (const o of current || []) if (!used.has(String(o.identifier))) out.push({ ...o });
    return out;
}
export const sameOrder = (a, b) => JSON.stringify(a) === JSON.stringify(b);
export function nextSaveName(chat) {
    const digits = '零一二三四五六七八九十';
    const taken = new Set(chat.saves.map(s => s.name));
    for (let i = 1; ; i++) { const n = '存档' + (i <= 10 ? digits[i] : i); if (!taken.has(n)) return n; }
}
let seq = 0;
const newId = () => 's' + Date.now().toString(36) + (seq++).toString(36);
export function newRecord(preset, order) { return { preset, active: { order: clone(order) }, saves: [] }; }
export function saveAs(chat, name) {
    const s = { id: newId(), name: (name || '').trim() || nextSaveName(chat), preset: chat.preset, order: clone(chat.active.order) };
    chat.saves.push(s); return s;
}
// 切换：把存档抄进「在用」，存档本身不动；切换前原来的「在用」存成「上一套」（只留最近一份）
export function switchTo(chat, id) {
    const target = chat.saves.find(s => s.id === id);
    if (!target) return null;
    chat.saves = chat.saves.filter(s => !s.previous);
    chat.saves.push({ id: newId(), name: '上一套', previous: true, preset: chat.preset, order: clone(chat.active.order) });
    chat.preset = target.preset; chat.active = { order: clone(target.order) };
    return target;
}
export function renameSave(chat, id, name) { const s = chat.saves.find(x => x.id === id); const v = (name || '').trim(); if (s && v) { s.name = v; s.previous = false; return true; } return false; }
export function deleteSave(chat, id) { const n = chat.saves.length; chat.saves = chat.saves.filter(s => s.id !== id); return chat.saves.length !== n; }

// ---- 带界面的部分 ----
// host: document, getContext(), chatInfo() → {key,label}, preset: { name(), order(), setOrder(order), select(name), entryName(id) }
export function createPresetKeeper(host) {
    const doc = host.document;
    const ctx = () => host.getContext();
    const toast = (k, m) => host.toast?.(k, m);
    let lock = null; let own = 0; let queue = Promise.resolve(); let revision = 0; let rerender = null;
    const open = new Set(); const openSaves = new Set();
    const store = () => { const c = ctx(); c.extensionSettings[KEY] ??= { chats: {} }; return c.extensionSettings[KEY]; };
    const save = () => ctx().saveSettingsDebounced?.();
    const cur = () => { const i = host.chatInfo(); return i?.key ? i : null; };
    const record = () => { const i = cur(); return i ? store().chats[i.key] : null; };
    const locked = () => lock !== null;
    function h(tag, attrs, ...kids) {
        const el = doc.createElement(tag);
        for (const [k, v] of Object.entries(attrs || {})) {
            if (v === undefined || v === null || v === false) continue;
            if (k === 'class') el.className = v; else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
            else if (k === 'open') el.open = !!v; else el.setAttribute(k, v === true ? '' : v);
        }
        for (const kid of kids.flat(Infinity)) if (kid !== null && kid !== undefined && kid !== false) el.append(kid.nodeType ? kid : String(kid));
        return el;
    }
    async function write(fn) { own++; try { await fn(); } finally { own--; } } // 插件自己写的，不算手动修改

    // 换预设 → 等酒馆加载完 → 写回开关和顺序 → 刷新预设页。任何一步失败都抛出，由调用方告诉她。
    async function apply(rec) {
        await write(async () => {
            if (rec.preset && rec.preset !== host.preset.name()) {
                await host.preset.select(rec.preset);
                if (host.preset.name() !== rec.preset) throw new Error('预设没有切过去：' + rec.preset);
            }
            await host.preset.setOrder(applyOrder(host.preset.order(), rec.active.order));
        });
    }
    async function enter(my, info) {
        const chats = store().chats; const rec = chats[info.key];
        if (!rec) { // 新聊天第一次进来：沿用现在的预设，不改任何东西
            chats[info.key] = newRecord(host.preset.name(), snapshotOrder(host.preset.order()));
        } else {
            try { await apply(rec); }
            catch (e) { console.warn('[酒馆你害我不浅] 预设切换失败', e); toast('warning', '这个聊天的预设没能切回来：' + (e.message || e)); }
        }
        chats[info.key].label = info.label;
        if (my === revision) save();
    }
    // 切聊天：先上锁，写回完成才解锁；排队执行，连切几次只做最后一个
    function onChatChanged() {
        const my = ++revision; lock = my;
        const info = cur();
        queue = queue.then(async () => {
            try { if (info && my === revision) await enter(my, info); }
            catch (e) { console.warn('[酒馆你害我不浅] 预设切换失败', e); }
            finally { if (lock === my) lock = null; }
            rerender?.();
        });
        return queue;
    }
    // 预设页里手动开关/拖动/换预设：解锁后才记，只记进当前聊天
    function onPresetEvent() {
        if (locked() || own > 0) return;
        const rec = record(); if (!rec) return;
        const order = snapshotOrder(host.preset.order());
        if (rec.preset === host.preset.name() && sameOrder(rec.active.order, order)) return;
        rec.preset = host.preset.name(); rec.active = { order };
        save(); rerender?.();
    }
    // 切到某个存档：同样排队、上锁；先真的切成功，才改记录（切不过去就什么都不动）
    function doSwitch(id) {
        const info = cur(); if (!info) return queue;
        const my = ++revision; lock = my;
        queue = queue.then(async () => {
            try {
                const rec = store().chats[info.key]; if (!rec || my !== revision) return;
                const draft = clone(rec);
                if (!switchTo(draft, id)) return;
                await apply(draft);
                rec.saves = draft.saves; rec.preset = draft.preset; rec.active = draft.active; save();
                toast('success', '已切换；原来那套存成了「上一套」');
            } catch (e) { console.warn('[酒馆你害我不浅] 存档切换失败', e); toast('error', '没切过去：' + (e.message || e)); }
            finally { if (lock === my) lock = null; }
            rerender?.();
        });
        return queue;
    }
    function rename(chat, item, nameEl) { // 点名字改名：出现输入框和「保存」，点了保存才存
        const input = h('input', { class: 'text_pole', value: item.name, 'aria-label': '存档名称' });
        input.value = item.name;
        const editor = h('div', { class: 'tvrm-group-edit' }, input,
            h('button', { type: 'button', class: 'menu_button', onclick: () => { if (renameSave(chat, item.id, input.value)) { save(); rerender?.(); } } }, '保存'),
            h('button', { type: 'button', class: 'menu_button', onclick: () => editor.replaceWith(nameEl) }, '取消'));
        nameEl.replaceWith(editor); input.focus?.();
    }

    function orderList(order) {
        return h('ol', { class: 'tvrm-ledger-lines' }, order.map(o => h('li', { class: o.on ? '' : 'is-off' },
            h('span', { class: 'tvrm-state ' + (o.on ? 'is-on' : 'is-off') }, o.on ? '开' : '关'), h('span', { class: 'tvrm-name' }, host.preset.entryName?.(o.id) || o.id))));
    }
    function setCard(chat, label, item, isActive, key) {
        const k = key + '|' + (item.id || 'active');
        const d = h('details', { class: 'tvrm-set' + (isActive ? ' is-active' : ''), open: openSaves.has(k) }, h('summary', null, h('span', { class: 'tvrm-name' }, label),
            h('small', { class: 'tvrm-count' }, `${item.preset || chat.preset} · ${item.order.length} 条`)));
        d.addEventListener('toggle', () => { if (d.open) openSaves.add(k); else openSaves.delete(k); });
        if (!isActive) {
            const nameEl = h('button', { type: 'button', class: 'tvrm-rename', title: '点一下改名' }, item.name, h('small', null, '　点名字改名'));
            nameEl.addEventListener('click', () => rename(chat, item, nameEl));
            d.append(h('div', { class: 'tvrm-rename-row' }, nameEl));
        }
        d.append(orderList(item.order));
        if (isActive) d.append(h('div', { class: 'tvrm-set-actions' }, h('button', { type: 'button', class: 'menu_button', onclick: () => { saveAs(chat, ''); save(); rerender?.(); } }, '另存一套')));
        else d.append(h('div', { class: 'tvrm-set-actions' },
            h('button', { type: 'button', class: 'menu_button', onclick: () => doSwitch(item.id) }, '切换到这套'),
            h('button', { type: 'button', class: 'menu_button tvrm-delete', onclick: async () => { if (await host.confirm?.(`删除「${item.name}」？`)) { deleteSave(chat, item.id); save(); rerender?.(); } } }, '删除')));
        return d;
    }
    function render(container) {
        rerender = () => render(container);
        const chats = store().chats; const keys = Object.keys(chats); const here = cur()?.key;
        container.replaceChildren();
        if (!keys.length) return; // 没有内容就什么都不放
        container.append(h('h4', { class: 'tvrm-heading' }, `预设格（${keys.length} 个聊天）`));
        for (const key of keys) {
            const chat = chats[key];
            // 聊天名一行，预设名一行，不挤在一起
            const d = h('details', { class: 'tvrm-card tvrm-page', open: open.has(key) }, h('summary', null,
                h('span', { class: 'tvrm-name' }, (chat.label || key) + (key === here ? '（当前）' : '')),
                h('small', { class: 'tvrm-count' }, `${chat.preset || '未知预设'} · 存档${chat.saves.length}套`)));
            d.addEventListener('toggle', () => { if (d.open) open.add(key); else open.delete(key); });
            const body = h('div', { class: 'tvrm-card-body' });
            body.append(setCard(chat, '在用', chat.active, true, key));
            for (const s of chat.saves) body.append(setCard(chat, s.name, s, false, key));
            d.append(body); container.append(d);
        }
    }
    return { onChatChanged, onPresetEvent, render, whenIdle: () => queue, store, doSwitch };
}

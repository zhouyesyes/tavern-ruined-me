// API 格：钥匙本的界面 + 「点哪填哪」。全部自己写。
// host: document, getContext(), toast(kind,msg), confirm(text),
//       proxy: { names(), add({name,url,password}) }   酒馆的反代列表
//       probe(url, key) → 模型名数组（走酒馆服务器拉一次模型列表；不通就抛错）
import { KEYS, newKey, maskKey, searchKeys, freeProxyName, classifyField, autoName } from './keys.mjs';

export function createKeyKeeper(host) {
    const doc = host.document;
    const ctx = () => host.getContext();
    const toast = (k, m) => host.toast?.(k, m);
    const store = () => { const c = ctx(); c.extensionSettings[KEYS] ??= { keys: [] }; c.extensionSettings[KEYS].keys ??= []; return c.extensionSettings[KEYS]; };
    const save = () => ctx().saveSettingsDebounced?.();
    let rerender = null; let query = ''; let editing = null; // editing：正在编辑的那条（新建时是没有 id 的草稿）
    const open = new Set(); const busy = new Set();

    function h(tag, attrs, ...kids) {
        const el = doc.createElement(tag);
        for (const [k, v] of Object.entries(attrs || {})) {
            if (v === undefined || v === null || v === false) continue;
            if (k === 'class') el.className = v; else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
            else if (k === 'open') el.open = !!v; else if (k === 'value') el.value = v; else if (k === 'checked') el.checked = !!v;
            else el.setAttribute(k, v === true ? '' : v);
        }
        for (const kid of kids.flat(Infinity)) if (kid !== null && kid !== undefined && kid !== false) el.append(kid.nodeType ? kid : String(kid));
        return el;
    }
    const btn = (text, onclick, cls = '') => h('button', { type: 'button', class: 'menu_button ' + cls, onclick }, text);

    async function copy(text) {
        try { await doc.defaultView.navigator.clipboard.writeText(text); toast('success', '复制好了'); }
        catch { toast('warning', '没能复制，长按手动选一下'); }
    }

    // 放进酒馆的反代列表（新建时默认勾着）
    function addToProxies(k) {
        if (!host.proxy || !k.url) return;
        try {
            const name = freeProxyName(k.name, host.proxy.names());
            host.proxy.add({ name, url: k.url, password: k.key });
            k.proxyName = name;
        } catch (e) { toast('warning', '没能放进酒馆的反代列表：' + (e.message || e)); }
    }

    async function test(k) {
        if (!k.url) { toast('warning', '先填地址'); return; }
        busy.add(k.id); rerender?.();
        try {
            k.models = await host.probe(k.url, k.key);
            k.tested = { ok: true, at: Date.now(), n: k.models.length };
            toast('success', `通了，有 ${k.models.length} 个模型`);
        } catch (e) {
            k.tested = { ok: false, at: Date.now(), msg: String(e.message || e) };
            toast('error', '没通：' + (e.message || e));
        } finally { busy.delete(k.id); save(); rerender?.(); }
    }

    function editor(draft) {
        const isNew = !store().keys.includes(draft.ref);
        const f = {
            name: h('input', { class: 'text_pole', value: draft.name, placeholder: '名字（不填就用地址）' }),
            url: h('input', { class: 'text_pole', value: draft.url, placeholder: '地址，比如 https://xxx.com/v1', autocomplete: 'off' }),
            key: h('input', { class: 'text_pole', value: draft.key, placeholder: draft.keyHint ? '密钥（原来是 ' + draft.keyHint + '）' : '密钥', autocomplete: 'off', 'data-tvrm-keyfield': 'own' }),
            model: h('input', { class: 'text_pole', value: draft.model, placeholder: '模型（可以测完连接再挑）', list: 'tvrm-models-' + (draft.ref?.id || 'new') }),
            tags: h('input', { class: 'text_pole', value: (draft.tags || []).join(' '), placeholder: '标签，空格隔开' }),
            note: h('textarea', { class: 'text_pole', rows: 2, placeholder: '备注' }),
        };
        f.note.value = draft.note || '';
        const proxy = h('input', { type: 'checkbox', checked: true });
        const models = h('datalist', { id: 'tvrm-models-' + (draft.ref?.id || 'new') }, (draft.ref?.models || []).map(m => h('option', { value: m })));
        const row = (label, el) => h('label', { class: 'tvrm-key-field' }, h('span', null, label), el);
        return h('div', { class: 'tvrm-key-editor' },
            row('名字', f.name), row('地址', f.url), row('密钥', f.key), row('模型', f.model), models, row('标签', f.tags), row('备注', f.note),
            isNew && host.proxy ? h('label', { class: 'tvrm-key-check' }, proxy, ' 也放进酒馆的反代列表') : null,
            h('div', { class: 'tvrm-set-actions' },
                btn('保存', () => {
                    const k = newKey({ ...(draft.ref || {}), name: f.name.value, url: f.url.value, key: f.key.value || draft.ref?.key || '', model: f.model.value, tags: f.tags.value, note: f.note.value });
                    if (!k.url && !k.key) { toast('warning', '地址和密钥至少填一个'); return; }
                    if (f.key.value) k.keyHint = '';
                    const list = store().keys;
                    if (isNew) { if (proxy.checked) addToProxies(k); list.unshift(k); }
                    else Object.assign(draft.ref, k);
                    editing = null; save(); rerender?.();
                    toast('success', isNew && k.proxyName ? `存好了，也放进了酒馆的反代列表「${k.proxyName}」` : '存好了');
                }),
                btn('取消', () => { editing = null; rerender?.(); })));
    }

    function card(k) {
        const d = h('details', { class: 'tvrm-card tvrm-key', open: open.has(k.id) },
            h('summary', null, h('span', { class: 'tvrm-name' }, k.name || autoName(k.url)),
                h('small', { class: 'tvrm-count' }, [k.model, k.url].filter(Boolean).join(' · ') || '没有地址')));
        d.addEventListener('toggle', () => { if (d.open) open.add(k.id); else open.delete(k.id); });
        if (editing?.ref === k) { d.append(editor(editing)); return d; }
        const line = (label, value, act) => value ? h('div', { class: 'tvrm-key-line' }, h('span', { class: 'tvrm-key-label' }, label), h('span', { class: 'tvrm-key-value' }, value), act || null) : null;
        const t = k.tested;
        d.append(h('div', { class: 'tvrm-card-body' },
            line('地址', k.url, btn('复制', () => copy(k.url), 'tvrm-btn-mini')),
            line('密钥', k.key ? maskKey(k.key) : k.keyHint ? k.keyHint + '（只有遮住的样子）' : '', k.key ? btn('复制', () => copy(k.key), 'tvrm-btn-mini') : null),
            line('模型', k.model),
            line('标签', (k.tags || []).join('、')),
            line('备注', k.note),
            line('反代', k.proxyName ? '在酒馆的反代列表里：' + k.proxyName : ''),
            t ? h('div', { class: 'tvrm-key-test ' + (t.ok ? 'is-ok' : 'is-bad') }, t.ok ? `通了 · ${t.n} 个模型` : '没通：' + t.msg) : null,
            k.models?.length ? h('details', { class: 'tvrm-key-models' }, h('summary', null, `挑模型（${k.models.length}）`),
                h('div', { class: 'tvrm-key-model-list' }, k.models.map(m => h('button', { type: 'button', class: 'tvrm-chip' + (m === k.model ? ' is-on' : ''), onclick: () => { k.model = m; save(); rerender?.(); } }, m)))) : null,
            h('div', { class: 'tvrm-set-actions' },
                btn(busy.has(k.id) ? '测试中…' : '测连接', () => !busy.has(k.id) && test(k)),
                btn('编辑', () => { editing = { ...k, ref: k }; rerender?.(); }),
                k.url && !k.proxyName && host.proxy ? btn('放进酒馆反代', () => { addToProxies(k); save(); rerender?.(); }) : null,
                btn('删除', async () => { if (await host.confirm?.(`删除「${k.name}」？酒馆反代列表里的不会跟着删。`)) { store().keys = store().keys.filter(x => x !== k); save(); rerender?.(); } }, 'tvrm-delete'))));
        return d;
    }

    function render(container) {
        rerender = () => render(container);
        const s = store();
        container.replaceChildren();
        const search = h('input', { class: 'text_pole', placeholder: '搜名字、地址、模型、标签', value: query });
        search.addEventListener('input', () => { query = search.value; const list = container.querySelector('.tvrm-key-list'); list?.replaceWith(listEl()); });
        container.append(h('div', { class: 'tvrm-actions' }, search,
            btn('新建', () => { editing = { ...newKey(), ref: null }; rerender?.(); })));
        if (editing && !editing.ref) container.append(editor(editing));
        container.append(listEl());
        function listEl() {
            const list = searchKeys(s.keys, query);
            return h('div', { class: 'tvrm-key-list' }, list.length ? list.map(card) : s.keys.length ? h('p', { class: 'tvrm-empty' }, '没有搜到') : null);
        }
    }

    // ---- 点哪填哪 ----
    let target = null; let pill = null; let sheet = null;
    const isOurs = el => !!el.closest?.('.tvrm-key-sheet, .tvrm-key-editor, [data-tvrm-keyfield]');
    function labelOf(el) {
        const esc = doc.defaultView.CSS?.escape || (x => x.replace(/[^\w-]/g, '\\$&'));
        const id = el.id && doc.querySelector(`label[for="${esc(el.id)}"]`)?.textContent;
        const near = el.closest('label')?.textContent || el.previousElementSibling?.textContent || el.parentElement?.previousElementSibling?.textContent || '';
        return [id, el.getAttribute('aria-label'), el.title, near].filter(Boolean).join(' ').slice(0, 120);
    }
    const kindOf = el => el?.tagName === 'INPUT' && !isOurs(el) ? classifyField({ type: el.type, id: el.id, name: el.name, placeholder: el.placeholder, label: labelOf(el), value: el.value }) : null;
    // 配对的那个框：往上找几层，找离得最近的另一种框（填地址时顺手填密钥，反过来也一样）
    function partnerOf(el, kind) {
        let box = el.parentElement;
        for (let up = 0; box && up < 6; up++, box = box.parentElement) {
            const other = [...box.querySelectorAll('input')].filter(x => x !== el && kindOf(x) && kindOf(x) !== kind);
            if (other.length) return other[0];
        }
        return null;
    }
    function setValue(el, v) {
        const proto = Object.getPrototypeOf(el); const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
        if (setter) setter.call(el, v); else el.value = v;
        el.dispatchEvent(new (doc.defaultView.Event)('input', { bubbles: true }));
        el.dispatchEvent(new (doc.defaultView.Event)('change', { bubbles: true }));
    }
    function fill(k) {
        const el = target?.el; if (!el?.isConnected) return closeSheet();
        const kind = target.kind; const other = partnerOf(el, kind);
        const val = x => (x === 'url' ? k.url : k.key);
        if (!val(kind)) { toast('warning', kind === 'url' ? '这条没有地址' : '这条没有密钥（只有遮住的样子）'); return; }
        setValue(el, val(kind));
        let both = false;
        if (other && val(kindOf(other))) { setValue(other, val(kindOf(other))); both = true; }
        closeSheet(); hidePill();
        toast('success', `填好了「${k.name}」` + (both ? '（地址和密钥都填了）' : ''));
    }
    // 框在弹窗（<dialog>，浏览器的最上层）里：小钥匙和选单也放进那个弹窗，不然会被它盖住看不见；不在弹窗里就放在页面上
    const layerOf = el => el?.closest?.('dialog[open]') || doc.body;
    function hidePill() { pill?.remove(); pill = null; }
    function closeSheet() { sheet?.remove(); sheet = null; }
    function showPill(el, kind) {
        hidePill();
        if (!store().keys.length) return;
        const r = el.getBoundingClientRect(); const layer = layerOf(el);
        pill = h('button', { type: 'button', class: 'tvrm-key-pill', title: '从钥匙本里填', 'aria-label': '从钥匙本里填' }, h('i', { class: 'fa-solid fa-key' }));
        // 弹窗里：按弹窗的位置算（弹窗自己是定位的）；页面上：按屏幕位置算
        const base = layer === doc.body ? { top: 0, left: 0 } : layer.getBoundingClientRect();
        if (layer !== doc.body) pill.classList.add('in-dialog');
        pill.style.top = Math.max(0, r.top - base.top + (r.height - 28) / 2) + 'px';
        pill.style.left = Math.max(0, r.right - base.left - 32) + 'px';
        // 按下去时不让输入框失焦（手机上键盘不会收起又弹出）
        pill.addEventListener('pointerdown', e => e.preventDefault());
        pill.addEventListener('mousedown', e => e.preventDefault());
        pill.addEventListener('click', () => openSheet(kind));
        layer.append(pill);
    }
    function openSheet(kind) {
        closeSheet();
        let q = '';
        const list = h('div', { class: 'tvrm-key-sheet-list' });
        const draw = () => list.replaceChildren(...searchKeys(store().keys, q).map(k => {
            const has = kind === 'url' ? k.url : k.key;
            return h('button', { type: 'button', class: 'tvrm-key-pick' + (has ? '' : ' is-off'), onclick: () => fill(k) },
                h('span', { class: 'tvrm-name' }, k.name), h('small', null, [k.model, k.url].filter(Boolean).join(' · ')));
        }));
        const search = h('input', { class: 'text_pole', placeholder: '搜一下', 'data-tvrm-keyfield': 'own' });
        search.addEventListener('input', () => { q = search.value; draw(); });
        sheet = h('div', { class: 'tvrm-key-sheet', role: 'dialog' },
            h('div', { class: 'tvrm-key-sheet-head' }, h('b', null, kind === 'url' ? '填地址（密钥一起）' : '填密钥（地址一起）'), btn('关', closeSheet, 'tvrm-btn-mini')),
            store().keys.length > 6 ? search : null, list);
        draw();
        layerOf(target?.el).append(sheet);
    }
    function initFill() {
        doc.addEventListener('focusin', e => {
            const el = e.composedPath?.()[0] || e.target;
            const kind = kindOf(el);
            if (kind) { target = { el, kind }; showPill(el, kind); }
        });
        doc.addEventListener('focusout', () => setTimeout(() => { if (!sheet && !doc.activeElement?.closest?.('.tvrm-key-pill')) hidePill(); }, 200));
        doc.addEventListener('pointerdown', e => { if (sheet && !e.target.closest?.('.tvrm-key-sheet')) closeSheet(); }, true);
        doc.defaultView.addEventListener('scroll', hidePill, { passive: true, capture: true });
    }

    return { render, initFill, store, kindOf, partnerOf, fill: k => fill(k), setTarget: (el, kind) => { target = { el, kind }; } };
}

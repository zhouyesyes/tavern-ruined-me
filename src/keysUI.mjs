// API 格：钥匙本的界面 + 「点哪填哪」。全部自己写。
// host: document, getContext(), toast(kind,msg), confirm(text),
//       proxy: { list() → [{name,url,password}] }   酒馆的反代列表（只在扫描时读，不往里加）
//       probe(url, key) → 模型名数组（走酒馆服务器拉一次模型列表；不通就抛错）
import { KEYS, newKey, maskKey, searchKeys, classifyField, autoName, scanSettings, sameKey, hostOf } from './keys.mjs';

export function createKeyKeeper(host) {
    const doc = host.document;
    const ctx = () => host.getContext();
    const toast = (k, m) => host.toast?.(k, m);
    const store = () => { const c = ctx(); c.extensionSettings[KEYS] ??= { keys: [] }; c.extensionSettings[KEYS].keys ??= []; return c.extensionSettings[KEYS]; };
    const save = () => ctx().saveSettingsDebounced?.();
    let rerender = null; let query = ''; let editing = null; // editing：正在编辑的那条（新建时是没有 id 的草稿）
    const open = new Set(); const busy = new Set();
    let found = null; // 扫描结果：[{ source, path, name, url, key, have, pick }]

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

    // 扫描：酒馆反代列表 + 所有插件设置里存的「地址 + 密钥」；已经在钥匙本里的标出来，不勾
    function scan() {
        const list = [];
        for (const p of host.proxy?.list?.() || []) if (p?.url && p.password) list.push({ source: '酒馆反代列表', path: '酒馆反代列表 › ' + p.name, name: p.name, url: p.url, key: p.password });
        list.push(...scanSettings(ctx().extensionSettings, [KEYS, 'tavern_ruined_me', 'tavern_ruined_me_presets']));
        const mine = store().keys; const seen = new Set();
        found = list.filter(f => { const id = f.url + '|' + f.key; if (seen.has(id)) return false; seen.add(id); return true; })
            .map(f => { const have = mine.some(k => sameKey(k, f)); return { ...f, have, pick: !have && !!f.url }; })
            .sort((a, b) => (!!b.url - !!a.url) || (a.have - b.have)); // 有地址的在前；没地址的默认不勾（多半不是拿来连 API 的）
        rerender?.();
        const fresh = found.filter(f => !f.have).length;
        toast(fresh ? 'success' : 'info', found.length ? `找到 ${found.length} 条，其中 ${fresh} 条钥匙本里还没有` : '没找到存着地址和密钥的地方');
    }
    function scanBox() {
        const rows = found.map(f => {
            const cb = h('input', { type: 'checkbox', checked: f.pick, disabled: f.have });
            cb.addEventListener('change', () => { f.pick = cb.checked; });
            return h('label', { class: 'tvrm-scan-row' + (f.have ? ' is-have' : '') }, cb,
                h('span', { class: 'tvrm-scan-text' },
                    h('span', { class: 'tvrm-name' }, f.name || hostOf(f.url) || '没有地址的密钥'),
                    h('small', null, [f.url, maskKey(f.key)].filter(Boolean).join(' · ')),
                    h('small', { class: 'tvrm-scan-from' }, (f.have ? '钥匙本里已经有 · ' : '') + '来自 ' + f.path)));
        });
        return h('div', { class: 'tvrm-scan' },
            h('div', { class: 'tvrm-scan-head' }, h('b', null, `扫描到 ${found.length} 条`), btn('关掉', () => { found = null; rerender?.(); }, 'tvrm-btn-mini')),
            rows.length ? rows : h('p', { class: 'tvrm-empty' }, '酒馆反代列表和插件设置里都没找到'),
            rows.length ? h('div', { class: 'tvrm-set-actions' }, btn('收进钥匙本', () => {
                const take = found.filter(f => f.pick && !f.have);
                for (const f of take) store().keys.push(newKey({ name: f.name, url: f.url, key: f.key, note: '扫描来自 ' + f.path }));
                found = null; save(); rerender?.();
                toast('success', take.length ? `收进来 ${take.length} 条` : '没有勾选');
            })) : null);
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
        const models = h('datalist', { id: 'tvrm-models-' + (draft.ref?.id || 'new') }, (draft.ref?.models || []).map(m => h('option', { value: m })));
        const row = (label, el) => h('label', { class: 'tvrm-key-field' }, h('span', null, label), el);
        return h('div', { class: 'tvrm-key-editor' },
            row('名字', f.name), row('地址', f.url), row('密钥', f.key), row('模型', f.model), models, row('标签', f.tags), row('备注', f.note),
            h('div', { class: 'tvrm-set-actions' },
                btn('保存', () => {
                    const k = newKey({ ...(draft.ref || {}), name: f.name.value, url: f.url.value, key: f.key.value || draft.ref?.key || '', model: f.model.value, tags: f.tags.value, note: f.note.value });
                    if (!k.url && !k.key) { toast('warning', '地址和密钥至少填一个'); return; }
                    if (f.key.value) k.keyHint = '';
                    const list = store().keys;
                    if (isNew) list.unshift(k);
                    else Object.assign(draft.ref, k);
                    editing = null; save(); rerender?.();
                    toast('success', '存好了');
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
            t ? h('div', { class: 'tvrm-key-test ' + (t.ok ? 'is-ok' : 'is-bad') }, t.ok ? `通了 · ${t.n} 个模型` : '没通：' + t.msg) : null,
            k.models?.length ? h('details', { class: 'tvrm-key-models' }, h('summary', null, `挑模型（${k.models.length}）`),
                h('div', { class: 'tvrm-key-model-list' }, k.models.map(m => h('button', { type: 'button', class: 'tvrm-chip' + (m === k.model ? ' is-on' : ''), onclick: () => { k.model = m; save(); rerender?.(); } }, m)))) : null,
            h('div', { class: 'tvrm-set-actions' },
                btn(busy.has(k.id) ? '测试中…' : '测连接', () => !busy.has(k.id) && test(k)),
                btn('编辑', () => { editing = { ...k, ref: k }; rerender?.(); }),
                btn('删除', async () => { if (await host.confirm?.(`删除「${k.name}」？`)) { store().keys = store().keys.filter(x => x !== k); save(); rerender?.(); } }, 'tvrm-delete'))));
        return d;
    }

    function render(container) {
        rerender = () => render(container);
        const s = store();
        container.replaceChildren();
        const search = h('input', { class: 'text_pole', placeholder: '搜名字、地址、模型、标签', value: query });
        search.addEventListener('input', () => { query = search.value; const list = container.querySelector('.tvrm-key-list'); list?.replaceWith(listEl()); });
        container.append(h('div', { class: 'tvrm-actions' }, search,
            btn('新建', () => { editing = { ...newKey(), ref: null }; rerender?.(); }),
            btn('扫描', scan)));
        if (found) container.append(scanBox());
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
    let follow = null; // 正在贴着的框
    function hidePill() { pill?.remove(); pill = null; follow = null; }
    function closeSheet() { sheet?.remove(); sheet = null; }
    // 小钥匙直接插在输入框旁边、和它待在同一个盒子里，按框自己的位置贴在框里右边尽头：
    // 页面怎么滚、键盘怎么弹都跟着框走（以前按屏幕位置算，键盘一推就偏到别处去了）
    function place(el) {
        if (!pill) return;
        if (!el.isConnected) { hidePill(); return; }
        pill.style.visibility = el.offsetWidth && el.offsetHeight ? '' : 'hidden';
        pill.style.top = el.offsetTop + Math.max(0, (el.offsetHeight - 26) / 2) + 'px';
        pill.style.left = el.offsetLeft + Math.max(0, el.offsetWidth - 30) + 'px';
    }
    function showPill(el, kind) {
        hidePill();
        if (!store().keys.length) return;
        pill = h('button', { type: 'button', class: 'tvrm-key-pill', title: '从钥匙本里填', 'aria-label': '从钥匙本里填' }, h('i', { class: 'fa-solid fa-key' }));
        // 按下去时不让输入框失焦；松手时打开列表（手机上 click 有时等不到）
        let opened = false;
        const openIt = e => { e.preventDefault(); if (opened) return; opened = true; setTimeout(() => { opened = false; }, 400); openSheet(kind); };
        pill.addEventListener('pointerdown', e => e.preventDefault());
        pill.addEventListener('mousedown', e => e.preventDefault());
        pill.addEventListener('pointerup', openIt);
        pill.addEventListener('click', openIt);
        el.after(pill);
        follow = el; place(el);
    }
    function openSheet(kind) {
        closeSheet();
        target?.el?.blur?.(); // 先收起键盘，列表从下面出来才看得见
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
        // 框的大小变了（转屏、键盘弹出时页面重排）再贴一次
        const replace = () => { if (follow) place(follow); };
        doc.defaultView.addEventListener('resize', replace, { passive: true });
        doc.defaultView.visualViewport?.addEventListener('resize', replace, { passive: true });
        // 点到别处（不是小钥匙、不是选单、不是这个框）才收起；不看「框有没有失焦」，iPhone 上失焦时机不准
        doc.addEventListener('pointerdown', e => {
            const t = e.composedPath?.()[0] || e.target;
            if (t?.closest?.('.tvrm-key-pill, .tvrm-key-sheet') || t === target?.el) return;
            closeSheet();
            if (!kindOf(t)) hidePill();
        }, true);
    }

    return { render, initFill, store, kindOf, partnerOf, fill: k => fill(k), setTarget: (el, kind) => { target = { el, kind }; } };
}

// 界面格：把酒馆里不常用的按钮和设置收起来（照「砚台 · 界面整理」的功能自己重写，没有复制它的代码）。
// 只加 / 去掉咱们自己的 class、自己插的折叠头，和扩展页上记得住原值的几条行内样式；关掉或「恢复原界面」就全部还原。
// 藏起来只是看不见，插件照常运行。聊天内容一概不看。
// host: document, getContext(), toast(kind,msg), confirm(text), on(eventName, fn)

export const TIDY = 'tavern_ruined_me_tidy';

// 顶部按钮：酒馆自带那几个的中文名（别的插件加的按钮用它自己的 title）
export const TOP_NAMES = {
    'ai-config-button': '预设 / 回复参数', 'sys-settings-button': 'API 连接', 'advanced-formatting-button': '回复格式',
    'WI-SP-button': '世界书', 'user-settings-button': '用户设置', 'backgrounds-button': '背景',
    'extensions-settings-button': '扩展', 'persona-management-button': '用户人设', 'rightNavHolder': '角色卡',
};
// 扩展按钮不让藏：咱们这个面板就在扩展页里，藏了就找不回来了
export const TOP_KEEP = 'extensions-settings-button';
// 三横菜单默认收进「更多工具」的
export const MENU_DEFAULT = ['option_toggle_AN', 'option_toggle_CFG', 'option_toggle_logprobs', 'option_convert_to_group', 'option_impersonate'];
// 用户设置里能折起来的几段（选择器是酒馆 index.html 里的结构）
export const USER_PARTS = [
    { key: 'theme', sel: '#UI-Theme-Block > [name="themeElements"]', name: '主题细节', tip: '头像样式、颜色、字号、模糊、疯狂实验室' },
    { key: 'character', sel: '#UI-Customization > [name="CharacterHandlingToggles"]', name: '角色卡', tip: '角色列表、标签、头像' },
    { key: 'misc', sel: '#UI-Customization > [name="MiscellaneousToggles"]', name: '其他偏好', tip: '流式、音效、自定义 CSS' },
    { key: 'chat', sel: '#power-user-option-checkboxes > [name="ChatMessageHandlingToggles"]', name: '聊天与消息', tip: '加载条数、消息按钮、自动续写' },
    { key: 'script', sel: '#power-user-option-checkboxes > [name="STscriptToggles"]', name: '脚本', tip: '宏和脚本' },
];
// 扩展页：酒馆自带的扩展（排在前面），其次酒馆助手，再其次别的插件按第一次见到的顺序
export const SYSTEM_EXT = ['regex_container', 'vectors_container', 'assets_container', 'typing_indicator_container', 'expressions_container', 'sd_container', 'tts_container',
    'rvc_container', 'stt_container', 'audio_container', 'silence_container', 'objective_container', 'blip_container', 'live2d_container', 'vrm_container',
    'timelines_container', 'webllm_container', 'rss_container', 'websearch_container', 'emulatorjs_container', 'qr_container', 'translation_container',
    'caption_container', 'idle_container', 'summarize_container', 'hypebot_container', 'randomizer_container', 'chromadb_container', 'message_limit_container',
    'injects_container', 'accuweather_container', 'dice_container'];
export const EXT_DEFAULT = ['assets_container', 'expressions_container', 'sd_container', 'tts_container', 'qr_container', 'translation_container', 'caption_container', 'summarize_container'].map(id => 'id:' + id);

const DEFAULTS = {
    on: false, hideTop: [], foldMenu: true, menuFolded: [...MENU_DEFAULT], menuOpen: false, hideWand: [],
    foldExt: true, extFolded: [...EXT_DEFAULT], extOpen: false, foldExtras: true, extSeen: [],
    foldUser: true, userFolded: USER_PARTS.map(p => p.key), userOpen: {}, regexFit: true,
};
const strList = (v, d) => [...new Set((Array.isArray(v) ? v : d).filter(x => typeof x === 'string' && x && x.length < 300))].slice(0, 500);
export function normalizeTidy(v) {
    const d = v && typeof v === 'object' ? v : {};
    const out = {};
    for (const k of ['on', 'foldMenu', 'menuOpen', 'foldExt', 'extOpen', 'foldExtras', 'foldUser', 'regexFit']) out[k] = typeof d[k] === 'boolean' ? d[k] : DEFAULTS[k];
    for (const k of ['hideTop', 'menuFolded', 'hideWand', 'extFolded', 'extSeen']) out[k] = strList(d[k], DEFAULTS[k]);
    out.hideTop = out.hideTop.filter(k => k !== TOP_KEEP);
    out.userFolded = USER_PARTS.map(p => p.key).filter(k => (Array.isArray(d.userFolded) ? d.userFolded : DEFAULTS.userFolded).includes(k));
    out.userOpen = Object.fromEntries(USER_PARTS.map(p => [p.key, d.userOpen?.[p.key] === true]));
    return out;
}
// 砚台界面整理里已经选好的，搬过来（它存在 extensionSettings.yantaiInterface；名字对得上的才搬）
export function fromYantai(yt, mine) {
    if (!yt || typeof yt !== 'object') return null;
    const userMap = { theme: 'theme', character: 'character', misc: 'misc', chat: 'chat', script: 'script' };
    return normalizeTidy({
        ...mine,
        hideTop: yt.hiddenTop ?? mine.hideTop,
        foldMenu: yt.foldMenu ?? mine.foldMenu, menuFolded: yt.foldedTools ?? mine.menuFolded,
        hideWand: yt.hiddenWand ?? mine.hideWand,
        foldExt: yt.foldExtensions ?? mine.foldExt, extFolded: yt.foldedExtensions ?? mine.extFolded, foldExtras: yt.foldExtras ?? mine.foldExtras,
        extSeen: [...(mine.extSeen || []), ...(yt.extensionOrder || [])],
        foldUser: yt.foldUserSettings ?? mine.foldUser,
        userFolded: Array.isArray(yt.foldedUserSections) ? yt.foldedUserSections.map(k => userMap[k]).filter(Boolean) : mine.userFolded,
    });
}
// 认东西用的名字：有 id 用 id，没有就用「在哪 + 显示的字」（和砚台同一种认法，搬过来的选择才对得上）
const squash = s => String(s || '').replace(/\s+/g, ' ').trim().slice(0, 180);
export function keyOf(el, label, where) {
    if (el.id) return 'id:' + el.id;
    const i18n = el.getAttribute('data-i18n') || el.querySelector('[data-i18n]')?.getAttribute('data-i18n');
    return where + ':' + (i18n || label);
}
const uniq = list => { const n = new Map(); return list.map(x => { const c = (n.get(x.key) || 0) + 1; n.set(x.key, c); return c > 1 ? { ...x, key: x.key + ':' + c } : x; }); };
export function extKind(el, label) {
    if (SYSTEM_EXT.includes(el.id)) return 'system';
    if (/^酒馆助手|^Tavern\s*Helper\b/i.test(label) || /^(TH-settings|tavern[-_]helper[-_]settings|js[-_]slash[-_]runner[-_]settings)$/i.test(el.id)) return 'helper';
    return 'other';
}
export function extRank(item, seen) {
    if (item.mine) return 1; // 咱们自己的面板一直在最上面
    const k = extKind(item.el, item.label);
    if (k === 'system') return 2000 + SYSTEM_EXT.indexOf(item.el.id);
    if (k === 'helper') return 3000;
    const i = seen.indexOf(item.key);
    return 4000 + (i < 0 ? 500 : i);
}

const CSS = `
.tvrm-tidy-gone{display:none!important}
.tvrm-tidy-slim{flex:0 0 0!important;width:0!important;min-width:0!important;margin-inline:0!important;padding-inline:0!important}
#options .tvrm-tidy-more{border-top:1px solid var(--SmartThemeBorderColor,#7775);margin-top:4px;padding-top:4px}
#options .tvrm-tidy-more-list{display:flex;flex-direction:column}
#options .tvrm-tidy-more-list[hidden]{display:none!important}
.tvrm-tidy-fold{font:inherit;color:var(--SmartThemeBodyColor,inherit);display:flex;align-items:center;justify-content:space-between;gap:10px;width:100%;box-sizing:border-box;padding:10px 12px;margin:6px 0 10px;cursor:pointer;text-align:left;background:color-mix(in srgb,var(--SmartThemeBodyColor,#888) 6%,transparent);border:1px solid var(--SmartThemeBorderColor,#7775);border-radius:9px}
.tvrm-tidy-fold>span:first-child{display:flex;flex-direction:column;gap:3px;min-width:0}
.tvrm-tidy-fold small{opacity:.7;font-size:.8em}
.tvrm-tidy-fold[hidden]{display:none!important}
.tvrm-tidy-col>.tvrm-tidy-row{flex:0 0 auto!important;width:100%!important;max-width:100%!important;min-width:0!important;margin-inline:0!important}
@media (max-width:600px),(pointer:coarse) and (max-width:1200px){
 .tvrm-tidy-regex #regex_container{max-width:100%;overflow-x:hidden;box-sizing:border-box}
 .tvrm-tidy-regex #regex_container :where(input,select,textarea){max-width:100%;min-width:0;box-sizing:border-box}
 .tvrm-tidy-regex #regex_container :where(.regex-script-label){flex-wrap:nowrap;min-width:0}
 .tvrm-tidy-regex #regex_container :where(.regex-script-label>.regex_script_name){flex:1 1 0%;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
}`;

export function createTidy(host) {
    const doc = host.document;
    const ctx = () => host.getContext();
    const toast = (k, m) => host.toast?.(k, m);
    const $ = id => doc.getElementById(id);
    function store() {
        const c = ctx();
        const s = normalizeTidy(c.extensionSettings[TIDY]);
        c.extensionSettings[TIDY] = s;
        return s;
    }
    let s = null;
    const S = () => (s ??= store());
    const save = () => { ctx().extensionSettings[TIDY] = s; ctx().saveSettingsDebounced?.(); };
    let rerender = null; let dead = false; let queued = false;
    let style = null;

    // —— 记账：加过的 class、改过的行内样式、挪过的菜单项、插进去的东西，还原时一样样退回去 ——
    const classes = new Map(); // 元素 → Set(class)
    const styles = new Map(); // 元素 → Map(属性 → [原值, 原优先级])
    const moved = []; // [元素, 原位置占位]
    const added = new Set(); // 咱们插进页面的元素（更多工具、折叠头……）
    const bare = new Map(); // 元素 → 原来有没有 class / style 属性（没有的，退回去时把空属性也去掉）
    const note = (el, attr) => { if (!bare.has(el)) bare.set(el, {}); bare.get(el)[attr] ??= !el.hasAttribute(attr); };
    function addClass(el, c) { if (!el) return; note(el, 'class'); if (!classes.has(el)) classes.set(el, new Set()); if (!el.classList.contains(c)) { el.classList.add(c); classes.get(el).add(c); } }
    function setStyle(el, prop, value) {
        if (!el) return;
        note(el, 'style');
        if (!styles.has(el)) styles.set(el, new Map());
        const m = styles.get(el);
        if (!m.has(prop)) m.set(prop, [el.style.getPropertyValue(prop), el.style.getPropertyPriority(prop)]);
        el.style.setProperty(prop, value, 'important');
    }
    function undoAll() {
        for (const [el, set] of classes) for (const c of set) el.classList.remove(c);
        classes.clear();
        for (const [el, m] of styles) for (const [prop, [v, p]] of m) { if (v) el.style.setProperty(prop, v, p); else el.style.removeProperty(prop); }
        styles.clear();
        for (const [el, was] of bare) for (const attr of ['class', 'style']) if (was[attr] && !el.getAttribute(attr)?.trim()) el.removeAttribute(attr);
        bare.clear();
        for (const [el, mark] of moved.splice(0)) { if (mark.isConnected) mark.replaceWith(el); else mark.remove(); }
        for (const el of added) el.remove();
        added.clear();
    }

    // 砚台界面整理还开着就先不动，两边一起改同一块会打架
    const yantaiOn = () => !!$('yt-interface-active-style');

    // —— 读：现在页面上有哪些东西 ——
    function topItems() {
        const root = $('top-settings-holder'); if (!root) return [];
        return [...root.children].flatMap((el, i) => {
            const toggle = el.querySelector(':scope > .drawer-toggle') || (el.matches('.drawer-toggle,button') ? el : null);
            if (!toggle) return [];
            const label = TOP_NAMES[el.id] || toggle.title || toggle.querySelector('[title]')?.title || el.getAttribute('aria-label') || '别的按钮 ' + (i + 1);
            return [{ key: el.id || 'extra:' + (toggle.id || label), label, el, toggle }];
        });
    }
    function menuItems() {
        const box = doc.querySelector('#options .options-content'); if (!box) return [];
        const seen = new Set(); const list = [];
        for (const a of box.querySelectorAll('a[id]')) { // 已经收进「更多工具」的也列出来
            if (seen.has(a.id)) continue;
            seen.add(a.id);
            list.push({ key: a.id, label: squash(a.querySelector('span')?.textContent || a.textContent) || a.id });
        }
        return list;
    }
    function wandItems() {
        const root = $('extensionsMenu'); if (!root) return [];
        const list = [];
        for (const outer of root.children) {
            if (outer.matches('script,style,hr,input,textarea,select')) continue;
            const rows = outer.classList.contains('extension_container') ? [...outer.children] : [outer];
            for (const el of rows) {
                if (el.matches('script,style,hr,input,textarea,select') || !el.textContent.trim()) continue;
                if (el.querySelector('input,textarea,select') && !el.matches('a,button,[role="menuitem"],.list-group-item')) continue;
                const label = squash(el.querySelector('span')?.textContent || el.textContent || el.title);
                if (label) list.push({ key: keyOf(el, label, outer.id || 'wand'), label, el, wrap: outer });
            }
        }
        return uniq(list);
    }
    function extItems() {
        const list = [];
        for (const id of ['extensions_settings', 'extensions_settings2']) {
            const root = $(id); if (!root) continue;
            for (const el of root.children) {
                if (el.matches('script,style,link,template') || added.has(el)) continue;
                const heads = [...el.querySelectorAll('.inline-drawer-header')];
                if (el.matches('.inline-drawer-header')) heads.unshift(el);
                if (!heads.length) continue; // 认不出来的布局不碰
                const label = [...new Set(heads.map(h => squash(h.querySelector('b,strong')?.textContent || h.textContent)).filter(Boolean))].join(' / ');
                if (label) list.push({ key: keyOf(el, label, id), label, el, mine: el.id === 'tvrm-drawer' || !!el.querySelector('#tvrm-drawer') });
            }
        }
        return uniq(list);
    }

    // —— 做：按设置把页面整理好（每次先全部退回去再重新整理，不会越叠越多） ——
    function fold(label, tip, open, onClick) {
        const b = doc.createElement('button'); b.type = 'button'; b.className = 'tvrm-tidy-fold';
        const t = doc.createElement('span'); const strong = doc.createElement('strong'); strong.textContent = label; t.append(strong);
        if (tip) { const sm = doc.createElement('small'); sm.textContent = tip; t.append(sm); }
        const arrow = doc.createElement('span'); arrow.textContent = open ? '▴' : '▾';
        b.append(t, arrow);
        b.addEventListener('click', e => { e.preventDefault(); e.stopImmediatePropagation(); onClick(); });
        added.add(b);
        return b;
    }
    function applyTop() {
        const items = topItems(); const hide = new Set(S().hideTop);
        for (const it of items) if (hide.has(it.key) && it.key !== TOP_KEEP) { addClass(it.toggle, 'tvrm-tidy-gone'); if (it.el !== it.toggle) addClass(it.el, 'tvrm-tidy-slim'); }
    }
    function applyMenu() {
        const box = doc.querySelector('#options .options-content'); if (!box || !S().foldMenu) return;
        const pick = new Set(S().menuFolded);
        const els = [...box.querySelectorAll(':scope > a[id]')].filter(a => pick.has(a.id));
        if (!els.length) return;
        const more = doc.createElement('div'); more.className = 'tvrm-tidy-more';
        const head = doc.createElement('a'); head.className = 'interactable'; head.setAttribute('role', 'button'); head.tabIndex = 0;
        const icon = doc.createElement('i'); icon.className = 'fa-lg fa-solid fa-ellipsis';
        const word = doc.createElement('span'); word.textContent = S().menuOpen ? '收起 ▴' : '更多工具 ▾';
        head.append(icon, word);
        const list = doc.createElement('div'); list.className = 'tvrm-tidy-more-list'; list.hidden = !S().menuOpen;
        head.addEventListener('click', e => { e.preventDefault(); e.stopImmediatePropagation(); S().menuOpen = !S().menuOpen; save(); list.hidden = !S().menuOpen; word.textContent = S().menuOpen ? '收起 ▴' : '更多工具 ▾'; });
        more.append(head, list); box.append(more); added.add(more);
        for (const a of els) { const mark = doc.createComment('tvrm-tidy'); a.before(mark); moved.push([a, mark]); list.append(a); }
    }
    function applyWand() {
        const items = wandItems(); const hide = new Set(S().hideWand);
        for (const it of items) if (hide.has(it.key)) addClass(it.el, 'tvrm-tidy-gone');
        // 一组里全藏了，组本身（带分隔的空盒子）也藏
        for (const wrap of new Set(items.map(i => i.wrap))) {
            if (!wrap.classList.contains('extension_container')) continue;
            const mine = items.filter(i => i.wrap === wrap);
            const other = [...wrap.children].some(e => !e.matches('script,style,hr') && !mine.some(i => i.el === e));
            if (mine.length && !other && mine.every(i => hide.has(i.key))) addClass(wrap, 'tvrm-tidy-gone');
        }
    }
    function extrasRows(parent, roots) {
        const direct = el => { while (el && el.parentElement !== parent) el = el.parentElement; return el && !roots.includes(el) ? el : null; };
        const conn = direct($('extensions_url')), head = direct($('extensions_status'));
        if (!conn || !head) return [];
        const rows = new Set([conn, head]);
        if (head.previousElementSibling?.tagName === 'HR') rows.add(head.previousElementSibling);
        return [...parent.children].filter(e => rows.has(e)); // 按页面上原来的先后
    }
    function applyExt() {
        const roots = ['extensions_settings', 'extensions_settings2'].map($).filter(Boolean);
        const parent = roots[0]?.parentElement;
        if (!S().foldExt || !parent || !roots.every(r => r.parentElement === parent)) return;
        const items = extItems();
        // 第一次见到的别的插件记下顺序，以后一直按这个排（加载快慢不影响）
        let grew = false;
        for (const it of items) if (!it.mine && extKind(it.el, it.label) === 'other' && !S().extSeen.includes(it.key)) { S().extSeen.push(it.key); grew = true; }
        if (grew) save();
        // 两列摊成一列：父元素竖排，两列 display:contents；主题常用更高优先级的规则改这两列，所以写在行内
        addClass(parent, 'tvrm-tidy-col-parent');
        setStyle(parent, 'display', 'flex'); setStyle(parent, 'flex-direction', 'column'); setStyle(parent, 'align-items', 'stretch');
        let after = false;
        for (const el of parent.children) {
            if (roots.includes(el)) { after = true; continue; }
            setStyle(el, 'order', after ? '9000' : '0'); setStyle(el, 'width', '100%');
        }
        for (const r of roots) { addClass(r, 'tvrm-tidy-col'); setStyle(r, 'display', 'contents'); }
        for (const it of items) { addClass(it.el, 'tvrm-tidy-row'); setStyle(it.el, 'order', String(extRank(it, S().extSeen))); }
        for (const r of roots) for (const el of r.children) if (el.classList.contains('extension_container') && !el.children.length && !el.textContent.trim()) addClass(el, 'tvrm-tidy-gone');
        // 收进「更多扩展设置」的：自己的面板不能收
        const folded = items.filter(it => !it.mine && S().extFolded.includes(it.key));
        const extras = S().foldExtras ? extrasRows(parent, roots) : [];
        const n = folded.length + (extras.length ? 1 : 0);
        if (!n) return;
        const open = S().extOpen;
        const head = fold(`更多扩展设置（${n}）`, '不常用的都在这里', open, () => { S().extOpen = !S().extOpen; save(); apply(); });
        head.classList.add('tvrm-tidy-row'); roots[0].prepend(head); setStyle(head, 'order', '100');
        folded.forEach((it, i) => { setStyle(it.el, 'order', String(200 + i)); if (!open) addClass(it.el, 'tvrm-tidy-gone'); });
        extras.forEach((el, i) => { setStyle(el, 'order', String(1000 + i)); if (!open) addClass(el, 'tvrm-tidy-gone'); });
    }
    let search = null;
    function applyUser() {
        const box = $('settingsSearch');
        if (box !== search) { search?.removeEventListener('input', schedule); search = box; search?.addEventListener('input', schedule); }
        if (!S().foldUser || box?.value.trim()) return; // 在搜设置的时候全部摊开
        for (const p of USER_PARTS) {
            if (!S().userFolded.includes(p.key)) continue;
            const root = doc.querySelector(p.sel); if (!root) continue;
            const open = !!S().userOpen[p.key];
            const kids = [...root.children];
            root.prepend(fold(p.name, p.tip, open, () => { S().userOpen[p.key] = !S().userOpen[p.key]; save(); apply(); }));
            if (!open) for (const k of kids) addClass(k, 'tvrm-tidy-gone');
        }
    }
    function apply() {
        if (dead) return;
        pause();
        undoAll();
        if (S().on && !yantaiOn()) {
            for (const f of [applyTop, applyMenu, applyWand, applyExt, applyUser]) {
                try { f(); } catch (e) { console.warn('[酒馆你害我不浅] 界面整理出错', e); }
            }
            if (S().regexFit) addClass(doc.body, 'tvrm-tidy-regex');
        }
        watch();
    }

    // —— 盯着这几块：别的插件后加进来按钮、扩展、魔法棒入口时重新整理（只看增删，不看聊天） ——
    const observers = [];
    function pause() { for (const o of observers) o.disconnect(); observers.length = 0; }
    function watch() {
        const Obs = doc.defaultView?.MutationObserver; if (!Obs) return;
        const targets = [$('top-settings-holder'), $('extensionsMenu'), $('extensions_settings'), $('extensions_settings2'), doc.querySelector('#options .options-content'),
            ...USER_PARTS.map(p => doc.querySelector(p.sel))].filter(Boolean);
        for (const t of targets) {
            const o = new Obs(recs => { if (recs.some(r => [...r.addedNodes, ...r.removedNodes].some(n => n.nodeType === 1 && !added.has(n) && !moved.some(m => m[0] === n)))) schedule(); });
            o.observe(t, { childList: true, subtree: t.id === 'extensionsMenu' });
            observers.push(o);
        }
    }
    function schedule() {
        if (queued || dead) return; queued = true;
        queueMicrotask(() => { queued = false; apply(); rerender?.(); });
    }

    function init() {
        style = doc.createElement('style'); style.id = 'tvrm-tidy-style'; style.textContent = CSS; doc.head.append(style);
        // 魔法棒、扩展菜单是点开时才填的，点它们的时候再看一眼
        doc.addEventListener('click', e => { if (e.target.closest?.('#extensionsMenuButton,#extensions-settings-button > .drawer-toggle,#user-settings-button > .drawer-toggle,#options_button')) schedule(); }, true);
        host.on?.('APP_READY', schedule);
        apply();
    }
    function restore() {
        Object.assign(S(), { on: false, hideTop: [], hideWand: [] });
        save(); apply(); rerender?.();
        toast('success', '界面恢复原样了');
    }

    // —— 面板 ——
    function h(tag, attrs, ...kids) {
        const el = doc.createElement(tag);
        for (const [k, v] of Object.entries(attrs || {})) {
            if (v === undefined || v === null || v === false) continue;
            if (k === 'class') el.className = v; else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
            else if (k === 'checked') el.checked = !!v; else if (k === 'open') el.open = !!v; else el.setAttribute(k, v === true ? '' : v);
        }
        for (const kid of kids.flat(Infinity)) if (kid !== null && kid !== undefined && kid !== false) el.append(kid.nodeType ? kid : String(kid));
        return el;
    }
    const btn = (text, onclick, cls = '') => h('button', { type: 'button', class: 'menu_button ' + cls, onclick }, text);
    function check(label, on, onChange, tip, disabled) {
        const box = h('input', { type: 'checkbox', checked: on, disabled }); box.checked = on;
        box.addEventListener('change', () => onChange(box.checked));
        return h('label', { class: 'checkbox_label tvrm-tidy-check' + (disabled ? ' is-disabled' : '') }, box, h('span', null, label, tip ? h('small', null, tip) : null));
    }
    const change = fn => { fn(S()); save(); apply(); rerender?.(); };
    const flip = (list, key, yes) => { const set = new Set(list); yes ? set.add(key) : set.delete(key); return [...set]; };
    const openParts = new Set();
    function part(key, title, sub, ...body) {
        const d = h('details', { class: 'tvrm-card tvrm-tidy-part', open: openParts.has(key) },
            h('summary', null, h('div', { class: 'tvrm-card-head' }, h('div', { class: 'tvrm-card-title' }, h('b', null, title), h('small', null, sub)))),
            h('div', { class: 'tvrm-card-body' }, body));
        d.addEventListener('toggle', () => { d.open ? openParts.add(key) : openParts.delete(key); });
        return d;
    }
    function render(box) {
        rerender = () => { if (box.isConnected) render(box); };
        const st = S();
        const scroll = box.scrollTop;
        const kids = [];
        kids.push(h('p', { class: 'tvrm-note' }, '把不常用的按钮和设置收起来。只是藏起来，插件照常运行；要停用插件去「管理扩展」。'));
        if (yantaiOn()) kids.push(h('p', { class: 'tvrm-tidy-warn' }, '砚台 · 界面整理还开着。两个一起会抢着改同一块界面，所以这里先不动。去「管理扩展」里停用它、刷新酒馆，这里就会生效。'));
        kids.push(check('开启界面整理', st.on, v => change(x => { x.on = v; })));
        const yt = ctx().extensionSettings?.yantaiInterface;
        kids.push(h('div', { class: 'tvrm-actions' },
            btn('恢复原界面', async () => { if (await host.confirm?.('把藏起来的按钮全部放出来，关掉界面整理？') !== false) restore(); }),
            btn('重新认一遍', () => { apply(); rerender?.(); toast('success', '重新看过了'); }),
            yt ? btn('搬砚台里的选择', async () => {
                if (await host.confirm?.('把砚台 · 界面整理里选好的（藏哪些按钮、收哪些扩展）搬过来，覆盖这里现在的选择？') === false) return;
                const next = fromYantai(yt, st); if (next) { s = { ...next, on: st.on }; save(); apply(); rerender?.(); toast('success', '搬过来了'); }
            }) : null));

        const tops = topItems();
        const hide = new Set(st.hideTop);
        kids.push(part('top', '顶部按钮', `最上面那排图标 · 藏了 ${tops.filter(t => hide.has(t.key)).length} 个`,
            h('p', { class: 'tvrm-note' }, '勾着＝显示，去掉勾＝藏起来。「扩展」一直留着，不然回不到这里。'),
            tops.length ? h('div', { class: 'tvrm-tidy-grid' }, tops.map(t => check(t.label, !hide.has(t.key), v => change(x => { x.hideTop = flip(x.hideTop, t.key, !v); }), null, t.key === TOP_KEEP))) : h('p', { class: 'tvrm-note' }, '没找到顶栏，可能主题换了结构。'),
            btn('全部显示', () => change(x => { x.hideTop = []; }))));

        const menu = menuItems();
        kids.push(part('menu', '三横菜单', '输入框左边三条横线 · 勾上的收进「更多工具」',
            check('收起不常用的', st.foldMenu, v => change(x => { x.foldMenu = v; })),
            menu.length ? h('div', { class: 'tvrm-tidy-grid' }, menu.map(m => check(m.label, st.menuFolded.includes(m.key), v => change(x => { x.menuFolded = flip(x.menuFolded, m.key, v); })))) : h('p', { class: 'tvrm-note' }, '没找到三横菜单。')));

        const wand = wandItems();
        const whide = new Set(st.hideWand);
        kids.push(part('wand', '魔法棒', `输入框左边的魔法棒 · 认出 ${wand.length} 个入口`,
            h('p', { class: 'tvrm-note' }, '勾着＝显示，去掉勾＝藏起来。别的插件塞进去的也在这里。'),
            wand.length ? h('div', { class: 'tvrm-tidy-grid' }, wand.map(w => check(w.label, !whide.has(w.key), v => change(x => { x.hideWand = flip(x.hideWand, w.key, !v); })))) : h('p', { class: 'tvrm-note' }, '还没认出来。先点开一次魔法棒，再点上面「重新认一遍」。'),
            btn('全部显示', () => change(x => { x.hideWand = []; }))));

        const exts = extItems().filter(e => !e.mine);
        kids.push(part('ext', '扩展页', `排成一列 · 收了 ${exts.filter(e => st.extFolded.includes(e.key)).length} 个`,
            check('扩展页整理成一列', st.foldExt, v => change(x => { x.foldExt = v; }), '顺序：更多扩展设置 → 酒馆自带 → 酒馆助手 → 别的插件（按第一次见到的顺序）'),
            $('extensions_url') ? check('旧的 Extras API 也收起来', st.foldExtras, v => change(x => { x.foldExtras = v; }), '酒馆已经不用它了') : null,
            h('p', { class: 'tvrm-note' }, '勾上＝收进「更多扩展设置」。咱们自己这个面板一直在最上面。'),
            exts.length ? h('div', { class: 'tvrm-tidy-list' }, exts.map(e => check(e.label, st.extFolded.includes(e.key), v => change(x => { x.extFolded = flip(x.extFolded, e.key, v); })))) : h('p', { class: 'tvrm-note' }, '还没认出来。'),
            h('div', { class: 'tvrm-actions' }, btn('全部放外面', () => change(x => { x.extFolded = []; })), btn('用建议的', () => change(x => { x.extFolded = [...EXT_DEFAULT]; x.extOpen = false; })))));

        kids.push(part('user', '用户设置', '很长的几段折起来，搜设置时自动摊开',
            check('折起来', st.foldUser, v => change(x => { x.foldUser = v; })),
            USER_PARTS.filter(p => doc.querySelector(p.sel)).map(p => check(p.name, st.userFolded.includes(p.key), v => change(x => { x.userFolded = flip(x.userFolded, p.key, v); }), p.tip))));

        kids.push(part('regex', '手机上的正则', '正则编辑不撑出屏幕',
            check('手机上正则不撑出屏幕', st.regexFit, v => change(x => { x.regexFit = v; }), '名字太长显示省略号，按钮留在同一行')));

        box.replaceChildren(...kids);
        box.scrollTop = scroll;
    }

    return { init, apply, render, restore, settings: S, destroy() { dead = true; pause(); undoAll(); style?.remove(); } };
}

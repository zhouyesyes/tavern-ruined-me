// 界面格：把酒馆里不常用的按钮和设置收起来（照「砚台 · 界面整理」的功能自己重写，没有复制它的代码）。
// 只加 / 去掉咱们自己的 class、自己插的折叠头，和扩展页上记得住原值的几条行内样式；关掉或「恢复原界面」就全部还原。
// 藏起来只是看不见，插件照常运行。聊天内容一概不看。
// host: document, getContext(), toast(kind,msg), confirm(text), on(eventName, fn)

export const TIDY = 'tavern_ruined_me_tidy';

// 顶栏图标的名字：先用页面上图标自己的提示字（酒馆按你选的语言翻译好的），没有才用这里（酒馆官方中文翻译）
export const TOP_NAMES = {
    'ai-config-button': 'AI 响应配置', 'sys-settings-button': 'API 连接', 'advanced-formatting-button': 'AI 回复格式化',
    'WI-SP-button': '世界书', 'user-settings-button': '用户设置', 'backgrounds-button': '更改背景图片',
    'extensions-settings-button': '扩展程序', 'persona-management-button': '用户设定管理', 'rightNavHolder': '角色管理',
};
// 选项菜单（☰）默认收进 ⋯ 的
export const MENU_DEFAULT = ['option_toggle_AN', 'option_toggle_CFG', 'option_toggle_logprobs', 'option_convert_to_group', 'option_impersonate'];
// 用户设置里能折起来的几段（选择器是酒馆 index.html 里的结构）
export const USER_PARTS = [
// 名字用酒馆官方中文翻译里这几段的标题
    { key: 'theme', sel: '#UI-Theme-Block > [name="themeElements"]', name: 'UI 主题' },
    { key: 'character', sel: '#UI-Customization > [name="CharacterHandlingToggles"]', name: '角色处理' },
    { key: 'misc', sel: '#UI-Customization > [name="MiscellaneousToggles"]', name: '杂项' },
    { key: 'chat', sel: '#power-user-option-checkboxes > [name="ChatMessageHandlingToggles"]', name: '聊天/消息处理' },
    { key: 'script', sel: '#power-user-option-checkboxes > [name="STscriptToggles"]', name: 'ST脚本设置' },
];
// 扩展页：酒馆自带的扩展（排在前面），其次酒馆助手，再其次别的插件按第一次见到的顺序
export const SYSTEM_EXT = ['regex_container', 'vectors_container', 'assets_container', 'typing_indicator_container', 'expressions_container', 'sd_container', 'tts_container',
    'rvc_container', 'stt_container', 'audio_container', 'silence_container', 'objective_container', 'blip_container', 'live2d_container', 'vrm_container',
    'timelines_container', 'webllm_container', 'rss_container', 'websearch_container', 'emulatorjs_container', 'qr_container', 'translation_container',
    'caption_container', 'idle_container', 'summarize_container', 'hypebot_container', 'randomizer_container', 'chromadb_container', 'message_limit_container',
    'injects_container', 'accuweather_container', 'dice_container'];
export const EXT_DEFAULT = ['assets_container', 'expressions_container', 'sd_container', 'tts_container', 'qr_container', 'translation_container', 'caption_container', 'summarize_container'].map(id => 'id:' + id);

const DEFAULTS = {
    on: false, hideTop: [], topOpen: false, foldMenu: true, menuFolded: [...MENU_DEFAULT], menuOpen: false, hideWand: [], wandOpen: false,
    foldExt: true, extFolded: [...EXT_DEFAULT], extOpen: false, foldExtras: true, extSeen: [],
    foldUser: true, userFolded: USER_PARTS.map(p => p.key), userOpen: {}, regexFit: true, smooth: false,
};
const strList = (v, d) => [...new Set((Array.isArray(v) ? v : d).filter(x => typeof x === 'string' && x && x.length < 300))].slice(0, 500);
export function normalizeTidy(v) {
    const d = v && typeof v === 'object' ? v : {};
    const out = {};
    for (const k of ['on', 'topOpen', 'foldMenu', 'menuOpen', 'wandOpen', 'foldExt', 'extOpen', 'foldExtras', 'foldUser', 'regexFit', 'smooth']) out[k] = typeof d[k] === 'boolean' ? d[k] : DEFAULTS[k];
    for (const k of ['hideTop', 'menuFolded', 'hideWand', 'extFolded', 'extSeen']) out[k] = strList(d[k], DEFAULTS[k]);
    out.userFolded = USER_PARTS.map(p => p.key).filter(k => (Array.isArray(d.userFolded) ? d.userFolded : DEFAULTS.userFolded).includes(k));
    out.userOpen = Object.fromEntries(USER_PARTS.map(p => [p.key, d.userOpen?.[p.key] === true]));
    return out;
}
// 认东西用的名字：有 id 用 id，没有就用「在哪 + 显示的字」
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
.tvrm-tidy-more{border-top:1px solid var(--SmartThemeBorderColor,#7775);margin-top:4px;padding-top:2px}
.tvrm-tidy-dots{display:flex!important;justify-content:center;align-items:center;width:100%;box-sizing:border-box;cursor:pointer;padding:6px 0!important;margin:0!important;opacity:.7;border-radius:6px;color:inherit}
.tvrm-tidy-dots.is-open{opacity:1;background:color-mix(in srgb,var(--SmartThemeBodyColor,#888) 8%,transparent)}
.tvrm-tidy-more-list{display:flex;flex-direction:column;font-size:.88em}
.tvrm-tidy-more-list[hidden]{display:none!important}
.tvrm-tidy-topmore{display:flex;align-items:center;cursor:pointer}
.tvrm-tidy-topmore .drawer-icon{transition:transform .2s}
.tvrm-tidy-topmore.is-open .drawer-icon{transform:scaleX(-1)}
@keyframes tvrm-tidy-left{from{opacity:0;transform:translateX(10px)}to{opacity:1;transform:none}}
.tvrm-tidy-left{animation:tvrm-tidy-left .22s ease-out}
.tvrm-tidy-fold{font:inherit;color:var(--SmartThemeBodyColor,inherit);display:flex;align-items:center;justify-content:space-between;gap:10px;width:100%;box-sizing:border-box;padding:10px 12px;margin:6px 0 10px;cursor:pointer;text-align:left;background:color-mix(in srgb,var(--SmartThemeBodyColor,#888) 6%,transparent);border:1px solid var(--SmartThemeBorderColor,#7775);border-radius:9px}
.tvrm-tidy-fold>span:first-child{display:flex;flex-direction:column;gap:3px;min-width:0}
.tvrm-tidy-fold small{opacity:.7;font-size:.8em}
.tvrm-tidy-fold[hidden]{display:none!important}
.tvrm-tidy-more-head.is-open{border-bottom-left-radius:2px}
.tvrm-tidy-extbox{display:flex;flex-direction:column;width:100%}
.tvrm-tidy-extbody{display:block;margin-left:14px;padding-left:6px;border-left:2px solid var(--SmartThemeBorderColor,#7775);box-sizing:border-box}
.tvrm-tidy-sub{font-size:.92em;width:100%;box-sizing:border-box}
.tvrm-tidy-sub .inline-drawer-header{background:color-mix(in srgb,var(--SmartThemeBodyColor,#888) 4%,transparent)!important;border-color:color-mix(in srgb,var(--SmartThemeBorderColor,#7775) 55%,transparent)!important;padding-block:5px!important;min-height:0!important}
.tvrm-tidy-more-tail{font:inherit;font-size:.85em;color:var(--SmartThemeBodyColor,inherit);opacity:.75;cursor:pointer;background:none;border:0;text-align:left;padding:6px 4px;margin:0 0 10px;box-sizing:border-box}
@keyframes tvrm-tidy-in{from{opacity:0;transform:translateY(-6px)}to{opacity:1;transform:none}}
@keyframes tvrm-tidy-out{from{opacity:1;transform:none}to{opacity:0;transform:translateY(-6px)}}
.tvrm-tidy-in{animation:tvrm-tidy-in .24s ease-out}
.tvrm-tidy-out{animation:tvrm-tidy-out .16s ease-in forwards}
@media (prefers-reduced-motion:reduce){.tvrm-tidy-in,.tvrm-tidy-out,.tvrm-tidy-left{animation:none}}
.tvrm-tidy-col>.tvrm-tidy-row{flex:0 0 auto!important;width:100%!important;max-width:100%!important;min-width:0!important;margin-inline:0!important}
/* 滑动更顺（试验）：聊天区单独一层（滑的时候直接挪这一层，不用每次重画）；每条消息各算各的（一条变了不牵动整个聊天） */
.tvrm-tidy-smooth #chat{will-change:transform;-webkit-overflow-scrolling:touch;overscroll-behavior-y:contain}
.tvrm-tidy-smooth #chat>.mes{contain:layout style}
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
    const added = new Set(); // 咱们插进页面的元素（⋯ 折叠、折叠头……）
    const wandMeta = new WeakMap(); // 收进 ⋯ 的扩展菜单项、收进盒子的扩展程序 → 收之前的名字和认法
    const dotsToggle = new WeakMap(); // ⋯ → 点它做什么
    const bare = new Map(); // 元素 → 原来有没有 class / style 属性（没有的，退回去时把空属性也去掉）
    const note = (el, attr) => { if (!bare.has(el)) bare.set(el, {}); bare.get(el)[attr] ??= !el.hasAttribute(attr); };
    function addClass(el, c) { if (!el) return; note(el, 'class'); if (!classes.has(el)) classes.set(el, new Set()); if (!el.classList.contains(c)) { el.classList.add(c); classes.get(el).add(c); } }
    function dropClass(el, c) { el.classList.remove(c); classes.get(el)?.delete(c); }
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
    // 现在页面上看得到吗：酒馆自己藏着的（displayNone、只在某些聊天里才出现的）、主题藏掉的都不算；咱们自己藏的算看得到
    const shown = el => el.classList.contains('tvrm-tidy-gone') || doc.defaultView?.getComputedStyle?.(el)?.display !== 'none';
    function topItems() {
        const root = $('top-settings-holder'); if (!root) return [];
        return [...root.children].flatMap((el, i) => {
            if (added.has(el)) return [];
            const toggle = el.querySelector(':scope > .drawer-toggle') || (el.matches('.drawer-toggle,button') ? el : null);
            if (!toggle) return [];
            const label = squash(toggle.title || toggle.querySelector('[title]')?.title || el.getAttribute('aria-label')) || TOP_NAMES[el.id] || '别的图标 ' + (i + 1);
            return [{ key: el.id || 'extra:' + (toggle.id || label), label, el, toggle, on: shown(el) && shown(toggle) }];
        });
    }
    function menuItems() {
        const box = doc.querySelector('#options .options-content'); if (!box) return [];
        const seen = new Set(); const list = [];
        for (const a of box.querySelectorAll('a[id]')) { // 已经收进 ⋯ 的也列出来
            if (seen.has(a.id)) continue;
            // 同一个 id 酒馆里可能有两个（关闭聊天就是一个藏着一个露着），有一个看得到就算
            const same = [...box.querySelectorAll('a[id]')].filter(x => x.id === a.id);
            seen.add(a.id);
            list.push({ key: a.id, label: squash(a.querySelector('span')?.textContent || a.textContent) || a.id, on: same.some(shown) });
        }
        return list;
    }
    function wandItems() {
        const root = $('extensionsMenu'); if (!root) return [];
        const list = [];
        for (const outer of root.children) {
            if (added.has(outer)) continue;
            if (outer.matches('script,style,hr,input,textarea,select')) continue;
            const rows = outer.classList.contains('extension_container') ? [...outer.children] : [outer];
            for (const el of rows) {
                if (el.matches('script,style,hr,input,textarea,select') || !el.textContent.trim()) continue;
                if (el.querySelector('input,textarea,select') && !el.matches('a,button,[role="menuitem"],.list-group-item')) continue;
                const label = squash(el.querySelector('span')?.textContent || el.textContent || el.title);
                if (label) list.push({ key: keyOf(el, label, outer.id || 'wand'), label, el, wrap: outer, on: shown(el) && shown(outer) });
            }
        }
        // 已经收进 ⋯ 的也列出来（名字、认法用收进去之前记下的）
        const out = uniq(list);
        for (const m of moved) if (m[2] === 'wand' && wandMeta.has(m[0])) out.push({ ...wandMeta.get(m[0]), on: true });
        return out;
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
        const out = uniq(list);
        // 已经收进盒子的也列出来（名字、认法用收进去之前记下的）
        for (const m of moved) if (m[2] === 'ext' && wandMeta.has(m[0])) out.push({ ...wandMeta.get(m[0]) });
        return out;
    }

    // —— 做：按设置把页面整理好（每次先全部退回去再重新整理，不会越叠越多） ——
    function fold(label, tip, open, onClick) {
        const b = doc.createElement('button'); b.type = 'button'; b.className = 'tvrm-tidy-fold';
        const t = doc.createElement('span'); const strong = doc.createElement('strong'); strong.textContent = label; t.append(strong);
        if (tip) { const sm = doc.createElement('small'); sm.textContent = tip; t.append(sm); }
        const arrow = doc.createElement('span'); arrow.className = 'tvrm-tidy-arrow'; arrow.textContent = open ? '▾' : '▸';
        b.append(t, arrow);
        b.addEventListener('click', e => { e.preventDefault(); e.stopImmediatePropagation(); onClick(); });
        added.add(b);
        return b;
    }
    // 收进 ⋯：选项菜单（☰）和扩展菜单（魔法棒）共用。挪进最下面一个只有三个点的折叠里，点开字小一号；原位置留个记号，还原时放回去
    function dotsBox(box, els, openKey, kind, tag) {
        const more = doc.createElement('div'); more.className = 'tvrm-tidy-more';
        const head = doc.createElement(tag); head.className = 'interactable tvrm-tidy-dots'; // 两个菜单长一样：不挂主题给菜单项的样式
        head.setAttribute('role', 'button'); head.tabIndex = 0; head.title = '更多';
        const icon = doc.createElement('i'); icon.className = 'fa-lg fa-solid fa-ellipsis';
        head.append(icon);
        const list = doc.createElement('div'); list.className = 'tvrm-tidy-more-list';
        const show = () => { list.hidden = !S()[openKey]; head.classList.toggle('is-open', !!S()[openKey]); };
        // 点击在 init 里最早一步接住（扩展菜单在 TauriTavern 里一点里面任何地方就关，那个判断比这里早）
        dotsToggle.set(head, () => { S()[openKey] = !S()[openKey]; save(); show(); });
        head.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); dotsToggle.get(head)?.(); } });
        more.append(head, list); box.append(more); added.add(more);
        for (const el of els) { const mark = doc.createComment('tvrm-tidy'); el.before(mark); moved.push([el, mark, kind]); list.append(el); }
        show();
    }
    // 顶栏：勾上的图标收到最右边一个小折叠里，点它往左展开（扩展程序也能收，从这个折叠点开就到）
    function applyTop() {
        const root = $('top-settings-holder'); if (!root) return;
        const hide = new Set(S().hideTop);
        const items = topItems().filter(it => hide.has(it.key));
        if (!items.length) return;
        const fold = doc.createElement('div'); fold.className = 'drawer tvrm-tidy-topmore'; fold.title = '更多'; fold.setAttribute('role', 'button'); fold.tabIndex = 0;
        const icon = doc.createElement('div'); icon.className = 'drawer-icon fa-solid fa-fw fa-angles-left';
        fold.append(icon); root.append(fold); added.add(fold); setStyle(fold, 'order', '9999');
        const show = anim => {
            const open = !!S().topOpen;
            fold.classList.toggle('is-open', open);
            for (const it of items) {
                if (open) { dropClass(it.toggle, 'tvrm-tidy-gone'); dropClass(it.el, 'tvrm-tidy-slim'); if (anim) { addClass(it.el, 'tvrm-tidy-left'); setTimeout(() => dropClass(it.el, 'tvrm-tidy-left'), 260); } }
                else { addClass(it.toggle, 'tvrm-tidy-gone'); if (it.el !== it.toggle) addClass(it.el, 'tvrm-tidy-slim'); }
            }
        };
        for (const it of items) setStyle(it.el, 'order', '9998'); // 收起来的挨着折叠，展开就在它左边
        fold.addEventListener('click', e => { e.preventDefault(); e.stopImmediatePropagation(); S().topOpen = !S().topOpen; save(); show(true); });
        fold.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') fold.click(); });
        show(false);
    }
    function applyMenu() {
        const box = doc.querySelector('#options .options-content'); if (!box || !S().foldMenu) return;
        const pick = new Set(S().menuFolded);
        const els = [...box.querySelectorAll(':scope > a[id]')].filter(a => pick.has(a.id));
        if (els.length) dotsBox(box, els, 'menuOpen', 'menu', 'a');
    }
    function applyWand() {
        const root = $('extensionsMenu'); if (!root) return;
        const items = wandItems(); const pick = new Set(S().hideWand);
        const picked = items.filter(it => pick.has(it.key));
        if (!picked.length) return;
        for (const it of picked) wandMeta.set(it.el, { ...it, moved: true });
        const els = picked.map(it => it.el);
        dotsBox(root, els, 'wandOpen', 'wand', 'div');
        // 一组里全收走了，留下的空盒子也藏起来
        for (const wrap of new Set(items.map(i => i.wrap))) {
            if (wrap.classList.contains('extension_container') && wrap.parentElement === root && ![...wrap.children].some(e => !e.matches('script,style,hr'))) addClass(wrap, 'tvrm-tidy-gone');
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
        // 咱们的面板真的挪到最前面（有的主题 / TauriTavern 里排序不生效，光靠 order 排不动）
        const mine = items.find(it => it.mine)?.el;
        const put = (el, where) => { const mark = doc.createComment('tvrm-tidy'); el.before(mark); moved.push([el, mark, 'ext']); where(el); };
        if (mine && roots[0].firstElementChild !== mine) put(mine, el => roots[0].prepend(el));
        // 收起来的扩展程序：真的挪进一个盒子（标题 + 里面一列 + 底下「收起」），放在咱们面板正下方；自己的面板不能收
        const folded = items.filter(it => !it.mine && S().extFolded.includes(it.key));
        const extras = S().foldExtras ? extrasRows(parent, roots) : [];
        const n = folded.length + (extras.length ? 1 : 0);
        if (!n) return;
        const box = doc.createElement('div'); box.className = 'tvrm-tidy-row tvrm-tidy-extbox'; added.add(box);
        const head = fold(`收起的扩展程序（${n}）`, null, S().extOpen, () => toggleMore());
        head.classList.add('tvrm-tidy-more-head');
        const body = doc.createElement('div'); body.className = 'tvrm-tidy-extbody';
        const tail = doc.createElement('button'); tail.type = 'button'; tail.className = 'tvrm-tidy-more-tail'; tail.textContent = '▴ 收起';
        tail.addEventListener('click', e => { e.preventDefault(); e.stopImmediatePropagation(); toggleMore(); });
        box.append(head, body);
        if (mine) mine.after(box); else roots[0].prepend(box);
        setStyle(box, 'order', '100');
        for (const it of folded) { wandMeta.set(it.el, { ...it, moved: true }); put(it.el, el => body.append(el)); addClass(it.el, 'tvrm-tidy-sub'); }
        for (const el of extras) { put(el, x => body.append(x)); addClass(el, 'tvrm-tidy-sub'); }
        body.append(tail);
        // 展开 / 收起只动这个盒子（不整页重排，不跳）；里面的往下长出来，比外面的小一号、底色淡一点
        const show = open => {
            head.querySelector('.tvrm-tidy-arrow').textContent = open ? '▾' : '▸';
            head.classList.toggle('is-open', open);
            open ? dropClass(body, 'tvrm-tidy-gone') : addClass(body, 'tvrm-tidy-gone');
        };
        let timer = null;
        function toggleMore() {
            const open = S().extOpen = !S().extOpen; save();
            clearTimeout(timer);
            if (open) {
                show(true); dropClass(body, 'tvrm-tidy-out'); addClass(body, 'tvrm-tidy-in');
                timer = setTimeout(() => { if (box.isConnected) dropClass(body, 'tvrm-tidy-in'); }, 260);
            } else {
                dropClass(body, 'tvrm-tidy-in'); addClass(body, 'tvrm-tidy-out');
                timer = setTimeout(() => {
                    if (!box.isConnected) return; // 这期间整理过一遍（或关掉了），不管了
                    dropClass(body, 'tvrm-tidy-out'); show(false);
                    // 从底下点的收起：标题要是跑到屏幕上面去了，轻轻滚回到标题，别让人找不着
                    if (head.getBoundingClientRect?.().top < 0) head.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' });
                }, 160);
            }
        }
        show(S().extOpen);
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
            root.prepend(fold(p.name, null, open, () => { S().userOpen[p.key] = !S().userOpen[p.key]; save(); apply(); }));
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
            if (S().smooth) addClass(doc.body, 'tvrm-tidy-smooth');
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
        // ⋯ 的点击在最外层、最早一步接住，菜单自己「点里面就关」的判断收不到这次点击
        doc.defaultView.addEventListener('click', e => {
            const dots = e.target.closest?.('.tvrm-tidy-dots'); if (!dots || !dotsToggle.has(dots)) return;
            e.preventDefault(); e.stopImmediatePropagation(); dotsToggle.get(dots)();
        }, true);
        doc.addEventListener('click', e => { if (e.target.closest?.('#extensionsMenuButton,#extensions-settings-button > .drawer-toggle,#user-settings-button > .drawer-toggle,#options_button')) schedule(); }, true);
        host.on?.('APP_READY', schedule);
        apply();
    }
    // 扩展页排查：每块的 id、在谁下面、排序、显示方式，复制出来发给 cc（只有插件名字，没有聊天内容）
    function diag() {
        const cs = el => doc.defaultView.getComputedStyle(el);
        const desc = el => el ? `${el.tagName.toLowerCase()}#${el.id || '-'}.${[...el.classList].filter(c => !c.startsWith('tvrm-tidy')).join('.') || '-'}` : '无';
        const roots = ['extensions_settings', 'extensions_settings2'].map($);
        const lines = [`酒馆你害我不浅 界面排查 · 开着:${S().on} 一列:${S().foldExt} 砚台在跑:${yantaiOn()} 宽:${doc.defaultView.innerWidth}`];
        for (const r of roots) lines.push(`${desc(r)} 父:${desc(r?.parentElement)} 显示:${r ? cs(r).display : '-'} 子:${r?.children.length ?? '-'}`);
        const parent = roots[0]?.parentElement;
        if (parent) lines.push(`父 显示:${cs(parent).display} 方向:${cs(parent).flexDirection} 行内:${parent.getAttribute('style') || '-'}`);
        for (const r of roots) for (const el of r?.children || []) {
            const label = squash(el.querySelector('b,strong')?.textContent || el.textContent).slice(0, 16);
            lines.push(`${r.id === 'extensions_settings' ? '1' : '2'} ${desc(el)} 「${label}」 顺序:${cs(el).order}/${el.style.getPropertyValue('order') || '-'} 显示:${cs(el).display}`);
        }
        return lines.join('\n');
    }
    async function copyDiag() {
        const text = diag();
        try { await doc.defaultView.navigator.clipboard.writeText(text); toast('success', '复制好了，粘贴发给 cc'); }
        catch { toast('warning', '没能自动复制，下面框里长按全选复制'); }
        diagText = text; rerender?.();
    }
    let diagText = '';
    function restore() {
        Object.assign(S(), { on: false });
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
        kids.push(h('p', { class: 'tvrm-note' }, '勾上的都收起来，用的时候点开就有，功能不受影响。'));
        if (yantaiOn()) kids.push(h('p', { class: 'tvrm-tidy-warn' }, '检测到「砚台 · 界面整理」还在运行，两个会改同一块界面，这里先不生效。在「管理扩展程序」里停用它并刷新后就好。'));
        kids.push(check('开启界面整理', st.on, v => change(x => { x.on = v; })));
        kids.push(h('div', { class: 'tvrm-actions' },
            btn('恢复原界面', async () => { if (await host.confirm?.('关掉界面整理，界面回到原来的样子？（勾选会留着，下次打开还在）') !== false) restore(); }),
            btn('重新识别', () => { apply(); rerender?.(); toast('success', '重新看过了'); })));

        // 只列现在看得到的；酒馆自己藏着、只在某些聊天里才出现的不列，底下小字说一声有几个
        const away = n => n ? h('p', { class: 'tvrm-note' }, `另有 ${n} 项现在没显示（酒馆或主题本来就藏着，或只在特定聊天里出现），没列出来。`) : null;
        const grid = (list, picked, key) => h('div', { class: 'tvrm-tidy-grid' }, list.map(x => check(x.label, picked.has(x.key), v => change(o => { o[key] = flip(o[key], x.key, v); }))));
        const clear = key => btn('全部放回', () => change(o => { o[key] = []; }));

        const allTops = topItems(); const tops = allTops.filter(x => x.on);
        const hide = new Set(st.hideTop);
        kids.push(part('top', '顶栏', `收起 ${tops.filter(x => hide.has(x.key)).length} 个 · 收进最右边的 «，点开往左展开`,
            tops.length ? grid(tops, hide, 'hideTop') : h('p', { class: 'tvrm-note' }, '没找到顶栏，可能主题改了结构。'),
            away(allTops.length - tops.length), clear('hideTop')));

        const allMenu = menuItems(); const menu = allMenu.filter(x => x.on);
        kids.push(part('menu', '选项菜单', `输入框左边的 ☰ · 收起 ${menu.filter(x => st.menuFolded.includes(x.key)).length} 个，收进最下面的 ⋯`,
            check('启用', st.foldMenu, v => change(x => { x.foldMenu = v; })),
            menu.length ? grid(menu, new Set(st.menuFolded), 'menuFolded') : h('p', { class: 'tvrm-note' }, '没找到选项菜单。'),
            away(allMenu.length - menu.length), clear('menuFolded')));

        const allWand = wandItems(); const wand = allWand.filter(x => x.on);
        kids.push(part('wand', '扩展菜单', `输入框左边的魔法棒 · 收起 ${wand.filter(x => st.hideWand.includes(x.key)).length} 个，收进最下面的 ⋯`,
            wand.length ? grid(wand, new Set(st.hideWand), 'hideWand') : h('p', { class: 'tvrm-note' }, '还没识别到。先点开一次魔法棒，再点上面「重新识别」。'),
            away(allWand.length - wand.length), clear('hideWand')));

        const exts = extItems().filter(e => !e.mine);
        kids.push(part('ext', '扩展程序页', `收起 ${exts.filter(e => st.extFolded.includes(e.key)).length} 个`,
            check('排成一列', st.foldExt, v => change(x => { x.foldExt = v; }), '咱们的面板在最上面，然后是收起的、酒馆自带的、酒馆助手、其他插件'),
            $('extensions_url') ? check('附加 API（已弃用）也收起来', st.foldExtras, v => change(x => { x.foldExtras = v; })) : null,
            exts.length ? h('div', { class: 'tvrm-tidy-list' }, exts.map(e => check(e.label, st.extFolded.includes(e.key), v => change(x => { x.extFolded = flip(x.extFolded, e.key, v); })))) : h('p', { class: 'tvrm-note' }, '还没识别到。'),
            diagText ? h('textarea', { class: 'text_pole tvrm-tidy-diag', rows: '8', readonly: true }, diagText) : null,
            h('div', { class: 'tvrm-actions' }, clear('extFolded'), btn('恢复默认', () => change(x => { x.extFolded = [...EXT_DEFAULT]; x.extOpen = false; })), btn('复制排查信息', () => copyDiag()))));

        kids.push(part('user', '用户设置', '勾上的段落折起来，搜索设置时自动全部展开',
            check('启用', st.foldUser, v => change(x => { x.foldUser = v; })),
            USER_PARTS.filter(p => doc.querySelector(p.sel)).map(p => check(p.name, st.userFolded.includes(p.key), v => change(x => { x.userFolded = flip(x.userFolded, p.key, v); })))));

        kids.push(part('smooth', '滑动更顺（试验）', st.smooth ? '开着' : '关着',
            check('启用', st.smooth, v => change(x => { x.smooth = v; }), '聊天区单独一层，每条消息各算各的。开着、关着各滑一滑比一比，没变化或更卡就关掉'),
            h('p', { class: 'tvrm-note' }, '要是开着以后消息里的弹出菜单、悬浮的东西位置不对，也关掉告诉 cc。')));

        kids.push(part('regex', '手机上的正则', '正则列表不超出屏幕宽度',
            check('启用', st.regexFit, v => change(x => { x.regexFit = v; }), '正则名字太长时显示省略号，开关和按钮留在同一行')));

        box.replaceChildren(...kids);
        box.scrollTop = scroll;
    }

    return { init, apply, render, restore, settings: S, destroy() { dead = true; pause(); undoAll(); style?.remove(); } };
}

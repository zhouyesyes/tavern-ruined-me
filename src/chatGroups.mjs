// 按角色把聊天分组：世界书格和预设格共用。全部自己写。
// 聊天的 key 是「谁|聊天名」：谁 = c:角色头像文件名 / g:群聊编号（和预设格一样）
// who(key) → 'c:xxx.png'；chat(key) → 聊天名

export const whoOf = key => String(key).split('|')[0];
export const chatOf = key => (String(key).includes('|') ? String(key).split('|').slice(1).join('|') : String(key));

// 酒馆里这个角色/群聊叫什么、头像在哪（找不到就用 key 里的名字）
export function whoInfo(c, who) {
    if (who.startsWith('g:')) {
        const g = (c.groups || []).find(x => 'g:' + x.id === who);
        return { name: g?.name || '群聊', avatar: g?.avatar_url || null };
    }
    const file = who.slice(2);
    const ch = (c.characters || []).find(x => x.avatar === file);
    // 头像直接用 key 里存的头像文件名去拿缩略图：不靠在角色列表里找到它（列表没载完、找不到时以前就退成一个字）
    const isImage = /\.(png|webp|jpe?g|gif)$/i.test(file);
    return { name: ch?.name || file.replace(/\.[^.]+$/, ''), avatar: isImage ? '/thumbnail?type=avatar&file=' + encodeURIComponent(file) : null };
}

// keys → [{ who, name, avatar, keys: [...] }]；当前聊天所在的角色排最前，其余按名字
export function groupChats(c, keys, hereKey) {
    const map = new Map();
    for (const key of keys) {
        const who = whoOf(key);
        if (!map.has(who)) map.set(who, { who, ...whoInfo(c, who), keys: [] });
        map.get(who).keys.push(key);
    }
    const hereWho = hereKey ? whoOf(hereKey) : null;
    return [...map.values()].sort((a, b) => (b.who === hereWho) - (a.who === hereWho) || a.name.localeCompare(b.name));
}

// 画出来：大折叠「所有聊天」→ 每个角色一个折叠（小头像 + 名字）→ 每个聊天交给 renderChat(key) 去画
// h：建元素的小函数；open：记住哪些折叠是打开的（Set）；prefix：区分世界书格和预设格的折叠状态
export function renderChatGroups({ h, c, keys, hereKey, open, prefix, title, renderChat }) {
    const groups = groupChats(c, keys, hereKey);
    // 全部默认收起，点开过的记住
    const keep = (el, id) => {
        el.open = open.has(id);
        el.addEventListener('toggle', () => { if (el.open) open.add(id); else open.delete(id); });
        return el;
    };
    const all = keep(h('details', { class: 'tvrm-chats tvrm-lv1' }, h('summary', { class: 'tvrm-heading tvrm-heading-all' }, `${title}（${groups.length} 个角色）`)), prefix + ':all');
    for (const g of groups) {
        const letter = () => h('span', { class: 'tvrm-face tvrm-face-letter' }, (g.name || '?').slice(0, 1));
        let face = letter();
        if (g.avatar) { face = h('img', { class: 'tvrm-face', src: g.avatar, alt: '' }); face.addEventListener('error', () => face.replaceWith(letter())); } // 图真的加载不了才换成字
        const box = keep(h('details', { class: 'tvrm-who' }, h('summary', null, face, h('span', { class: 'tvrm-name' }, g.name), h('small', { class: 'tvrm-count' }, `${g.keys.length} 个聊天`))), prefix + ':' + g.who);
        const body = h('div', { class: 'tvrm-who-body' });
        for (const key of g.keys) body.append(renderChat(key, key === hereKey));
        box.append(body); all.append(box);
    }
    return all;
}

// 排查：记着的聊天里，哪些在酒馆里已经删了（世界书格和预设格共用）
// listChats(头像文件名) → 这个角色现在有的聊天名 Set；查不了返回 null（这个角色就先不动）
// 返回 { gone: [key], unsure: 查不了的角色数 }；当前聊天永远不算
export async function findGone(c, keys, hereKey, listChats) {
    const gone = []; let unsure = 0;
    const byWho = new Map();
    for (const key of keys) if (key !== hereKey) (byWho.get(whoOf(key)) ?? byWho.set(whoOf(key), []).get(whoOf(key))).push(key);
    for (const [who, list] of byWho) {
        let have = null;
        if (who.startsWith('g:')) {
            const g = (c.groups || []).find(x => 'g:' + x.id === who);
            if (!g) { if ((c.groups || []).length) have = new Set(); } // 群聊整个删了
            else if (Array.isArray(g.chats)) have = new Set(g.chats.map(String));
        } else {
            const file = who.slice(2);
            const known = (c.characters || []).length > 0;
            if (known && !(c.characters || []).some(x => x.avatar === file)) have = new Set(); // 角色整个删了
            else if (known) { try { have = await listChats(file); } catch { have = null; } }
        }
        if (!have) { unsure++; continue; }
        for (const key of list) if (!have.has(chatOf(key))) gone.push(key);
    }
    return { gone, unsure };
}

// 排查的那一块：一个按钮，点了列出已经删掉的聊天（默认全勾上），勾完点「删掉选中的」
// what：在删什么（「预设记录」「世界书记录」）；onDelete(keys) 真的去删
export function renderSweep({ h, c, keys, hereKey, listChats, what, onDelete }) {
    const box = h('div', { class: 'tvrm-sweep' });
    const result = h('div', { class: 'tvrm-sweep-result' });
    const run = async () => {
        result.replaceChildren(h('small', null, '在查……'));
        const { gone, unsure } = await findGone(c(), keys(), hereKey(), listChats);
        const note = unsure ? h('small', { class: 'tvrm-sweep-note' }, `有 ${unsure} 个角色查不了（酒馆没给聊天列表），先不动它们`) : null;
        if (!gone.length) { result.replaceChildren(h('small', null, '没有找到已经删掉的聊天'), note || ''); return; }
        const picks = gone.map(key => {
            const cb = h('input', { type: 'checkbox', checked: true }); cb.checked = true;
            return { key, cb, row: h('label', { class: 'checkbox_label tvrm-sweep-row' }, cb, h('span', null, `${whoInfo(c(), whoOf(key)).name} · ${chatOf(key)}`)) };
        });
        const del = h('button', { type: 'button', class: 'menu_button tvrm-delete' }, `删掉选中的${what}`);
        del.addEventListener('click', async () => {
            const sel = picks.filter(p => p.cb.checked).map(p => p.key);
            if (!sel.length) return;
            await onDelete(sel);
            result.replaceChildren(h('small', null, `删掉了 ${sel.length} 个聊天的${what}`));
        });
        result.replaceChildren(h('small', null, `这些聊天在酒馆里已经删了（${gone.length} 个），${what}还在：`), ...picks.map(p => p.row), note || '', h('div', { class: 'tvrm-set-actions' }, del));
    };
    box.append(h('button', { type: 'button', class: 'menu_button tvrm-sweep-btn', onclick: run }, '排查：找出已经删掉的聊天'), result);
    return box;
}

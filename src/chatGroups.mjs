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
    return { name: ch?.name || file.replace(/\.[^.]+$/, ''), avatar: ch ? '/thumbnail?type=avatar&file=' + encodeURIComponent(file) : null };
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
        const face = g.avatar ? h('img', { class: 'tvrm-face', src: g.avatar, alt: '' }) : h('span', { class: 'tvrm-face tvrm-face-letter' }, (g.name || '?').slice(0, 1));
        const box = keep(h('details', { class: 'tvrm-who' }, h('summary', null, face, h('span', { class: 'tvrm-name' }, g.name), h('small', { class: 'tvrm-count' }, `${g.keys.length} 个聊天`))), prefix + ':' + g.who);
        const body = h('div', { class: 'tvrm-who-body' });
        for (const key of g.keys) body.append(renderChat(key, key === hereKey));
        box.append(body); all.append(box);
    }
    return all;
}

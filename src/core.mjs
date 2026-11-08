// 纯逻辑：不碰酒馆、不碰 DOM，所以能直接用 node 跑测试。
// 三格（世界书 / 预设 / API）共用「跟着聊天走」这一层：
//   插件设置里每格一份「怎么分组」（全局）；
//   每个聊天的元数据里每格一份「这个聊天选了什么」。

export const NS = 'tavern_ruined_me';
export const SLOTS = ['world', 'preset', 'api'];

export const BUCKET = { ON: 'on', OFF: 'off', FREE: 'free' };

// ---------- 插件设置（全局） ----------

export function defaultSettings() {
    return {
        v: 1,
        // 世界书：books = 按条目分组管理的书；wholeBooks = 只做整本开关的书
        world: { books: {}, wholeBooks: [], wholeMeta: {}, physical: {} },
        preset: {},
        api: {},
    };
}

export function normalizeSettings(raw) {
    const base = defaultSettings();
    const s = raw && typeof raw === 'object' ? raw : {};
    const out = { ...base, ...s };
    out.world = { ...base.world, ...(s.world || {}) };
    if (!out.world.books || typeof out.world.books !== 'object') out.world.books = {};
    if (!Array.isArray(out.world.wholeBooks)) out.world.wholeBooks = [];
    // 各个聊天开了哪些（小账）：面板里按角色列出所有聊天用。聊天自己的配置还是存在聊天里，这里只是一份抄本
    if (!out.world.index || typeof out.world.index !== 'object') out.world.index = {};
    if (!out.world.wholeMeta || typeof out.world.wholeMeta !== 'object') out.world.wholeMeta = {};
    // 「恢复原书 → 暂停接管」0.6.0 起已经去掉了（按钮和解除都没了），旧版留下的暂停标记一律清掉，不然那本书永远不跟着聊天走
    for (const m of Object.values(out.world.wholeMeta)) if (m && typeof m === 'object') m.restored = false;
    for (const name of Object.keys(out.world.books)) {
        const b = out.world.books[name] || {};
        out.world.books[name] = {
            ...b,
            groups: Array.isArray(b.groups) ? b.groups : [],
            assign: b.assign && typeof b.assign === 'object' ? b.assign : {},
            restored: false,
            backup: b.backup ?? null,
        };
    }
    for (const slot of ['preset', 'api']) if (!out[slot] || typeof out[slot] !== 'object') out[slot] = {};
    return out;
}

export function newBookCfg() {
    return { groups: [], assign: {}, writeBack: true, backup: null };
}

export function newGroupId() {
    return 'g_' + Math.random().toString(36).slice(2, 8);
}

export function bucketOf(bookCfg, uid) {
    return bookCfg?.assign?.[String(uid)] ?? BUCKET.FREE;
}

export function isCustomBucket(b) {
    return b !== BUCKET.ON && b !== BUCKET.OFF && b !== BUCKET.FREE;
}

// 删除一个组：里面的条目回到「不管」
export function removeGroup(bookCfg, gid) {
    bookCfg.groups = bookCfg.groups.filter(g => g.id !== gid);
    for (const [uid, b] of Object.entries(bookCfg.assign)) if (b === gid) delete bookCfg.assign[uid];
}

export function setBucket(bookCfg, uid, bucket) {
    if (bucket === BUCKET.FREE) delete bookCfg.assign[String(uid)];
    else bookCfg.assign[String(uid)] = bucket;
}

// 一本书是不是有需要在新聊天里问的内容
export function bookNeedsPicker(settings, name) {
    const b = settings.world.books[name];
    if (b) return b.groups.some(g => Object.values(b.assign).includes(g.id));
    return settings.world.wholeBooks.includes(name);
}

export function needsPicker(settings) {
    const w = settings.world;
    return Object.keys(w.books).some(n => bookNeedsPicker(settings, n)) || w.wholeBooks.length > 0;
}

// ---------- 每个聊天自己的配置 ----------

export function getChatSlot(meta, slot) {
    return meta?.[NS]?.slots?.[slot] ?? null;
}

export function setChatSlot(meta, slot, value) {
    if (!meta[NS] || typeof meta[NS] !== 'object') meta[NS] = { v: 1, slots: {} };
    if (!meta[NS].slots) meta[NS].slots = {};
    meta[NS].slots[slot] = value;
    return meta;
}

export function hasChatSlot(meta, slot) {
    return getChatSlot(meta, slot) !== null;
}

// 世界书格的聊天配置：{ groups: {书: {组id: [uid]}}, books: {书: true/false} }
export function emptyWorldChat() {
    return { groups: {}, books: {} };
}

// 新聊天先沿用酒馆当前状态：条目现在是开着的，就算「选中」。
// entriesByBook: { 书名: [{uid, disable}] }
export function seedWorldChat(settings, entriesByBook) {
    const chat = emptyWorldChat();
    for (const [name, cfg] of Object.entries(settings.world.books)) {
        const entries = entriesByBook[name] || [];
        chat.groups[name] = {};
        for (const g of cfg.groups) {
            chat.groups[name][g.id] = entries
                .filter(e => bucketOf(cfg, e.uid) === g.id && !e.disable)
                .map(e => String(e.uid));
        }
    }
    for (const name of settings.world.wholeBooks) {
        const entries = entriesByBook[name] || [];
        // 整本书里只要有一条开着，就当它现在是开的
        chat.books[name] = entries.length ? entries.some(e => !e.disable) : true;
    }
    return chat;
}

// ---------- 某个条目在这个聊天里该开还是关 ----------
// 返回 true（开）/ false（关）/ null（不管，原样照书）。
// originalDisable：这个条目在原书里「本来」的 disable（整本开关打开时用它还原）。
export function resolveEntry(settings, chat, book, uid, originalDisable = false) {
    uid = String(uid);
    const cfg = settings.world.books[book];
    if (chat?.books?.[book] === false) return false;
    const explicit = chat?.entries?.[book]?.[uid];
    if (typeof explicit === 'boolean') return explicit;
    if (cfg) {
        const bucket = bucketOf(cfg, uid);
        if (bucket === BUCKET.FREE) return null;
        if (bucket === BUCKET.ON) return true;
        if (bucket === BUCKET.OFF) return false;
        const picked = chat?.groups?.[book]?.[bucket];
        if (!Array.isArray(picked)) return null; // 这个聊天还没选过 → 照书
        return picked.includes(uid);
    }
    if (settings.world.wholeBooks.includes(book)) {
        const on = chat?.books?.[book];
        if (on === undefined || on === null) return null;
        return on ? !originalDisable : false;
    }
    return null;
}

// ---------- 写回原书 ----------

export function snapshotBook(data) {
    return { at: Date.now(), data: JSON.parse(JSON.stringify(data)) };
}

// 一本书的「写回设置 + 备份」：分组书放在自己的配置里，整本开关的书放在 wholeMeta
export function bookMeta(settings, name, create = false) {
    const cfg = settings.world.books[name];
    if (cfg) return cfg;
    if (!settings.world.wholeBooks.includes(name)) return null;
    const m = settings.world.wholeMeta;
    if (!m[name] && create) m[name] = { writeBack: true, backup: null };
    return m[name] ?? null;
}

// 算出这本书要改哪些条目的 disable；没变化就返回空数组。
// bookData: 酒馆里世界书的 {entries: {uid: entry}}
export function planWriteBack(settings, chat, book, bookData) {
    const changes = [];
    const meta = bookMeta(settings, book);
    if (!settings.world.books[book] && !settings.world.wholeBooks.includes(book)) return changes;
    const backup = meta?.backup?.data;
    for (const entry of Object.values(bookData?.entries || {})) {
        const orig = backup?.entries?.[entry.uid]?.disable ?? entry.disable;
        const want = resolveEntry(settings, chat, book, entry.uid, orig === true);
        if (want === null) continue;
        const disable = !want;
        if ((entry.disable === true) !== disable) changes.push({ uid: entry.uid, disable });
    }
    return changes;
}

// 防抖：连拨几下只执行最后一次。timers 可以注入，方便测试。
export function createDebouncer(fn, ms, timers = { setTimeout, clearTimeout }) {
    let t = null;
    const run = (...args) => {
        if (t !== null) timers.clearTimeout(t);
        t = timers.setTimeout(() => { t = null; fn(...args); }, ms);
    };
    run.cancel = () => { if (t !== null) { timers.clearTimeout(t); t = null; } };
    run.pending = () => t !== null;
    return run;
}

// ---------- 显示用 ----------

export function entryLabel(entry) {
    const name = (entry.comment || '').trim();
    if (name) return name;
    const key = Array.isArray(entry.key) ? entry.key.filter(Boolean)[0] : '';
    return key || `条目 #${entry.uid}`;
}

export function entrySub(entry, max = 40) {
    const keys = Array.isArray(entry.key) ? entry.key.filter(Boolean).join('、') : '';
    const s = keys || (entry.content || '').replace(/\s+/g, ' ').trim();
    return s.length > max ? s.slice(0, max) + '…' : s;
}

// 当前聊天实际用到的书，分三类：角色世界书（主书 + 额外绑定）、聊天世界书、全局世界书。
// 与酒馆 getCharacterLore 一样按角色文件名找额外绑定，不猜显示名。
export function bindingKinds(context, binding, available) {
    const has = n => available.includes(n);
    const character = new Set();
    const ids = context.groupId
        ? (context.groups?.find(g => String(g.id) === String(context.groupId))?.members || [])
            .map(avatar => context.characters?.findIndex(c => c.avatar === avatar)).filter(i => i >= 0)
        : [context.characterId];
    for (const id of ids) {
        const c = context.characters?.[id];
        if (!c) continue;
        const primary = c.data?.extensions?.world;
        if (primary) character.add(primary);
        const file = c.avatar?.replace(/\.[^/.]+$/, '');
        for (const n of binding?.charLore?.find(x => x.name === file)?.extraBooks || []) character.add(n);
    }
    const chatBook = context.chatMetadata?.world_info;
    const chat = chatBook ? [chatBook] : [];
    const global = binding?.global || [];
    return { character: [...character].filter(has), chat: chat.filter(has), global: [...new Set(global)].filter(has) };
}

export function boundBookNames(context, binding, available) {
    const k = bindingKinds(context, binding, available);
    const names = new Set([...k.character, ...k.chat, ...k.global]);
    return available.filter(n => names.has(n));
}

// physical 记录插件最后核对的原书开关。
// restore=true（切进聊天时）：以这个聊天自己存的选择为准，原书和上次写入对不上也不当成「外部修改」，
//   否则别的插件（LoreGovernor 等）动过书，这个聊天存的选择就被冲掉了。
// restore=false（聊天里原书被改、手拨开关、开场白/脚本开关）：和上次写入对比，变了的记进当前聊天。
export function reconcileBook(settings, chat, name, data, restore = false) {
    chat.entries ??= {};
    chat.books ??= {};
    chat.groups ??= {};
    chat.entries[name] ??= {};
    settings.world.physical ??= {};
    const previous = settings.world.physical[name];
    let external = false;
    const observed = {};
    for (const entry of Object.values(data?.entries || {})) {
        const uid = String(entry.uid);
        const on = entry.disable !== true;
        observed[uid] = on;
        const changed = !restore && !!previous && uid in previous && previous[uid] !== on;
        if (changed) {
            chat.entries[name][uid] = on;
            external = true;
        } else if (!(uid in chat.entries[name])) {
            const legacy = resolveEntry(settings, chat, name, uid, entry.disable === true);
            chat.entries[name][uid] = legacy ?? on;
        }
    }
    if (external || chat.books[name] === undefined) chat.books[name] = true;
    for (const uid of Object.keys(chat.entries[name])) if (!(uid in observed)) delete chat.entries[name][uid];
    settings.world.physical[name] = observed;
    return external;
}

// 这本书算不算「她分过类」：有分组，或者有条目被归过类（旧版整本开关的书也算）
export function isClassified(settings, name) {
    const b = settings.world.books[name];
    if (b) return b.groups.length > 0 || Object.keys(b.assign).length > 0;
    return settings.world.wholeBooks.includes(name);
}

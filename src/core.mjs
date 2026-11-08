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
        world: { books: {}, wholeBooks: [], wholeMeta: {} },
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
    if (!out.world.wholeMeta || typeof out.world.wholeMeta !== 'object') out.world.wholeMeta = {};
    for (const name of Object.keys(out.world.books)) {
        const b = out.world.books[name] || {};
        out.world.books[name] = {
            groups: Array.isArray(b.groups) ? b.groups : [],
            assign: b.assign && typeof b.assign === 'object' ? b.assign : {},
            writeBack: b.writeBack !== false,
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
            if (g.mode === 'one') chat.groups[name][g.id] = chat.groups[name][g.id].slice(0, 1);
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
    if (meta && meta.writeBack === false) return changes;
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

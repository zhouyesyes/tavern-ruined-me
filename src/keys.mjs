// API 格的数据部分（纯逻辑，不碰页面和酒馆，方便测试）：钥匙本里一条一条的地址、密钥、模型。全部自己写。
// 存在 extensionSettings.tavern_ruined_me_keys = { keys: [...], movedFromVault: 时间 }

export const KEYS = 'tavern_ruined_me_keys';
const str = v => (typeof v === 'string' ? v.trim() : '');
let seq = 0;
export const newKeyId = () => 'k' + Date.now().toString(36) + (seq++).toString(36);

// 地址统一一下再比：去掉末尾斜杠和常见的 /chat/completions，大小写不敏感的主机名
export function normalizeUrl(u) {
    let s = str(u);
    if (!s) return '';
    if (!/^https?:\/\//i.test(s)) s = 'https://' + s;
    s = s.replace(/\/+(chat\/completions|completions|models)\/?$/i, '').replace(/\/+$/, '');
    try { const x = new URL(s); return x.protocol + '//' + x.host.toLowerCase() + x.pathname.replace(/\/+$/, ''); } catch { return s; }
}
export const hostOf = u => { try { return new URL(normalizeUrl(u)).host; } catch { return ''; } };
// 没起名字：用地址的主机名
export const autoName = (url, fallback = '新的钥匙') => hostOf(url) || fallback;

export function newKey(p = {}) {
    const url = str(p.url);
    return {
        id: str(p.id) || newKeyId(),
        name: str(p.name) || autoName(url),
        url,
        key: str(p.key),
        // 只知道酒馆给的遮住的样子（读不到真密钥的时候）
        keyHint: str(p.keyHint),
        model: str(p.model),
        models: Array.isArray(p.models) ? p.models.filter(m => typeof m === 'string') : [],
        tags: [...new Set((Array.isArray(p.tags) ? p.tags : String(p.tags || '').split(/[,，\s]+/)).map(str).filter(Boolean))],
        note: typeof p.note === 'string' ? p.note : '',
        // 放进了酒馆反代列表的哪个预设（名字）
        proxyName: str(p.proxyName),
        at: Number(p.at) || Date.now(),
    };
}

// 遮住中间：sk-ab…wxyz
export function maskKey(k) {
    const s = str(k);
    if (!s) return '';
    if (s.length <= 8) return s.slice(0, 2) + '…';
    return s.slice(0, 5) + '…' + s.slice(-4);
}

// 搜索：名字、地址、模型、标签、备注里有这几个字（空格分开的每个词都要有）
export function searchKeys(list, q) {
    const words = str(q).toLowerCase().split(/\s+/).filter(Boolean);
    if (!words.length) return list;
    return list.filter(k => {
        const hay = [k.name, k.url, k.model, k.note, ...(k.tags || [])].join(' ').toLowerCase();
        return words.every(w => hay.includes(w));
    });
}

// 同一把钥匙：地址一样，密钥一样；读不到真密钥的（只有遮住的样子）就比遮住的样子
export const sameKey = (a, b) => normalizeUrl(a.url) === normalizeUrl(b.url)
    && (str(a.key) || str(b.key) ? str(a.key) === str(b.key) : !!str(a.keyHint) && str(a.keyHint) === str(b.keyHint));

// 从旧插件「通用钥匙API管理器」（extensionSettings.apiVault）搬过来：只读它的数据，不改它
// 已经有一样的（同地址同密钥）就跳过，返回 { added, skipped }
export function importFromVault(store, vault) {
    const old = Array.isArray(vault?.profiles) ? vault.profiles : [];
    const added = []; let skipped = 0;
    for (const p of old) {
        if (!p || (!str(p.url) && !str(p.key) && !str(p.keyHint))) { skipped++; continue; }
        const k = newKey({ name: p.name, url: p.url, key: p.key, keyHint: p.keyHint, model: p.model, models: p.models, tags: p.tags, note: p.note, proxyName: p.proxyRef?.name });
        if (store.keys.some(x => sameKey(x, k))) { skipped++; continue; }
        store.keys.push(k); added.push(k);
    }
    return { added, skipped };
}
export const vaultCount = vault => (Array.isArray(vault?.profiles) ? vault.profiles.length : 0);

// 模型列表：酒馆状态检查回来的 { data: [{ id }] } 或 { models: [...] }，或者直接一个数组
export function parseModels(res) {
    const list = Array.isArray(res) ? res : Array.isArray(res?.data) ? res.data : Array.isArray(res?.models) ? res.models : [];
    return [...new Set(list.map(m => (typeof m === 'string' ? m : m?.id || m?.name || '')).filter(Boolean))].sort((a, b) => a.localeCompare(b));
}

// 反代预设起名：不和已有的重名（重名就加 2、3……）
export function freeProxyName(name, taken) {
    const set = new Set(taken); const base = str(name) || '新的反代';
    if (!set.has(base)) return base;
    for (let i = 2; ; i++) if (!set.has(`${base} ${i}`)) return `${base} ${i}`;
}

// ---- 认框：这个输入框是填地址的、填密钥的，还是都不是 ----
const NOT_KEY = /max[_\s-]?tokens?|token[_\s-]?(count|limit|budget)|hot[_\s-]?key|key[_\s-]?bind|keyword|关键词|monkey|keyboard/i;
const KEY_WORDS = /api[_\s-]?key|apikey|secret|token|password|passwd|密钥|秘钥|口令|令牌|(^|[_\s-])key($|[_\s-])/i;
const URL_WORDS = /url|endpoint|base[_\s-]?url|host|server|proxy|反代|地址|接口|端点/i;
const NOT_URL = /image|img|avatar|background|bg[_\s-]|icon|youtube|music|audio|video|头像|背景|图片/i;
// desc：{ type, id, name, placeholder, label, value }
export function classifyField(desc) {
    const type = str(desc.type).toLowerCase();
    if (type && !['text', 'password', 'url', 'search', ''].includes(type)) return null;
    const words = [desc.id, desc.name, desc.placeholder, desc.label].map(str).join(' ');
    if (type === 'password') return NOT_KEY.test(words) ? null : 'key';
    if (KEY_WORDS.test(words) && !NOT_KEY.test(words)) return 'key';
    if (type === 'url') return 'url';
    if (URL_WORDS.test(words) && !NOT_URL.test(words)) return 'url';
    if (/^https?:\/\//i.test(str(desc.value)) && !NOT_URL.test(words)) return 'url';
    return null;
}

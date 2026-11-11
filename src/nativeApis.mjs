// 只读取可明确配对的当前自定义来源和连接档案；不猜测历史密钥对应的地址。
export async function collectNativeApis({ settings, profiles = [], readSecret, canReadSecrets, customSecretKey = 'api_key_custom' }) {
    // findSecret 的权限拒绝会触发宿主后端红框，先通过只读接口确认权限。
    if (typeof canReadSecrets !== 'function') return [];
    try { if (await canReadSecrets() !== true) return []; } catch { return []; }
    const result = [], reads = new Map();
    const read = (key, id) => {
        const token = key + ':' + (id || 'active');
        if (!reads.has(token)) reads.set(token, Promise.resolve().then(() => readSecret?.(key, id)));
        return reads.get(token);
    };
    const add = async (name, url, secretKey, id, model, path) => {
        if (!/^https?:\/\/\S+$/i.test(url || '') || !secretKey) return;
        const key = await read(secretKey, id);
        if (typeof key === 'string' && key.trim()) result.push({ name, url, key: key.trim(), model, source: 'TT API 连接', path });
    };
    if (settings?.chat_completion_source === 'custom') {
        await add('当前自定义来源', settings.custom_url, customSecretKey, undefined, settings.custom_model, 'TT API 连接 › 当前自定义来源');
    }
    for (const p of profiles) {
        const ref = p?.secretRef;
        const secretKey = ref?.key || (p?.api === 'custom' ? customSecretKey : null);
        const id = ref?.id || p?.['secret-id'];
        // 档案没有明确密钥编号时不能套用当前活动密钥。
        if (!id) continue;
        await add(p.name, p['api-url'], secretKey, id, p.model, 'TT 连接档案 › ' + (p.id || p.name));
    }
    return result;
}

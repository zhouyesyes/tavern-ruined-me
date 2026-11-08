import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const { JSDOM } = createRequire(process.env.JSDOM_DIR || '/tmp/jsd/')('jsdom');
import { classifyField, importFromVault, normalizeUrl, newKey, maskKey, searchKeys, parseModels, freeProxyName } from '../src/keys.mjs';
import { createKeyKeeper } from '../src/keysUI.mjs';

test('认框：密钥框、地址框，别的不认', () => {
    assert.equal(classifyField({ type: 'password', id: 'openai_proxy_password' }), 'key');
    assert.equal(classifyField({ type: 'text', id: 'api_key_custom' }), 'key');
    assert.equal(classifyField({ type: 'text', placeholder: '填你的 API Key' }), 'key');
    assert.equal(classifyField({ type: 'text', id: 'openai_reverse_proxy' }), 'url');
    assert.equal(classifyField({ type: 'text', id: 'custom_api_url_text' }), 'url');
    assert.equal(classifyField({ type: 'text', label: '接口地址' }), 'url');
    assert.equal(classifyField({ type: 'text', id: 'x', value: 'https://a.com/v1' }), 'url');
    assert.equal(classifyField({ type: 'number', id: 'openai_max_tokens' }), null);
    assert.equal(classifyField({ type: 'text', id: 'openai_max_tokens' }), null);
    assert.equal(classifyField({ type: 'text', id: 'hotkey_input' }), null);
    assert.equal(classifyField({ type: 'text', id: 'avatar_url' }), null);
    assert.equal(classifyField({ type: 'text', id: 'world_entry_key', label: '关键词' }), null);
    assert.equal(classifyField({ type: 'checkbox', id: 'api_key_on' }), null);
});

test('地址整理、遮住密钥、搜索、模型列表、反代起名不重名', () => {
    assert.equal(normalizeUrl('api.x.com/v1/'), 'https://api.x.com/v1');
    assert.equal(normalizeUrl('https://API.x.com/v1/chat/completions'), 'https://api.x.com/v1');
    assert.equal(maskKey('sk-abcdefghijklmn'), 'sk-ab…klmn');
    const list = [newKey({ name: '主力', url: 'https://a.com/v1', tags: '中转 便宜' }), newKey({ name: '生图', url: 'https://b.com', model: 'flux' })];
    assert.deepEqual(searchKeys(list, '便宜').map(k => k.name), ['主力']);
    assert.deepEqual(searchKeys(list, 'flux').map(k => k.name), ['生图']);
    assert.deepEqual(parseModels({ data: [{ id: 'b' }, { id: 'a' }, { id: 'a' }] }), ['a', 'b']);
    assert.equal(freeProxyName('主力', ['主力', '主力 2']), '主力 3');
    assert.equal(newKey({ url: 'https://c.com/v1' }).name, 'c.com');
});

test('从旧插件搬：抄过来，一样的跳过，旧的不动', () => {
    const vault = { profiles: [
        { id: 'p1', name: '主力中转', url: 'https://a.com/v1', key: 'sk-1', model: 'gpt-x', tags: ['中转'], note: '月底续费', proxyRef: { name: '主力中转' } },
        { id: 'p2', name: '只有遮住的', url: 'https://b.com', key: '', keyHint: 'sk-***9' },
        { id: 'p3', name: '空的' },
    ] };
    const before = JSON.stringify(vault);
    const store = { keys: [] };
    const r = importFromVault(store, vault);
    assert.equal(r.added.length, 2); assert.equal(r.skipped, 1);
    assert.equal(store.keys[0].note, '月底续费'); assert.equal(store.keys[0].proxyName, '主力中转'); assert.equal(store.keys[1].keyHint, 'sk-***9');
    assert.equal(importFromVault(store, vault).added.length, 0); // 再搬一遍：一样的都跳过（只有遮住样子的那条按遮住的样子比）
    assert.equal(JSON.stringify(vault), before);
});

function setup() {
    const dom = new JSDOM(`<body>
        <div class="form"><label for="u">接口地址</label><input id="u" type="text"><label>API Key<input id="k" type="password"></label></div>
        <div class="other"><input id="lonely" type="password" placeholder="secret"></div>
        <input id="tokens" type="text" name="max_tokens">
        <div id="box"></div></body>`, { pretendToBeVisual: true });
    const document = dom.window.document;
    const ctx = { extensionSettings: {}, saveSettingsDebounced() {} };
    const toasts = []; const proxies = [{ name: '主力', url: 'x', password: 'y' }];
    const keeper = createKeyKeeper({ document, getContext: () => ctx, toast: (k, m) => toasts.push([k, m]), confirm: async () => true,
        proxy: { names: () => proxies.map(p => p.name), add: p => proxies.push(p) },
        probe: async (url, key) => { if (key !== 'sk-good') throw new Error('401'); return ['m2', 'm1']; } });
    return { dom, document, ctx, keeper, toasts, proxies };
}

test('点哪填哪：认出框，填一个顺手把配对的另一个也填上，触发 input/change', () => {
    const x = setup(); const d = x.document;
    x.keeper.store().keys.push(newKey({ name: '主力', url: 'https://a.com/v1', key: 'sk-1' }));
    const u = d.getElementById('u'); const k = d.getElementById('k');
    assert.equal(x.keeper.kindOf(u), 'url'); assert.equal(x.keeper.kindOf(k), 'key'); assert.equal(x.keeper.kindOf(d.getElementById('tokens')), null);
    assert.equal(x.keeper.partnerOf(u, 'url'), k);
    let fired = 0; k.addEventListener('input', () => fired++); k.addEventListener('change', () => fired++);
    x.keeper.setTarget(u, 'url'); x.keeper.fill(x.keeper.store().keys[0]);
    assert.equal(u.value, 'https://a.com/v1'); assert.equal(k.value, 'sk-1'); assert.equal(fired, 2);
    const lonely = d.getElementById('lonely'); x.keeper.setTarget(lonely, 'key'); x.keeper.fill(x.keeper.store().keys[0]);
    assert.equal(lonely.value, 'sk-1'); // 没有配对的就只填这一个
});

test('面板：搬旧数据、新建默认进酒馆反代列表（不重名）、测连接拿到模型、挑模型', async () => {
    const x = setup(); const d = x.document; const box = d.getElementById('box');
    x.ctx.extensionSettings.apiVault = { profiles: [{ name: '旧的', url: 'https://old.com', key: 'sk-old' }] };
    x.keeper.render(box);
    assert.match(box.textContent, /存着 1 条/);
    [...box.querySelectorAll('button')].find(b => b.textContent === '搬过来').click();
    assert.equal(x.keeper.store().keys.length, 1); assert.match(box.textContent, /已从「通用钥匙API管理器」搬过/);
    [...box.querySelectorAll('button')].find(b => b.textContent === '新建').click();
    const ed = box.querySelector('.tvrm-key-editor'); const inputs = ed.querySelectorAll('input');
    inputs[0].value = '主力'; inputs[1].value = 'https://new.com/v1'; inputs[2].value = 'sk-good';
    [...ed.querySelectorAll('button')].find(b => b.textContent === '保存').click();
    const k = x.keeper.store().keys[0];
    assert.equal(k.name, '主力'); assert.equal(k.proxyName, '主力 2'); assert.equal(x.proxies.at(-1).url, 'https://new.com/v1');
    const card = box.querySelector('.tvrm-key'); card.open = true;
    [...card.querySelectorAll('button')].find(b => b.textContent === '测连接').click();
    await new Promise(r => setTimeout(r, 5));
    assert.deepEqual(k.models, ['m2', 'm1']); assert.match(box.textContent, /通了 · 2 个模型/);
    [...box.querySelectorAll('.tvrm-chip')].find(b => b.textContent === 'm1').click();
    assert.equal(k.model, 'm1');
});

test('新建时去掉「也放进酒馆的反代列表」就不放', () => {
    const x = setup(); const d = x.document; const box = d.getElementById('box');
    x.keeper.render(box);
    [...box.querySelectorAll('button')].find(b => b.textContent === '新建').click();
    const ed = box.querySelector('.tvrm-key-editor'); const inputs = ed.querySelectorAll('input');
    inputs[1].value = 'https://img.com'; inputs[2].value = 'sk-img';
    ed.querySelector('input[type=checkbox]').checked = false;
    [...ed.querySelectorAll('button')].find(b => b.textContent === '保存').click();
    assert.equal(x.proxies.length, 1); assert.equal(x.keeper.store().keys[0].proxyName, '');
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const { JSDOM } = createRequire(process.env.JSDOM_DIR || '/tmp/jsd/')('jsdom');
import { classifyField, scanSettings, normalizeUrl, newKey, maskKey, searchKeys, parseModels } from '../src/keys.mjs';
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

test('地址整理、遮住密钥、搜索、模型列表', () => {
    assert.equal(normalizeUrl('api.x.com/v1/'), 'https://api.x.com/v1');
    assert.equal(normalizeUrl('https://API.x.com/v1/chat/completions'), 'https://api.x.com/v1');
    assert.equal(maskKey('sk-abcdefghijklmn'), 'sk-ab…klmn');
    const list = [newKey({ name: '主力', url: 'https://a.com/v1', tags: '中转 便宜' }), newKey({ name: '生图', url: 'https://b.com', model: 'flux' })];
    assert.deepEqual(searchKeys(list, '便宜').map(k => k.name), ['主力']);
    assert.deepEqual(searchKeys(list, 'flux').map(k => k.name), ['生图']);
    assert.deepEqual(parseModels({ data: [{ id: 'b' }, { id: 'a' }, { id: 'a' }] }), ['a', 'b']);
    assert.equal(newKey({ url: 'https://c.com/v1' }).name, 'c.com');
});

function setup() {
    const dom = new JSDOM(`<body>
        <div class="form"><label for="u">接口地址</label><input id="u" type="text"><label>API Key<input id="k" type="password"></label></div>
        <div class="other"><input id="lonely" type="password" placeholder="secret"></div>
        <input id="tokens" type="text" name="max_tokens">
        <dialog open id="hub"><label>API 端点 URL</label><div><input id="hu" type="text"></div><label>API 密钥 (Key)</label><div><input id="hk" type="password"></div></dialog>
        <div id="box"></div></body>`, { pretendToBeVisual: true });
    const document = dom.window.document;
    const ctx = { extensionSettings: {}, saveSettingsDebounced() {} };
    const toasts = []; const proxies = [{ name: '主力', url: 'https://relay.com/v1', password: 'sk-relay-123' }, { name: 'None', url: '', password: '' }];
    const keeper = createKeyKeeper({ document, getContext: () => ctx, toast: (k, m) => toasts.push([k, m]), confirm: async () => true,
        proxy: { list: () => proxies },
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

test('面板：新建、测连接拿到模型、挑模型；没有「搬过来」，也不往酒馆反代列表里加', async () => {
    const x = setup(); const d = x.document; const box = d.getElementById('box');
    x.ctx.extensionSettings.apiVault = { profiles: [{ name: '旧的', url: 'https://old.com', key: 'sk-old' }] };
    x.keeper.render(box);
    assert.doesNotMatch(box.textContent, /搬过来/);
    [...box.querySelectorAll('button')].find(b => b.textContent === '新建').click();
    const ed = box.querySelector('.tvrm-key-editor'); const inputs = ed.querySelectorAll('input');
    inputs[0].value = '主力'; inputs[1].value = 'https://new.com/v1'; inputs[2].value = 'sk-good';
    [...ed.querySelectorAll('button')].find(b => b.textContent === '保存').click();
    const k = x.keeper.store().keys[0];
    assert.equal(k.name, '主力'); assert.equal(x.proxies.length, 2); assert.equal(box.querySelector('input[type=checkbox]'), null);
    const card = box.querySelector('.tvrm-key'); card.open = true;
    [...card.querySelectorAll('button')].find(b => b.textContent === '测连接').click();
    await new Promise(r => setTimeout(r, 5));
    assert.deepEqual(k.models, ['m2', 'm1']); assert.match(box.textContent, /通了 · 2 个模型/);
    [...box.querySelectorAll('.tvrm-chip')].find(b => b.textContent === 'm1').click();
    assert.equal(k.model, 'm1');
});

test('小钥匙插在框后面（跟着框走）；框在弹窗里时选单也放进弹窗', () => {
    const x = setup(); const d = x.document;
    x.keeper.store().keys.push(newKey({ name: '主力', url: 'https://a.com/v1', key: 'sk-1' }));
    x.keeper.initFill();
    const hu = d.getElementById('hu'); hu.focus();
    const pill = d.querySelector('.tvrm-key-pill'); assert.ok(pill, '有小钥匙');
    assert.equal(pill.previousElementSibling, hu, '钥匙就插在框后面'); assert.ok(pill.closest('#hub'));
    pill.click();
    const sheet = d.querySelector('.tvrm-key-sheet'); assert.ok(sheet.closest('#hub')); assert.equal(sheet.previousElementSibling, d.querySelector('.tvrm-key-pill'), '列表挂在框下面（钥匙后面）');
    assert.notEqual(d.activeElement, null);
    d.querySelector('.tvrm-key-pick').click();
    assert.equal(hu.value, 'https://a.com/v1'); assert.equal(d.getElementById('hk').value, 'sk-1');
    d.getElementById('u').focus();
    assert.equal(d.querySelector('.tvrm-key-pill').previousElementSibling, d.getElementById('u'));
    assert.equal(d.querySelectorAll('.tvrm-key-pill').length, 1, '只有一把钥匙');
});

test('扫描：找出各插件存的地址+密钥（含列表里的、嵌套的），跳过编号、关键词、我们自己', () => {
    const settings = {
        imageGen: { apiUrl: 'https://img.com/v1', apiKey: 'sk-img-123456', model: 'flux' },
        translator: { channels: [{ name: '翻译主力', endpoint: 'https://tr.com', token: 'tok-abc12345xyz' }, { name: '空的', endpoint: '', token: '' }] },
        stSecret: { api_key_custom: '0b5e7f1a-1234-4abc-9def-001122334455' },
        lore: { keyword: 'dragonslayer', key: 'short' },
        loneKey: { secret: 'sk-lonely-999' },
        quickReplyV2: { config: { setListDom: { jQuery3510623: { uiSortable: { document: [{ 'TH-script': { tavern_events: { SECRET_WRITTEN: 'secret_written', STREAM_TOKEN_RECEIVED_FULLY: 'js_stream_token_received_fully' }, localStorage: { 'x:token_meter:v1': '{"ver":1,"x":false}' } } }] } } } } },
        apiVault: { profiles: [{ stRef: { key: 'api_key_deepseek', id: 'x' } }] },
        events: { token: 'reasoning_token_received' },
        tavern_ruined_me_keys: { keys: [{ url: 'https://mine.com', key: 'sk-mine-0000' }] },
    };
    const r = scanSettings(settings, ['tavern_ruined_me_keys']);
    const by = n => r.find(f => f.source === n);
    assert.equal(by('imageGen').url, 'https://img.com/v1'); assert.equal(by('imageGen').key, 'sk-img-123456');
    assert.equal(by('translator').name, '翻译主力'); assert.match(by('translator').path, /channels › #1 › token/);
    assert.equal(by('loneKey').url, ''); assert.equal(by('loneKey').key, 'sk-lonely-999');
    assert.equal(by('stSecret'), undefined); assert.equal(by('lore'), undefined); assert.equal(by('tavern_ruined_me_keys'), undefined);
    assert.equal(r.length, 3);
});

test('扫描按钮：列出酒馆反代列表和插件里的，已有的不勾，勾了才收', () => {
    const x = setup(); const d = x.document; const box = d.getElementById('box');
    x.ctx.extensionSettings.imageGen = { apiUrl: 'https://img.com/v1', apiKey: 'sk-img-123456' };
    x.keeper.store().keys.push(newKey({ name: '已有', url: 'https://relay.com/v1', key: 'sk-relay-123' }));
    x.keeper.render(box);
    [...box.querySelectorAll('button')].find(b => b.textContent === '扫描').click();
    const rows = [...box.querySelectorAll('.tvrm-scan-row')];
    assert.equal(rows.length, 2);
    const relay = rows.find(r => /酒馆反代列表/.test(r.textContent)); assert.ok(relay.classList.contains('is-have')); assert.equal(relay.querySelector('input').checked, false);
    const img = rows.find(r => /imageGen/.test(r.textContent)); assert.equal(img.querySelector('input').checked, true);
    [...box.querySelectorAll('button')].find(b => b.textContent === '收进钥匙本').click();
    const keys = x.keeper.store().keys; assert.equal(keys.length, 2);
    assert.equal(keys[1].url, 'https://img.com/v1'); assert.match(keys[1].note, /imageGen/);
    assert.equal(box.querySelector('.tvrm-scan'), null);
});

test('小钥匙：页面滚动后还在、跟着框走；点到别处才收起', async () => {
    const x = setup(); const d = x.document; const win = x.dom.window;
    x.keeper.store().keys.push(newKey({ name: '主力', url: 'https://a.com/v1', key: 'sk-1' }));
    x.keeper.initFill();
    const u = d.getElementById('u'); u.focus();
    assert.ok(d.querySelector('.tvrm-key-pill'));
    win.dispatchEvent(new win.Event('scroll')); u.dispatchEvent(new win.Event('blur'));
    await new Promise(r => setTimeout(r, 30));
    assert.ok(d.querySelector('.tvrm-key-pill'), '滚动、失焦后还在');
    d.querySelector('.tvrm-key-pill').dispatchEvent(new win.Event('pointerdown', { bubbles: true }));
    assert.ok(d.querySelector('.tvrm-key-pill'), '按小钥匙不收起');
    d.getElementById('box').dispatchEvent(new win.Event('pointerdown', { bubbles: true }));
    assert.equal(d.querySelector('.tvrm-key-pill'), null, '点到别处收起');
});

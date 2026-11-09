// 排查已经删掉的聊天：世界书格和预设格共用的那一段
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const { JSDOM } = createRequire(process.env.JSDOM_DIR || '/tmp/jsd/')('jsdom');
import { findGone, renderSweep } from '../src/chatGroups.mjs';
import { createApp } from '../src/ui.mjs';

const c = { characters: [{ name: '甲', avatar: 'a.png' }, { name: '乙', avatar: 'b.png' }], groups: [{ id: 7, name: '群', chats: ['群聊1'] }] };
const listChats = async file => (file === 'a.png' ? new Set(['还在', '当前']) : null); // 乙查不了

test('找出删掉的聊天：角色的、整个删掉的角色、群聊的；当前聊天和查不了的不动', async () => {
    const keys = ['c:a.png|还在', 'c:a.png|删了', 'c:a.png|当前', 'c:b.png|不知道', 'c:gone.png|角色没了', 'g:7|群聊1', 'g:7|群聊2', 'g:9|群没了'];
    const r = await findGone(c, keys, 'c:a.png|当前', listChats);
    assert.deepEqual(r.gone.sort(), ['c:a.png|删了', 'c:gone.png|角色没了', 'g:7|群聊2', 'g:9|群没了'].sort());
    assert.equal(r.unsure, 1);
});

test('角色列表还没载出来：一个都不算删掉', async () => {
    const r = await findGone({ characters: [], groups: [] }, ['c:a.png|x', 'g:1|y'], null, listChats);
    assert.deepEqual(r.gone, []); assert.equal(r.unsure, 2);
});

test('排查那一块：列出来默认全勾，取消一个再删，只删勾着的', async () => {
    const { document } = new JSDOM('<body></body>').window;
    const h = (tag, attrs, ...kids) => { const el = document.createElement(tag); for (const [k, v] of Object.entries(attrs || {})) { if (k === 'class') el.className = v; else if (k.startsWith('on')) el.addEventListener(k.slice(2), v); else if (k === 'checked') el.checked = !!v; else el.setAttribute(k, v); } for (const kid of kids) if (kid) el.append(kid.nodeType ? kid : String(kid)); return el; };
    let deleted = null;
    const box = renderSweep({ h, c: () => c, keys: () => ['c:a.png|删了', 'g:7|群聊2', 'c:a.png|还在'], hereKey: () => null, listChats, what: '预设记录', onDelete: k => { deleted = k; } });
    document.body.append(box);
    box.querySelector('.tvrm-sweep-btn').click();
    await new Promise(r => setTimeout(r, 0)); await new Promise(r => setTimeout(r, 0));
    const boxes = box.querySelectorAll('.tvrm-sweep-row input');
    assert.equal(boxes.length, 2);
    boxes[1].checked = false;
    box.querySelector('.tvrm-delete').click();
    await new Promise(r => setTimeout(r, 0));
    assert.deepEqual(deleted, ['c:a.png|删了']);
});

test('世界书格：删聊天时一起删记录；开关关了就不删；当前聊天不删', async () => {
    const dom = new JSDOM('<body><div id="extensions_settings2"></div></body>');
    const ctx = { extensionSettings: {}, chatMetadata: {}, characterId: 0, chatId: 'now', characters: [{ name: '甲', avatar: 'a.png' }], saveSettingsDebounced() {}, saveMetadata() {} };
    const app = createApp({ document: dom.window.document, getContext: () => ctx, bindings: () => ({ global: [], charLore: [] }), worldNames: () => [], loadWorldInfo: async () => ({ entries: {} }), saveWorldInfo: async () => {}, toast() {}, chatInfo: () => ({ key: 'c:a.png|' + ctx.chatId }) });
    const index = app.settings().world.index;
    Object.assign(index, { 'c:a.png|old': { books: {} }, 'c:a.png|old2': { books: {} }, 'c:a.png|now': { books: {} } });
    assert.equal(app.onChatDeleted('c:a.png|old'), true);
    assert.equal(app.onChatDeleted('c:a.png|now'), false);
    app.settings().world.autoForget = false;
    assert.equal(app.onChatDeleted('c:a.png|old2'), false);
    assert.deepEqual(Object.keys(index).sort(), ['c:a.png|now', 'c:a.png|old2']);
});

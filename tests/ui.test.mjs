// 需要 jsdom（装在仓库外：npm i --prefix /tmp/jsd jsdom@26，再 NODE_PATH=/tmp/jsd/node_modules 运行）
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { JSDOM } = require('jsdom');
import { createApp } from '../src/ui.mjs';

function setup() {
    const dom = new JSDOM(`<body><div id="extensions_settings2"></div><div id="qr--bar"><div class="qr--buttons"></div></div>
      <select id="world_editor_select"><option value="0">A</option></select>
      <div id="world_popup_entries_list"><div class="world_entry" uid="1"><div name="entryKillSwitch" class="fa-toggle-on"></div></div>
      <div class="world_entry" uid="9"><div name="entryKillSwitch" class="fa-toggle-on"></div></div></div></body>`);
    const document = dom.window.document;
    globalThis.MutationObserver = dom.window.MutationObserver;
    const books = { A: { entries: {
        1: { uid: 1, comment: '常开条', key: ['a'], disable: true },
        3: { uid: 3, comment: '北方', key: ['n'], disable: false },
        4: { uid: 4, comment: '南方', key: ['s'], disable: true },
        9: { uid: 9, comment: '没管', key: [], disable: false } } } };
    const saved = [];
    const popups = [];
    const ctx = { extensionSettings: {}, chatMetadata: {}, chatId: 'c1', saveSettingsDebounced() {}, saveMetadataDebounced() {} };
    const timers = []; 
    const host = {
        document, getContext: () => ctx, worldNames: () => ['A'],
        loadWorldInfo: async n => JSON.parse(JSON.stringify(books[n])),
        saveWorldInfo: async (n, d) => { books[n] = JSON.parse(JSON.stringify(d)); saved.push(n); },
        popup: async el => { popups.push(el); return true; }, toast() {},
        timers: { setTimeout: (f, ms) => { timers.push({ f, ms }); return timers.length; }, clearTimeout: id => { timers[id - 1] = null; } },
    };
    const run = async () => { const t = timers.splice(0).filter(Boolean); for (const x of t) await x.f(); await new Promise(r => setTimeout(r, 5)); };
    return { app: createApp(host), ctx, books, saved, run, document, timers, popups };
}

test('面板：三个标签，后两个灰着；世界书可添加', () => {
    const { app, document } = setup();
    app.init();
    const tabs = [...document.querySelectorAll('.tvrm-tab')];
    assert.deepEqual(tabs.map(t => t.disabled), [false, true, true]);
    assert.ok(document.querySelector('#tvrm-drawer .inline-drawer-toggle'));
    assert.equal(document.querySelector('.tvrm-qr'), null, '聊天区不添加入口');
});

test('选择 → 存进聊天 → 合并写回原书一次 → 没变化不再存', async () => {
    const { app, ctx, books, saved, run, timers } = setup();
    const s = app.settings();
    s.world.books.A = { groups: [{ id: 'g1', name: '地区', desc: '选一个', mode: 'one' }], assign: { 1: 'on', 3: 'g1', 4: 'g1' }, writeBack: true, backup: null };
    app.init();
    await app.openPicker();                 // popup 自动点确定；新聊天按当前状态预选
    assert.deepEqual(ctx.chatMetadata.tavern_ruined_me.slots.world.groups.A.g1, ['3']);
    assert.equal(timers.filter(Boolean).length >= 1, true);
    await run();
    assert.equal(saved.length, 1);
    assert.equal(books.A.entries[1].disable, false);   // 常开
    assert.equal(books.A.entries[3].disable, false);
    assert.equal(books.A.entries[4].disable, true);
    assert.equal(books.A.entries[9].disable, false);   // 不管：没动
    assert.ok(s.world.books.A.backup, '第一次写回前整本备份');
    assert.equal(s.world.books.A.backup.data.entries[1].disable, true);
    app.scheduleWriteBack(); await run();
    assert.equal(saved.length, 1, '没变化不存');
});

test('切到另一个聊天按那个聊天再写一次', async () => {
    const { app, ctx, books, saved, run } = setup();
    const s = app.settings();
    s.world.books.A = { groups: [{ id: 'g1', name: '地区', desc: '', mode: 'one' }], assign: { 3: 'g1', 4: 'g1' }, writeBack: true, backup: null };
    ctx.chatMetadata = { tavern_ruined_me: { v: 1, slots: { world: { groups: { A: { g1: ['4'] } }, books: {} } } } };
    app.init(); app.onChatChanged(); await run();
    assert.equal(books.A.entries[3].disable, true);
    assert.equal(books.A.entries[4].disable, false);
    ctx.chatMetadata = { tavern_ruined_me: { v: 1, slots: { world: { groups: { A: { g1: ['3'] } }, books: {} } } } };
    ctx.chatId = 'c2'; app.onChatChanged(); await run();
    assert.equal(books.A.entries[3].disable, false);
    assert.equal(books.A.entries[4].disable, true);
    assert.equal(saved.length, 2);
});

test('生成时按聊天过滤；原生世界书页面开关、变暗、小字', async () => {
    const { app, ctx, document, run } = setup();
    const s = app.settings();
    s.world.books.A = { groups: [{ id: 'g1', name: '地区', desc: '', mode: 'one' }], assign: { 1: 'off', 3: 'g1' }, writeBack: true, backup: null };
    ctx.chatMetadata = { tavern_ruined_me: { v: 1, slots: { world: { groups: { A: { g1: [] } }, books: {} } } } };
    const payload = { globalLore: [{ world: 'A', uid: 1, disable: false }, { world: 'A', uid: 3, disable: false }, { world: 'A', uid: 9, disable: true }] };
    app.onEntriesLoaded(payload);
    assert.deepEqual(payload.globalLore.map(e => e.disable), [true, true, true]);
    app.init(); await run();
    const row = document.querySelector('.world_entry[uid="1"]');
    assert.ok(row.classList.contains('disabledWIEntry'));
    assert.ok(row.querySelector('[name="entryKillSwitch"]').classList.contains('fa-toggle-off'));
    assert.equal(row.querySelector('.tvrm-note-line').textContent, '聊天配置 · 会同步到原书');
    assert.equal(document.querySelector('.world_entry[uid="9"] .tvrm-note-line'), null, '不管的条目不动');
});

test('恢复备份：整本还原并暂停写回', async () => {
    const { app, books, run, document } = setup();
    const s = app.settings();
    s.world.books.A = { groups: [], assign: { 1: 'on' }, writeBack: true, backup: null };
    app.init(); app.scheduleWriteBack(); await run();
    assert.equal(books.A.entries[1].disable, false);
    app.mountPanel();
    // 备份出现后重画面板，↺ 按钮可点
    document.querySelector('.tvrm-tab').click();
    const btn = [...document.querySelectorAll('.tvrm-restore')].find(b => b.textContent === '恢复原书');
    assert.equal(btn.disabled, false);
    btn.click(); await run();
    assert.equal(books.A.entries[1].disable, true);
    assert.equal(s.world.books.A.restored, true);
    app.onChatChanged(); await run();
    assert.equal(books.A.entries[1].disable, true, '恢复结果不会被自动覆盖');
});

test('旧单选组自由勾选；旧关闭写回字段不再阻止同步', async () => {
    const { app, books, run, ctx } = setup();
    books.A.entries[4].disable = false;
    app.settings().world.books.A = { groups: [{ id: 'g', name: '分类', mode: 'one' }], assign: { 1: 'on', 3: 'g', 4: 'g' }, writeBack: false };
    await app.openPicker(); await run();
    assert.deepEqual(ctx.chatMetadata.tavern_ruined_me.slots.world.groups.A.g, ['3', '4']);
    assert.equal(books.A.entries[1].disable, false);
});
test('分类菜单包含新组；空分类说明可见且不弹空窗', async () => {
    const { app, document, run, popups } = setup();
    const cfg = { groups: [{ id: 'new', name: '新分类' }], assign: {} };
    app.settings().world.books.A = cfg;
    app.init();
    const card = document.querySelector('details.tvrm-card');
    card.open = true; card.dispatchEvent(new document.defaultView.Event('toggle')); await run();
    assert.ok([...document.querySelectorAll('.tvrm-bucket option')].some(o => o.value === 'new' && o.textContent === '新分类'));
    const box = document.createElement('div');
    await app.renderLoreView(box, { mode: 'pick', chat: { groups: {}, books: {} } });
    assert.match(box.textContent, /新分类/);
    assert.match(box.textContent, /还没有条目/);
    await app.openPicker();
    assert.equal(popups.length, 0, '空分类不弹空窗');
});
test('聊天切换兜底弹窗并去重，已配置聊天不弹', async () => {
    const { app, ctx, run } = setup();
    app.settings().world.books.A = { groups: [{ id: 'g', name: '分类' }], assign: { 3: 'g' } };
    app.onChatCreated(); app.onChatChanged(); await run();
    assert.ok(ctx.chatMetadata.tavern_ruined_me);
    const previous = ctx.chatMetadata.tavern_ruined_me;
    app.onChatChanged(); await run();
    assert.equal(ctx.chatMetadata.tavern_ruined_me, previous);
});

// jsdom 使用工作间已有的仓库外安装，不增加插件依赖。
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const { JSDOM } = createRequire(import.meta.url)('jsdom');
import { createApp } from '../src/ui.mjs';
const copy = x => JSON.parse(JSON.stringify(x));
function setup() {
    const dom = new JSDOM('<body><div id="extensions_settings2"></div></body>');
    const document = dom.window.document;
    const books = { A: { entries: {
        1: { uid: 1, comment: '条目一', content: '正文', key: ['a'], disable: false },
        2: { uid: 2, comment: '条目二', disable: true },
    } }, G: { entries: { 3: { uid: 3, disable: false } } }, Other: { entries: { 4: { uid: 4, disable: false } } } };
    const ctx = { extensionSettings: {}, chatMetadata: {}, characterId: 0, chatId: 'same-id',
        characters: [{ name: '同名', avatar: 'a.png', data: { extensions: { world: 'A' } } }, { name: '同名', avatar: 'other.png', data: { extensions: { world: 'Other' } } }],
        saveSettingsDebounced() {}, saveMetadata() { metadataSaves.push(ctx.chatMetadata); } };
    const saved = [], popups = [], metadataSaves = [], timers = [], toasts = [];
    const binding = { global: ['G'], charLore: [{ name: 'other', extraBooks: ['Other'] }] };
    const host = { document, getContext: () => ctx, bindings: () => binding, worldNames: () => Object.keys(books),
        loadWorldInfo: async n => copy(books[n]), saveWorldInfo: async (n, data) => { books[n] = copy(data); saved.push(n); },
        popup: async (el, ok) => { if (ok) return true; popups.push(el); document.body.append(el); return new Promise(() => {}); }, toast: (kind, message) => toasts.push([kind, message]),
        timers: { setTimeout: f => { timers.push(f); return timers.length; }, clearTimeout: id => { timers[id - 1] = null; } } };
    const app = createApp(host);
    const run = async () => { for (const f of timers.splice(0)) if (f) await f(); await app.whenIdle(); };
    const tick = async () => { await new Promise(r => setTimeout(r, 0)); await app.whenIdle(); };
    // 开关只在「这个聊天开哪些」弹窗里；没打开就先点按钮打开
    const find = label => [...document.querySelectorAll('.tvrm-popup input[type=checkbox]')].find(e => e.getAttribute('aria-label') === label);
    const toggle = async (label, checked) => {
        let input = find(label);
        if (!input) { [...document.querySelectorAll('.tvrm-actions button')][0].click(); await new Promise(r => setTimeout(r, 0)); await app.whenIdle(); input = find(label); }
        assert.ok(input, label); input.checked = checked; input.dispatchEvent(new dom.window.Event('change'));
    };
    return { app, ctx, host, binding, books, saved, popups, metadataSaves, document, run, tick, toggle, toasts };
}

test('仅当前角色主书和全局书；面板默认折叠；切换聊天不弹窗，新开聊天才弹一次', async () => {
    const { app, document, popups, tick } = setup();
    await app.init(); await app.onChatChanged();
    assert.equal(popups.length, 0);
    const cards = [...document.querySelectorAll('.tvrm-card')];
    assert.equal(cards.length, 2);
    assert.ok(cards.every(c => !c.open && !c.textContent.includes('Other')));
    assert.match(document.body.textContent, /未分类/);
    assert.equal(document.querySelector('.tvrm-group-settings'), null);
    await app.onChatCreated(); await tick();
    assert.equal(popups.length, 1);
    assert.match(popups[0].textContent, /条目一/);
    assert.equal(popups[0].querySelector('.tvrm-master'), null);
});

test('未分组开关立即保存元数据，首次修改备份；切回各聊天恢复各自状态', async () => {
    const { app, ctx, books, saved, metadataSaves, toggle } = setup();
    await app.init();
    const first = ctx.chatMetadata;
    await toggle('条目一', false); await app.whenIdle();
    assert.equal(books.A.entries[1].disable, true);
    assert.equal(first.tavern_ruined_me.slots.world.entries.A['1'], false);
    assert.ok(metadataSaves.includes(first));
    assert.equal(app.settings().world.books.A.backup.data.entries[1].disable, false);
    ctx.chatMetadata = {}; ctx.chatId = 'second'; await app.onChatChanged();
    const second = ctx.chatMetadata;
    await toggle('条目一', true); await app.whenIdle();
    assert.equal(books.A.entries[1].disable, false);
    ctx.chatMetadata = first; ctx.chatId = 'same-id'; await app.onChatChanged();
    assert.equal(books.A.entries[1].disable, true);
    assert.equal(second.tavern_ruined_me.slots.world.entries.A['1'], true);
    const count = saved.length; await app.flushWriteBack(); assert.equal(saved.length, count);
});

test('同名聊天的角色切换也隔离；读书过程中换窗不保存旧结果', async () => {
    const x = setup(); await x.app.init();
    let release; const original = x.host.loadWorldInfo;
    x.host.loadWorldInfo = n => n === 'A' ? new Promise(r => { release = () => r(copy(x.books[n])); }) : original(n);
    const old = x.app.onChatChanged(); await new Promise(r => setTimeout(r, 0));
    const previous = x.ctx.chatMetadata;
    x.ctx.characterId = 1; x.ctx.chatMetadata = {}; // chatId 故意相同
    const next = x.app.onChatChanged(); release(); await old; await next;
    assert.equal(x.app.settings().world.books.A.backup, null);
    assert.doesNotMatch(x.document.body.textContent, /条目一/);
    assert.ok(x.ctx.chatMetadata.tavern_ruined_me.slots.world.entries.Other);
    assert.notEqual(previous, x.ctx.chatMetadata);
});

test('外部修改优先：切回旧聊天不会用旧快照覆盖开场白的原书开关', async () => {
    const { app, ctx, books, toggle } = setup(); await app.init();
    const old = ctx.chatMetadata;
    await toggle('条目一', false); await app.whenIdle();
    ctx.chatMetadata = {}; ctx.chatId = 'second'; await app.onChatChanged();
    books.A.entries[1].disable = false; // 其它扩展在换开场白时改了原书
    ctx.chatMetadata = old; ctx.chatId = 'same-id'; await app.onChatChanged();
    assert.equal(books.A.entries[1].disable, false);
    assert.equal(old.tavern_ruined_me.slots.world.entries.A['1'], true);
});

test('全局绑定/聊天世界书变化先取当前实际状态，不回放旧选择；不显示其它角色书', async () => {
    const x = setup(); await x.app.init(); await x.toggle('条目一', false); await x.app.whenIdle();
    x.books.A.entries[1].disable = false;
    x.ctx.chatMetadata.world_info = 'different-opening';
    await x.app.onWorldChanged();
    assert.equal(x.books.A.entries[1].disable, false);
    x.binding.global = []; await x.app.onWorldChanged();
    assert.equal(x.document.querySelectorAll('.tvrm-card').length, 1);
});

test('生成前发现外部条目变化会采用新状态；新条目和未分组同样参与', async () => {
    const x = setup(); await x.app.init(); await x.toggle('条目一', false); await x.app.whenIdle();
    const payload = { characterLore: [{ world: 'A', uid: 1, disable: false }, { world: 'Other', uid: 4, disable: true }] };
    await x.app.onEntriesLoaded(payload);
    assert.deepEqual(payload.characterLore.map(e => e.disable), [false, true]);
    assert.equal(x.ctx.chatMetadata.tavern_ruined_me.slots.world.entries.A['1'], true);
});

test('分组是一排小标签；名称有保存反馈；删除需确认，条目回未分类', async () => {
    const x = setup(); await x.app.init();
    const cfg = x.app.settings().world.books.A;
    cfg.groups.push({ id: 'g', name: '旧组', desc: '不该出现的说明' }); cfg.assign['1'] = 'g'; x.app.renderPanel();
    assert.equal(x.document.querySelector('[aria-label="分组名称"]'), null);
    const chip = () => [...x.document.querySelectorAll('.tvrm-chip')].find(e => e.textContent.startsWith('旧组') || e.textContent.startsWith('新组'));
    chip().click();
    const input = x.document.querySelector('[aria-label="分组名称"]'); input.value = '新组';
    assert.equal(cfg.groups[0].name, '旧组');
    [...x.document.querySelectorAll('button')].find(e => e.textContent === '保存').click();
    assert.equal(cfg.groups[0].name, '新组'); assert.match(x.document.body.textContent, /已保存/);
    assert.doesNotMatch(x.document.body.textContent, /不该出现的说明/);
    const del = () => [...x.document.querySelectorAll('button')].find(e => e.textContent === '删除分组');
    x.host.popup = async () => false;
    del().click(); await x.tick(); assert.equal(cfg.groups.length, 1);
    x.host.popup = async () => true;
    del().click(); await x.tick(); assert.equal(cfg.groups.length, 0);
    assert.equal(cfg.assign['1'], undefined);
    x.document.querySelector('.tvrm-chip').click();
    assert.match(x.document.body.textContent, /未分类（2）/);
});

test('弹窗只有分了类和没分类的条目，没有分组设置和整本开关；新建的组选得到', async () => {
    const x = setup(); await x.app.init();
    const cfg = x.app.settings().world.books.A;
    [...x.document.querySelectorAll('.tvrm-chip-add')][0].click();
    assert.equal(cfg.groups.length, 1);
    x.document.querySelector('.tvrm-chip').click();
    const sel = x.document.querySelector('[aria-label="条目一归组"]'); sel.value = cfg.groups[0].id; sel.dispatchEvent(new x.document.defaultView.Event('change'));
    await x.toggle('条目一', true);
    const pop = x.document.querySelector('.tvrm-popup');
    assert.match(pop.textContent, /新分组 1（1）/); assert.match(pop.textContent, /未分类（1）/);
    assert.equal(pop.querySelector('.tvrm-master, .tvrm-group-settings, .tvrm-restore, .tvrm-chip'), null);
    await x.toggle('条目一', false); await x.app.whenIdle();
    assert.equal(x.books.A.entries[1].disable, true);
});

test('恢复原书在卡片最底下一行小字，需确认且不会被切聊天覆盖', async () => {
    const x = setup(); await x.app.init();
    await x.toggle('条目一', false); await x.app.whenIdle();
    assert.equal(x.document.querySelector('.tvrm-card .tvrm-foot .tvrm-restore').textContent, '恢复原书');
    x.document.querySelector('.tvrm-restore:not(.tvrm-delete)').click(); await x.tick();
    assert.equal(x.books.A.entries[1].disable, false);
    await x.app.onChatChanged(); assert.equal(x.books.A.entries[1].disable, false);
    assert.equal(x.app.settings().world.books.A.restored, true);
});

test('编辑只改名称关键词正文；并发内容更改不覆盖', async () => {
    const x = setup(); await x.app.init();
    x.host.popup = async el => { el.querySelector('textarea').value = '新正文'; return true; };
    x.document.querySelector('.tvrm-edit').click(); await x.tick();
    assert.equal(x.books.A.entries[1].content, '新正文'); assert.equal(x.books.A.entries[1].disable, false);
    x.host.popup = async el => { el.querySelector('textarea').value = '冲突内容'; x.books.A.entries[1].content = '外部内容'; return true; };
    x.document.querySelector('.tvrm-edit').click(); await x.tick();
    assert.equal(x.books.A.entries[1].content, '外部内容');
});

test('从面板移除需确认，保留备份并可重新显示', async () => {
    const x = setup(); await x.app.init(); await x.toggle('条目一', false); await x.app.whenIdle();
    x.document.querySelector('.tvrm-foot .tvrm-delete').click(); await x.tick();
    assert.equal(x.document.querySelectorAll('.tvrm-card').length, 1);
    assert.ok(x.app.settings().world.books.A.backup);
    const select = x.document.querySelector('[aria-label="重新显示世界书"]'); select.value = 'A'; select.dispatchEvent(new x.document.defaultView.Event('change')); await x.tick();
    assert.equal(x.document.querySelectorAll('.tvrm-card').length, 2);
});

test('保存请求中快速连续拨动和换窗，队列最终恢复目标聊天，不串写元数据', async () => {
    const x = setup(); await x.app.init();
    const first = x.ctx.chatMetadata;
    await x.toggle('条目一', true); await x.app.whenIdle();
    let release; const originalSave = x.host.saveWorldInfo;
    let held = true;
    x.host.saveWorldInfo = async (n, data) => {
        if (held) { held = false; await new Promise(r => { release = r; }); }
        return originalSave(n, data);
    };
    await x.toggle('条目一', false);
    await new Promise(r => setTimeout(r, 0));
    await x.toggle('条目一', true); await x.toggle('条目二', true);
    release(); await x.app.whenIdle();
    assert.deepEqual(Object.values(x.books.A.entries).map(e => e.disable), [false, false]);
    assert.equal(first.tavern_ruined_me.slots.world.entries.A['1'], true);
    held = true; await x.toggle('条目一', false); await new Promise(r => setTimeout(r, 0));
    x.ctx.chatId = 'new'; x.ctx.chatMetadata = {};
    const next = x.app.onChatChanged(); release(); await next;
    assert.notEqual(x.ctx.chatMetadata, first);
    assert.equal(first.tavern_ruined_me.slots.world.entries.A['1'], false);
});

test('原生页面重建后开关同步；空世界书选择不能误认作第一本', async () => {
    const x = setup(); await x.app.init();
    x.document.body.insertAdjacentHTML('beforeend', '<select id="world_editor_select"><option value="">无</option><option value="0">A</option></select><div id="world_popup_entries_list"><div class="world_entry" uid="1"><i name="entryKillSwitch"></i></div></div>');
    await x.tick(); await x.run();
    assert.equal(x.document.querySelector('.tvrm-note-line'), null);
    const select = x.document.getElementById('world_editor_select'); select.value = '0'; select.dispatchEvent(new x.document.defaultView.Event('change', { bubbles: true })); await x.run();
    assert.match(x.document.querySelector('.tvrm-note-line').textContent, /聊天配置/);
    assert.ok(x.document.querySelector('[name=entryKillSwitch]').classList.contains('fa-toggle-on'));
});

async function selectBook(x, name) {
    const select = x.document.querySelector('[aria-label="管理其他世界书"]');
    select.value = name; select.dispatchEvent(new x.document.defaultView.Event('change'));
    await x.app.whenIdle();
}

test('旧配置原组原归属原备份保留；旧的整本开关书改按条目分类并接过备份；管理其他书不写原书或聊天', async () => {
    const x = setup();
    const backup = { at: 123, data: copy(x.books.Other) };
    const legacy = { groups: [{ id: 'old', name: '原来的组' }], assign: { 4: 'old' }, backup, custom: '保留' };
    x.ctx.extensionSettings.tavern_ruined_me = { world: { books: { Other: copy(legacy), A: { groups: [], assign: {}, mode: 'whole' } }, wholeBooks: ['G'], wholeMeta: { G: { backup: { at: 456, data: copy(x.books.G) } } } } };
    await x.app.init();
    const chat = copy(x.ctx.chatMetadata);
    await selectBook(x, 'Other');
    const card = [...x.document.querySelectorAll('.tvrm-card')].at(-1);
    assert.match(card.textContent, /原来的组/); assert.match(card.textContent, /分类 1 · 未分类 0/);
    assert.deepEqual(x.ctx.chatMetadata, chat);
    assert.equal(x.saved.length, 0);
    const cfg = x.app.settings().world.books.Other;
    assert.deepEqual(cfg.groups, legacy.groups); assert.deepEqual(cfg.assign, legacy.assign);
    assert.deepEqual(cfg.backup, backup); assert.equal(cfg.custom, '保留');
    assert.equal(x.app.settings().world.books.G.backup.at, 456);
    assert.equal(x.app.settings().world.wholeMeta.G.backup.at, 456);
    // 带 mode:'whole' 的旧书也照样出现分类
    assert.ok([...x.document.querySelectorAll('.tvrm-card')].every(c => c.querySelector('.tvrm-chips')));
});

test('未绑定书可归类编辑，但切聊天和生成不自动接管；弹窗只含绑定的书', async () => {
    const x = setup(); await x.app.init();
    await selectBook(x, 'Other');
    const card = () => [...x.document.querySelectorAll('.tvrm-card')].at(-1);
    const sel = card().querySelector('[aria-label="条目 #4归组"]'); sel.value = 'off'; sel.dispatchEvent(new x.document.defaultView.Event('change')); await x.app.whenIdle();
    assert.equal(x.books.Other.entries[4].disable, true);
    assert.equal(x.ctx.chatMetadata.tavern_ruined_me.slots.world.entries.Other, undefined);
    x.host.popup = async el => { el.querySelector('textarea').value = '手动编辑'; return true; };
    card().querySelector('.tvrm-edit').click(); await x.tick();
    assert.equal(x.books.Other.entries[4].content, '手动编辑');
    x.books.Other.entries[4].disable = false;
    x.ctx.chatId = 'next'; x.ctx.chatMetadata = {}; await x.app.onChatChanged();
    assert.equal(x.books.Other.entries[4].disable, false);
    const payload = { characterLore: [{ world: 'Other', uid: 4, disable: false }] };
    await x.app.onEntriesLoaded(payload); assert.equal(payload.characterLore[0].disable, false);
    x.host.popup = async (el, ok) => { x.popups.push(el); return new Promise(() => {}); };
    [...x.document.querySelectorAll('.tvrm-actions button')][0].click(); await x.tick();
    const popup = x.popups.at(-1);
    assert.equal(popup.querySelectorAll('.tvrm-pop-book').length, 2);
    assert.doesNotMatch(popup.textContent, /Other/);
});

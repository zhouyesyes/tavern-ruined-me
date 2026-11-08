// jsdom 使用工作间已有的仓库外安装，不增加插件依赖。
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const { JSDOM } = createRequire(process.env.JSDOM_DIR || '/tmp/jsd/')('jsdom');
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

test('仅当前角色主书和全局书；面板默认折叠；任何时候都不自动弹窗', async () => {
    const { app, document, popups, tick } = setup();
    await app.init(); await app.onChatChanged();
    assert.equal(popups.length, 0);
    const cards = [...document.querySelectorAll('.tvrm-card[data-zone="bound"]')];
    assert.equal(cards.length, 2);
    assert.ok(cards.every(c => !c.open && !c.textContent.includes('Other')));
    assert.match(cards[0].querySelector('summary').textContent, /分类0 · 开1\/2/);
    assert.equal(document.querySelector('.tvrm-group-settings'), null);
    assert.equal(document.querySelector('[aria-label="管理其他世界书"]'), null);
    await app.onChatCreated(); await tick();
    assert.equal(popups.length, 0);
    // 面板里「这个聊天开哪些」按钮还在，点了才有弹窗
    [...document.querySelectorAll('.tvrm-actions button')][0].click(); await tick();
    assert.equal(popups.length, 1);
    assert.match(popups[0].textContent, /条目一/);
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
    assert.doesNotMatch([...x.document.querySelectorAll('.tvrm-card[data-zone="bound"]')].map(c => c.textContent).join(''), /条目一/);
    assert.ok(x.ctx.chatMetadata.tavern_ruined_me.slots.world.entries.Other);
    assert.notEqual(previous, x.ctx.chatMetadata);
});

test('切回旧聊天：以这个聊天自己存的选择为准，别的插件动过原书也不冲掉', async () => {
    const { app, ctx, books, toggle } = setup(); await app.init();
    const old = ctx.chatMetadata;
    await toggle('条目一', false); await app.whenIdle();
    ctx.chatMetadata = {}; ctx.chatId = 'second'; await app.onChatChanged();
    books.A.entries[1].disable = false; // 同时开着的别的插件把原书改回去了
    ctx.chatMetadata = old; ctx.chatId = 'same-id'; await app.onChatChanged();
    assert.equal(books.A.entries[1].disable, true);
    assert.equal(old.tavern_ruined_me.slots.world.entries.A['1'], false);
});

test('聊天里手拨原生开关 / 脚本存书改了开关：记进当前聊天，下次进来恢复', async () => {
    const { app, ctx, books, run } = setup(); await app.init();
    const first = ctx.chatMetadata;
    books.A.entries[2].disable = false; // 在原生世界书页面手动打开条目二
    app.onWorldChanged(); await run();
    assert.equal(first.tavern_ruined_me.slots.world.entries.A['2'], true);
    ctx.chatMetadata = {}; ctx.chatId = 'second'; await app.onChatChanged();
    assert.equal(books.A.entries[2].disable, false); // 新聊天：沿用现状
    books.A.entries[2].disable = true; app.onWorldChanged(); await run(); // 开场白脚本关掉
    assert.equal(ctx.chatMetadata.tavern_ruined_me.slots.world.entries.A['2'], false);
    ctx.chatMetadata = first; ctx.chatId = 'same-id'; await app.onChatChanged();
    assert.equal(books.A.entries[2].disable, false);
});

test('全局绑定/聊天世界书变化先取当前实际状态，不回放旧选择；不显示其它角色书', async () => {
    const x = setup(); await x.app.init(); await x.toggle('条目一', false); await x.app.whenIdle();
    x.books.A.entries[1].disable = false;
    x.ctx.chatMetadata.world_info = 'different-opening';
    await x.app.onWorldChanged();
    assert.equal(x.books.A.entries[1].disable, false);
    x.binding.global = []; await x.app.onWorldChanged();
    assert.equal(x.document.querySelectorAll('.tvrm-card[data-zone="bound"]').length, 1);
});

test('生成前只把本聊天的选择套到条目副本，不把副本里别人的临时改动记进聊天', async () => {
    const x = setup(); await x.app.init(); await x.toggle('条目一', false); await x.app.whenIdle();
    const payload = { characterLore: [{ world: 'A', uid: 1, disable: false }, { world: 'Other', uid: 4, disable: true }] };
    await x.app.onEntriesLoaded(payload);
    assert.deepEqual(payload.characterLore.map(e => e.disable), [true, true]);
    assert.equal(x.ctx.chatMetadata.tavern_ruined_me.slots.world.entries.A['1'], false);
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

test('条目右边只有归类下拉和展开箭头；展开只读显示关键词和正文，不能改；状态一眼可见', async () => {
    const x = setup(); await x.app.init();
    assert.equal(x.document.querySelector('.tvrm-edit'), null);
    assert.ok(![...x.document.querySelectorAll('button')].some(b => b.textContent === '编辑'));
    const states = [...x.document.querySelectorAll('.tvrm-card')[0].querySelectorAll('.tvrm-state')].map(e => e.textContent);
    assert.deepEqual(states, ['开', '关']);
    assert.equal(x.document.querySelector('.tvrm-detail'), null);
    x.document.querySelector('[aria-label="条目一展开内容"]').click();
    const d = x.document.querySelector('.tvrm-detail');
    assert.match(d.textContent, /关键词a/); assert.match(d.textContent, /正文/);
    assert.equal(d.querySelector('input, textarea'), null);
    x.app.renderPanel(); assert.ok(x.document.querySelector('.tvrm-detail')); // 重画后仍展开
    x.document.querySelector('[aria-label="条目一展开内容"]').click();
    assert.equal(x.document.querySelector('.tvrm-detail'), null);
});

test('从面板移除需确认，保留备份并可重新显示', async () => {
    const x = setup(); await x.app.init(); await x.toggle('条目一', false); await x.app.whenIdle();
    x.document.querySelector('.tvrm-foot .tvrm-delete').click(); await x.tick();
    assert.equal(x.document.querySelectorAll('.tvrm-card[data-zone="bound"]').length, 1);
    assert.ok(x.app.settings().world.books.A.backup);
    const select = x.document.querySelector('[aria-label="重新显示世界书"]'); select.value = 'A'; select.dispatchEvent(new x.document.defaultView.Event('change')); await x.tick();
    assert.equal(x.document.querySelectorAll('.tvrm-card[data-zone="bound"]').length, 2);
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

test('旧配置原组原归属原备份保留；旧的整本开关书改按条目分类并接过备份；分过类没绑的书直接列出，不写原书或聊天', async () => {
    const x = setup();
    const backup = { at: 123, data: copy(x.books.Other) };
    const legacy = { groups: [{ id: 'old', name: '原来的组' }], assign: { 4: 'old' }, backup, custom: '保留' };
    x.ctx.extensionSettings.tavern_ruined_me = { world: { books: { Other: copy(legacy), A: { groups: [], assign: {}, mode: 'whole' } }, wholeBooks: ['G'], wholeMeta: { G: { backup: { at: 456, data: copy(x.books.G) } } } } };
    await x.app.init();
    const cards = [...x.document.querySelectorAll('.tvrm-card[data-zone="all"]')];
    assert.equal(cards.length, 3);
    const card = cards.at(-1);
    assert.match(card.querySelector('summary').textContent, /Other/); assert.match(card.querySelector('summary').textContent, /点开读取|分类/);
    assert.match(card.textContent, /原来的组/); assert.match(card.querySelector('summary').textContent, /分类1/);
    assert.equal(x.saved.length, 0);
    const cfg = x.app.settings().world.books.Other;
    assert.deepEqual(cfg.groups, legacy.groups); assert.deepEqual(cfg.assign, legacy.assign);
    assert.deepEqual(cfg.backup, backup); assert.equal(cfg.custom, '保留');
    assert.equal(x.app.settings().world.books.G.backup.at, 456);
    assert.equal(x.app.settings().world.wholeMeta.G.backup.at, 456);
    assert.ok(cards.every(c => c.querySelector('.tvrm-chips')));
    assert.equal(x.ctx.chatMetadata.tavern_ruined_me.slots.world.entries.Other, undefined);
});

test('未分类也没绑的书不出现；分过类没绑的书可归类，但切聊天和生成不自动接管；弹窗只含绑定的书', async () => {
    const x = setup();
    x.ctx.extensionSettings.tavern_ruined_me = { world: { books: { Other: { groups: [{ id: 'old', name: '组' }], assign: {} } } } };
    await x.app.init();
    assert.equal(x.document.querySelectorAll('.tvrm-card[data-zone="all"]').length, 3);
    const card = () => [...x.document.querySelectorAll('.tvrm-card[data-zone="all"]')].at(-1);
    const sel = card().querySelector('[aria-label="条目 #4归组"]'); sel.value = 'off'; sel.dispatchEvent(new x.document.defaultView.Event('change')); await x.app.whenIdle();
    assert.equal(x.books.Other.entries[4].disable, true);
    assert.equal(x.ctx.chatMetadata.tavern_ruined_me.slots.world.entries.Other, undefined);
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

test('跟着聊天走：A 改民国，切 B 仍是现代；B 改，切回 A 是民国；来回切 3 次都对（含酒馆晚到的事件）', async () => {
    const x = setup(); await x.app.init();
    // 条目一=现代，条目二=民国；A 聊天先改成民国
    const metaA = x.ctx.chatMetadata;
    const lateEvents = () => { setTimeout(() => x.app.onWorldChanged(), 0); }; // 酒馆保存后晚到的更新事件
    const saveOrig = x.host.saveWorldInfo;
    x.host.saveWorldInfo = async (n, d) => { await saveOrig(n, d); lateEvents(); };
    await x.toggle('条目一', false); await x.toggle('条目二', true); await x.app.whenIdle();
    assert.deepEqual([x.books.A.entries[1].disable, x.books.A.entries[2].disable], [true, false]);
    // B：另一个聊天，自己存的是现代（条目一开、条目二关）
    const metaB = { tavern_ruined_me: { v: 1, slots: { world: { groups: {}, books: { A: true, G: true }, entries: { A: { 1: true, 2: false }, G: { 3: true } } } } } };
    const sw = async (meta, id) => {
        x.ctx.chatMetadata = meta; x.ctx.chatId = id;
        const p = x.app.onChatChanged();
        x.app.onWorldChanged(); // 切换中酒馆又发更新事件：上锁期间不许记
        await p; await x.run(); await new Promise(r => setTimeout(r, 5)); await x.run();
    };
    const modern = () => [x.books.A.entries[1].disable, x.books.A.entries[2].disable];
    for (let i = 0; i < 3; i++) {
        await sw(metaB, 'B');
        assert.deepEqual(modern(), [false, true], 'B 应是现代 第' + i);
        assert.deepEqual(metaB.tavern_ruined_me.slots.world.entries.A, { 1: true, 2: false });
        if (i === 0) { // B 自己改成民国再改回现代
            await x.toggle('条目一', false); await x.toggle('条目二', true); await x.app.whenIdle();
            await x.toggle('条目一', true); await x.toggle('条目二', false); await x.app.whenIdle();
        }
        await sw(metaA, 'A');
        assert.deepEqual(modern(), [true, false], 'A 应是民国 第' + i);
        assert.deepEqual(metaA.tavern_ruined_me.slots.world.entries.A, { 1: false, 2: true });
    }
});

test('跟着聊天走：切聊天写回到一半，别的插件把书改回上个聊天的样子并发更新事件，不能记进新聊天，且最后原书回到新聊天的样子', async () => {
    const x = setup(); await x.app.init();
    await x.toggle('条目一', false); await x.toggle('条目二', true); await x.app.whenIdle(); // A 民国
    const metaA = x.ctx.chatMetadata;
    const metaB = { tavern_ruined_me: { v: 1, slots: { world: { groups: {}, books: { A: true, G: true }, entries: { A: { 1: true, 2: false }, G: { 3: true } } } } } };
    const modern = () => [x.books.A.entries[1].disable, x.books.A.entries[2].disable];
    const orig = x.host.loadWorldInfo;
    let meddle = false, fired = 0;
    x.host.loadWorldInfo = async n => {
        // 写回 A 之后读 G 的时候：别的插件把 A 又改回民国，并通知世界书更新了
        if (meddle && n === 'G' && fired++ === 1) { x.books.A.entries[1].disable = true; x.books.A.entries[2].disable = false; x.app.onWorldChanged(); }
        return orig(n);
    };
    const sw = async (meta, id) => { x.ctx.chatMetadata = meta; x.ctx.chatId = id; await x.app.onChatChanged(); await x.run(); await x.run(); };
    for (let i = 0; i < 3; i++) {
        meddle = i === 0; fired = 0;
        await sw(metaB, 'B');
        meddle = false;
        assert.deepEqual(modern(), [false, true], 'B 原书应是现代 第' + i);
        assert.deepEqual(metaB.tavern_ruined_me.slots.world.entries.A, { 1: true, 2: false }, 'B 配置仍是现代 第' + i);
        await sw(metaA, 'A');
        assert.deepEqual(modern(), [true, false], 'A 原书应是民国 第' + i);
        assert.deepEqual(metaA.tavern_ruined_me.slots.world.entries.A, { 1: false, 2: true });
    }
});

test('面板分两块：这个聊天绑定的（角色/聊天/全局三小段）和所有世界书；面板里没有开关', async () => {
    const x = setup();
    x.ctx.chatMetadata = { world_info: 'Other' };
    await x.app.init();
    const text = x.document.querySelector('.tvrm-panel').textContent;
    assert.match(text, /这个聊天绑定的/); assert.match(text, /角色世界书（1）/); assert.match(text, /聊天世界书（1）/); assert.match(text, /全局世界书（1）/);
    assert.match(text, /所有世界书（3）/);
    assert.equal(x.document.querySelectorAll('.tvrm-card[data-zone="bound"]').length, 3);
    assert.equal(x.document.querySelectorAll('.tvrm-card[data-zone="all"]').length, 3);
    assert.equal(x.document.querySelector('.tvrm-panel input[type=checkbox]'), null);
    assert.ok([...x.document.querySelectorAll('.tvrm-card')].every(c => !c.open));
});

test('没开聊天：不显示「这个聊天绑定的」，所有世界书照样全列、点开能读到条目并分类，不写原书', async () => {
    const x = setup();
    x.ctx.chatId = undefined; x.ctx.characterId = undefined; x.ctx.chatMetadata = undefined;
    await x.app.init(); await x.tick();
    const panel = x.document.querySelector('.tvrm-panel');
    assert.doesNotMatch(panel.textContent, /正在读取当前聊天/); assert.doesNotMatch(panel.textContent, /这个聊天绑定的/);
    assert.equal(x.document.querySelector('.tvrm-actions'), null);
    const cards = [...x.document.querySelectorAll('.tvrm-card[data-zone="all"]')];
    assert.equal(cards.length, 3);
    const other = cards.find(c => c.dataset.book === 'Other');
    other.open = true; other.dispatchEvent(new x.document.defaultView.Event('toggle')); await x.tick(); await x.tick();
    const sel = x.document.querySelector('[data-book="Other"] [aria-label="条目 #4归组"]');
    assert.ok(sel);
    sel.value = 'off'; sel.dispatchEvent(new x.document.defaultView.Event('change')); await x.tick();
    assert.equal(x.books.Other.entries[4].disable, false); // 没开聊天，不改原书
    assert.equal(x.app.settings().world.books.Other.assign['4'], 'off');
    assert.equal(x.saved.length, 0);
});

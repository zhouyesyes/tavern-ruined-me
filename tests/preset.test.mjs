import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const { JSDOM } = createRequire(process.env.JSDOM_DIR || '/tmp/jsd/')('jsdom');
import { createPresetKeeper, applyOrder, snapshotOrder, newRecord, saveAs, switchTo, renameSave, deleteSave } from '../src/preset.mjs';
const o = (id, on = true) => ({ identifier: id, enabled: on });

// 模拟真酒馆的预设接口（照 SillyTavern openai.js / PromptManager.js 的行为）：
// - 换预设：先同步改 preset_settings_openai，再异步（等别的扩展处理完，故意拖慢）把预设自带的 prompt_order 整个换进来，
//   最后发 OAI_PRESET_CHANGED_AFTER；完成信号是 getPresetApplicationPromise()
// - 写回顺序：原地改数组，saveServiceSettings 在 SETTINGS_UPDATED 事件时才结束
// - 预设下拉里没有的名字：select 抛错
function setup(slow = 25) {
    const dom = new JSDOM('<body><div id="r"></div></body>'); const document = dom.window.document;
    const presets = { P1: [o('a'), o('b', false), o('c')], P2: [o('x'), o('y'), o('z', false)], '拉刻西斯V1.72': [o('m'), o('n', false)], '小狗之神': [o('p', false), o('q')] };
    const s = { name: 'P1', order: presets.P1.map(x => ({ ...x })) };
    const ctx = { extensionSettings: {}, saveSettingsDebounced() {} }; let chat = { key: 'A', label: '聊天A' };
    let keeper; let applying = Promise.resolve(); const toasts = [];
    const sleep = ms => new Promise(r => setTimeout(r, ms));
    const host = { document, getContext: () => ctx, chatInfo: () => chat, confirm: async () => true, prompt: async (t, v) => v + '改', toast: (k, m) => toasts.push([k, m]),
        preset: { name: () => s.name, order: () => s.order.map(x => ({ ...x })),
            setOrder: async v => { s.order.splice(0, s.order.length, ...v.map(x => ({ ...x }))); await sleep(5); keeper.onPresetEvent(); }, // 存完才发 SETTINGS_UPDATED
            select: async n => {
                if (!(n in presets)) throw new Error('酒馆里找不到预设「' + n + '」');
                s.name = n; // onSettingsPresetChange 一进来就改名字
                applying = (async () => { await sleep(slow); s.order = presets[n].map(x => ({ ...x })); keeper.onPresetEvent(); await sleep(2); keeper.onPresetEvent(); })();
                await applying; // getPresetApplicationPromise()
            },
            entryName: id => '条目' + id } };
    keeper = createPresetKeeper(host);
    const tick = () => new Promise(r => setTimeout(r, 5));
    const enter = async (key, label) => { chat = { key, label }; const p = keeper.onChatChanged(); keeper.onPresetEvent(); await p; await tick(); };
    const manual = async (name, order) => { // 她在预设页手动改：先改酒馆里的状态，再收到事件
        if (name !== s.name) { s.name = name; s.order = presets[name].map(x => ({ ...x })); } if (order) s.order = order; keeper.onPresetEvent(); };
    // 酒馆真实的顺序：先换「当前聊天」，中间来一次 SETTINGS_UPDATED（预设还是旧的），再发 CHAT_CHANGED
    const enterLikeTavern = async (key, label) => { chat = { key, label }; keeper.onPresetEvent(); const p = keeper.onChatChanged(); keeper.onPresetEvent(); await p; await tick(); };
    return { keeper, s, presets, enter, enterLikeTavern, manual, tick, document, ctx, toasts };
}
const on = s => s.order.map(x => x.identifier + (x.enabled ? '+' : '-')).join(',');

test('纯逻辑：后加的条目保留，删掉的跳过；顺序按存的来', () => {
    const merged = applyOrder([o('a'), o('c'), o('n', false)], [{ id: 'c', on: false }, { id: 'gone', on: true }, { id: 'a', on: true }]);
    assert.deepEqual(merged.map(x => x.identifier + x.enabled), ['cfalse', 'atrue', 'nfalse']);
});

test('A、B 两个聊天各用不同预设，来回切 3 次都对（含切换中和晚到的事件）', async () => {
    const x = setup();
    await x.enter('A', '聊天A'); // 新聊天：沿用 P1
    await x.manual('P1', [o('c'), o('a', false), o('b', true)]); // A 里手动开关+拖顺序
    await x.enter('B', '聊天B');
    assert.equal(x.s.name, 'P1'); // B 新聊天沿用现状（此时现状是 A 留下的），算 B 的起点
    await x.manual('P2'); await x.manual('P2', [o('z'), o('x', false), o('y')]);
    for (let i = 0; i < 3; i++) {
        await x.enter('A', '聊天A'); assert.equal(x.s.name, 'P1', 'A 预设 ' + i); assert.equal(on(x.s), 'c+,a-,b+', 'A ' + i);
        await x.enter('B', '聊天B'); assert.equal(x.s.name, 'P2', 'B 预设 ' + i); assert.equal(on(x.s), 'z+,x-,y+', 'B ' + i);
    }
    const chats = x.keeper.store().chats;
    assert.equal(chats.A.preset, 'P1'); assert.equal(chats.B.preset, 'P2');
});

test('存档：另存、切换（上一套）、改名、删除；自动记不碰存档', async () => {
    const x = setup(); await x.enter('A', '聊天A');
    const chat = x.keeper.store().chats.A;
    const first = saveAs(chat, ''); assert.equal(first.name, '存档一'); assert.equal(saveAs(chat, '').name, '存档二');
    await x.manual('P1', [o('b'), o('a'), o('c', false)]); // 自动记改了在用
    assert.equal(chat.saves[0].order.map(v => v.id).join(''), 'abc'); // 存档没被碰
    await x.keeper.doSwitch(first.id);
    assert.equal(on(x.s), 'a+,b-,c+'); assert.equal(chat.saves.filter(s => s.previous).length, 1);
    assert.equal(chat.saves.find(s => s.previous).order.map(v => v.id).join(''), 'bac');
    assert.ok(chat.saves.find(s => s.id === first.id)); // 存档本身还在
    await x.keeper.doSwitch(chat.saves.find(s => s.name === '存档二').id); // 再切：上一套被换成最近一份
    assert.equal(chat.saves.filter(s => s.previous).length, 1);
    assert.ok(renameSave(chat, first.id, '民国夜'));
    assert.ok(deleteSave(chat, first.id)); assert.equal(chat.saves.some(s => s.id === first.id), false);
});

test('预设改了不乱：套回时后加的条目保留，删掉的跳过', async () => {
    const x = setup(); await x.enter('A', '聊天A'); await x.manual('P1', [o('c'), o('a'), o('b', false)]);
    await x.enter('B', '聊天B');
    x.presets.P1 = [o('a'), o('c'), o('b', false), o('n', false)].filter(v => v.identifier !== 'b'); // b 删了，n 新加
    await x.manual('P1', x.presets.P1.map(v => ({ ...v })));
    await x.enter('A', '聊天A'); await x.enter('B', '聊天B'); await x.enter('A', '聊天A');
    assert.ok(on(x.s).includes('n-')); assert.ok(!on(x.s).includes('b'));
});

test('面板：聊天名和预设名上下两行；没有聊天时整块不显示', async () => {
    const x = setup(); const root = x.document.getElementById('r'); x.keeper.render(root);
    assert.equal(root.textContent, ''); // 空的就什么都不放
    await x.enter('A', '聊天A'); x.keeper.render(root);
    const sum = root.querySelector('.tvrm-page > summary');
    assert.equal(sum.children.length, 2); assert.match(sum.children[0].textContent, /^A（当前）$/); assert.match(sum.children[1].textContent, /P1/); // 聊天名取 key 里的那段
});

test('面板：总面板默认折叠、一行小字；点开聊天看在用和存档，再点开看条目', async () => {
    const x = setup(); await x.enter('A', '聊天A'); saveAs(x.keeper.store().chats.A, '');
    const root = x.document.getElementById('r'); x.keeper.render(root);
    const page = root.querySelector('.tvrm-page'); assert.ok(!page.open);
    assert.match(page.querySelector('summary').textContent, /A.*P1.*存档1套/);
    assert.equal(page.querySelectorAll('.tvrm-set').length, 2);
    assert.match(page.textContent, /条目a/);
});

test('存档一记的是拉刻西斯V1.72、在用是小狗之神：切到存档一后，酒馆真的换成拉刻西斯V1.72，在用也变成它', async () => {
    const x = setup(); await x.enter('A', '聊天A');
    const chat = x.keeper.store().chats.A;
    await x.manual('拉刻西斯V1.72', [o('n'), o('m', false)]);
    const first = saveAs(chat, ''); assert.equal(first.preset, '拉刻西斯V1.72');
    await x.manual('小狗之神', [o('q', false), o('p')]);
    assert.equal(chat.preset, '小狗之神');
    await x.keeper.doSwitch(first.id); await x.tick();
    assert.equal(x.s.name, '拉刻西斯V1.72'); assert.equal(on(x.s), 'n+,m-');
    assert.equal(chat.preset, '拉刻西斯V1.72'); assert.equal(chat.active.order.map(v => v.id + (v.on ? '+' : '-')).join(','), 'n+,m-');
    assert.equal(chat.saves.find(v => v.previous).preset, '小狗之神'); // 原来那套存成了「上一套」
    await new Promise(r => setTimeout(r, 40)); // 酒馆晚到的事件也不能把它冲掉
    assert.equal(chat.preset, '拉刻西斯V1.72'); assert.equal(on(x.s), 'n+,m-');
});

test('预设加载很慢（别的扩展拖着）也不会被冲掉；预设被删了就提示、不改记录', async () => {
    const x = setup(120); await x.enter('A', '聊天A'); await x.manual('P1', [o('c'), o('a', false), o('b')]);
    await x.enter('B', '聊天B'); await x.manual('P2', [o('z'), o('x', false), o('y')]);
    await x.enter('A', '聊天A'); assert.equal(x.s.name, 'P1'); assert.equal(on(x.s), 'c+,a-,b+');
    await x.enter('B', '聊天B'); assert.equal(x.s.name, 'P2'); assert.equal(on(x.s), 'z+,x-,y+');
    const chat = x.keeper.store().chats.B; const sv = saveAs(chat, ''); chat.saves[0].preset = '已删除的预设';
    await x.keeper.doSwitch(sv.id); await x.tick();
    assert.equal(chat.preset, 'P2'); assert.equal(chat.saves.some(v => v.previous), false); assert.ok(x.toasts.some(t => t[0] === 'error'));
    await x.enter('A', '聊天A'); await x.enter('B', '聊天B'); assert.equal(x.s.name, 'P2');
});

test('连着切聊天：每次都上锁，最后停在最后一个聊天自己的预设', async () => {
    const x = setup(); await x.enter('A', '聊天A'); await x.manual('P1', [o('c'), o('a'), o('b', false)]);
    await x.enter('B', '聊天B'); await x.manual('P2');
    const picks = ['A', 'B', 'A', 'B', 'A']; let last;
    for (const k of picks) { chat_switch(x, k); }
    function chat_switch(x, k) { last = (async () => { await x.enter(k, '聊天' + k); })(); }
    await last; await x.keeper.whenIdle(); await x.tick();
    assert.equal(x.s.name, 'P1'); assert.equal(on(x.s), 'c+,a+,b-');
    assert.equal(x.keeper.store().chats.B.preset, 'P2');
});

test('存档点名字改名：输入框 + 保存，保存才生效', async () => {
    const x = setup(); await x.enter('A', '聊天A'); const chat = x.keeper.store().chats.A; saveAs(chat, '');
    const root = x.document.getElementById('r'); x.keeper.render(root);
    root.querySelector('.tvrm-page').open = true; const set = root.querySelectorAll('.tvrm-set')[1];
    set.querySelector('.tvrm-rename').click();
    const input = set.querySelector('input'); assert.ok(input); input.value = '民国夜';
    assert.equal(chat.saves[0].name, '存档一'); // 没点保存还没变
    [...set.querySelectorAll('button')].find(b => b.textContent === '保存').click();
    assert.equal(chat.saves[0].name, '民国夜');
});

test('切聊天时酒馆先换当前聊天、中间来一次设置事件：不能把旧预设记到新聊天名下', async () => {
    const x = setup();
    await x.enterLikeTavern('A', '聊天A');
    await x.enterLikeTavern('B', '聊天B'); await x.manual('P2'); // B 用 P2
    for (let i = 0; i < 3; i++) {
        await x.enterLikeTavern('A', '聊天A'); assert.equal(x.s.name, 'P1', 'A ' + i);
        await x.enterLikeTavern('B', '聊天B'); assert.equal(x.s.name, 'P2', 'B ' + i);
    }
    const chats = x.keeper.store().chats; assert.equal(chats.A.preset, 'P1'); assert.equal(chats.B.preset, 'P2');
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const { JSDOM } = createRequire(process.env.JSDOM_DIR || '/tmp/jsd/')('jsdom');
import { createPresetKeeper, applyOrder, snapshotOrder, newRecord, saveAs, switchTo, renameSave, deleteSave } from '../src/preset.mjs';
const o = (id, on = true) => ({ identifier: id, enabled: on });

// 模拟酒馆：两个预设各有自己的条目，当前预设的开关/顺序在 cur 里
function setup() {
    const dom = new JSDOM('<body><div id="r"></div></body>'); const document = dom.window.document;
    const presets = { P1: [o('a'), o('b', false), o('c')], P2: [o('x'), o('y'), o('z', false)] };
    const s = { name: 'P1', order: presets.P1.map(x => ({ ...x })) };
    const ctx = { extensionSettings: {}, saveSettingsDebounced() {} }; let chat = { key: 'A', label: '聊天A' };
    let keeper;
    const host = { document, getContext: () => ctx, chatInfo: () => chat, confirm: async () => true, prompt: async (t, v) => v + '改',
        preset: { name: () => s.name, order: () => s.order.map(x => ({ ...x })),
            setOrder: async v => { s.order = v.map(x => ({ ...x })); setTimeout(() => keeper.onPresetEvent(), 0); }, // 晚到的事件
            select: async n => { s.name = n; s.order = presets[n].map(x => ({ ...x })); setTimeout(() => keeper.onPresetEvent(), 0); },
            entryName: id => '条目' + id } };
    keeper = createPresetKeeper(host);
    const tick = () => new Promise(r => setTimeout(r, 5));
    const enter = async (key, label) => { chat = { key, label }; const p = keeper.onChatChanged(); keeper.onPresetEvent(); await p; await tick(); };
    const manual = async (name, order) => { // 她在预设页手动改：先改酒馆里的状态，再收到事件
        if (name !== s.name) { s.name = name; s.order = presets[name].map(x => ({ ...x })); } if (order) s.order = order; keeper.onPresetEvent(); };
    return { keeper, s, presets, enter, manual, tick, document, ctx };
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

test('面板：总面板默认折叠、一行小字；点开聊天看在用和存档，再点开看条目', async () => {
    const x = setup(); await x.enter('A', '聊天A'); saveAs(x.keeper.store().chats.A, '');
    const root = x.document.getElementById('r'); x.keeper.render(root);
    const page = root.querySelector('.tvrm-page'); assert.ok(!page.open);
    assert.match(page.querySelector('summary').textContent, /聊天A.*P1.*存档1套/);
    assert.equal(page.querySelectorAll('.tvrm-set').length, 2);
    assert.match(page.textContent, /条目a/);
});

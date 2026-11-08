import test from 'node:test';
import assert from 'node:assert/strict';
import * as C from '../src/core.mjs';

const mk = () => {
    const s = C.normalizeSettings({});
    const cfg = C.newBookCfg();
    cfg.groups = [{ id: 'g1', name: '地区', desc: '', mode: 'one' }, { id: 'g2', name: '势力', desc: '', mode: 'any' }];
    cfg.assign = { 1: 'on', 2: 'off', 3: 'g1', 4: 'g1', 5: 'g2' };
    s.world.books.A = cfg;
    s.world.wholeBooks.push('W');
    return s;
};

test('桶：常开常关不管', () => {
    const s = mk();
    assert.equal(C.resolveEntry(s, null, 'A', 1), true);
    assert.equal(C.resolveEntry(s, null, 'A', 2), false);
    assert.equal(C.resolveEntry(s, null, 'A', 9), null);
});
test('自定义组：没选过照书，选过按选择', () => {
    const s = mk();
    assert.equal(C.resolveEntry(s, null, 'A', 3), null);
    const chat = { groups: { A: { g1: ['4'], g2: [] } }, books: {} };
    assert.equal(C.resolveEntry(s, chat, 'A', 3), false);
    assert.equal(C.resolveEntry(s, chat, 'A', 4), true);
    assert.equal(C.resolveEntry(s, chat, 'A', 5), false);
});
test('整本开关：关=全关；开=还原书原来的', () => {
    const s = mk();
    assert.equal(C.resolveEntry(s, { books: { W: false } }, 'W', 1, false), false);
    assert.equal(C.resolveEntry(s, { books: { W: true } }, 'W', 1, false), true);
    assert.equal(C.resolveEntry(s, { books: { W: true } }, 'W', 1, true), false);
    assert.equal(C.resolveEntry(s, {}, 'W', 1), null);
});
test('每个聊天各存各的，三格互不干扰', () => {
    const m1 = {}, m2 = {};
    C.setChatSlot(m1, 'world', { a: 1 });
    C.setChatSlot(m1, 'preset', { p: 1 });
    assert.deepEqual(C.getChatSlot(m1, 'world'), { a: 1 });
    assert.equal(C.getChatSlot(m2, 'world'), null);
    assert.deepEqual(C.getChatSlot(m1, 'preset'), { p: 1 });
    assert.equal(C.getChatSlot(m1, 'api'), null);
});
test('新聊天沿用酒馆当前状态', () => {
    const s = mk();
    const chat = C.seedWorldChat(s, {
        A: [{ uid: 3, disable: true }, { uid: 4, disable: false }, { uid: 5, disable: false }],
        W: [{ uid: 1, disable: true }],
    });
    assert.deepEqual(chat.groups.A.g1, ['4']);
    assert.deepEqual(chat.groups.A.g2, ['5']);
    assert.equal(chat.books.W, false);
});
test('写回计划：只改有差别的；没变化是空', () => {
    const s = mk();
    const chat = { groups: { A: { g1: ['4'], g2: ['5'] } }, books: {} };
    const data = { entries: {
        1: { uid: 1, disable: true }, 2: { uid: 2, disable: false },
        3: { uid: 3, disable: false }, 4: { uid: 4, disable: true }, 5: { uid: 5, disable: false }, 9: { uid: 9, disable: true },
    } };
    const plan = C.planWriteBack(s, chat, 'A', data);
    assert.deepEqual(plan.sort((a, b) => a.uid - b.uid), [
        { uid: 1, disable: false }, { uid: 2, disable: true }, { uid: 3, disable: true }, { uid: 4, disable: false }]);
    for (const c of plan) data.entries[c.uid].disable = c.disable;
    assert.deepEqual(C.planWriteBack(s, chat, 'A', data), []);
});
test('写回计划：整本开→关→开 能还原；旧关闭写回仍同步', () => {
    const s = mk();
    const orig = { entries: { 1: { uid: 1, disable: false }, 2: { uid: 2, disable: true } } };
    s.world.wholeMeta.W = { writeBack: true, backup: C.snapshotBook(orig) };
    const data = JSON.parse(JSON.stringify(orig));
    for (const c of C.planWriteBack(s, { books: { W: false } }, 'W', data)) data.entries[c.uid].disable = c.disable;
    assert.deepEqual(Object.values(data.entries).map(e => e.disable), [true, true]);
    for (const c of C.planWriteBack(s, { books: { W: true } }, 'W', data)) data.entries[c.uid].disable = c.disable;
    assert.deepEqual(Object.values(data.entries).map(e => e.disable), [false, true]);
    s.world.wholeMeta.W.writeBack = false;
    assert.deepEqual(C.planWriteBack(s, { books: { W: false } }, 'W', data), [{ uid: 1, disable: true }]);
});
test('防抖：连拨合成一次', () => {
    const q = []; let n = 0;
    const fake = { setTimeout: f => { q.push(f); return q.length; }, clearTimeout: id => { q[id - 1] = null; } };
    const d = C.createDebouncer(() => n++, 800, fake);
    d(); d(); d();
    q.filter(Boolean).forEach(f => f());
    assert.equal(n, 1);
});
test('删组后条目回到不管', () => {
    const s = mk(); const cfg = s.world.books.A;
    C.removeGroup(cfg, 'g1');
    assert.equal(C.bucketOf(cfg, 3), 'free');
    assert.equal(C.bucketOf(cfg, 1), 'on');
});

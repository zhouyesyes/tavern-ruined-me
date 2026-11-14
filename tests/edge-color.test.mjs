import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const { JSDOM } = createRequire(process.env.JSDOM_DIR || '/tmp/jsd/')('jsdom');
import { createEdgeColor } from '../src/edge-color.mjs';
import { edgePixels } from '../src/native-edge.mjs';
import { normalizeTidy } from '../src/tidy.mjs';
const tick = () => new Promise(resolve => setTimeout(resolve, 0));

test('两种模式不改变壁纸、主题样式、按钮和日间页面，关闭发布恢复请求', async () => {
    const dom = new JSDOM('<head><style>body{background-color:white}</style></head><body><div id="bg1" style="background-image:url(old.png)"></div><button>发送</button></body>');
    const doc = dom.window.document, before = doc.documentElement.outerHTML, modes = [];
    const edge = createEdgeColor(doc, async mode => { modes.push(mode); });
    for (const mode of ['dark', 'soft', 'off']) { edge.apply(mode); await tick(); assert.equal(doc.documentElement.outerHTML, before); }
    assert.deepEqual(modes, ['dark', 'soft', 'off']);
    edge.destroy(); dom.window.close();
});

test('主题及背景改变重新取样，关闭后停止观察', async () => {
    const dom = new JSDOM('<body><div id="bg1"></div></body>'); let count = 0;
    const edge = createEdgeColor(dom.window.document, async () => { count++; });
    edge.apply('dark'); await tick();
    dom.window.document.documentElement.className = 'day';
    await new Promise(r => setTimeout(r, 300)); assert.equal(count, 2);
    edge.apply('off'); await tick();
    dom.window.document.documentElement.className = 'night';
    await new Promise(r => setTimeout(r, 300)); assert.equal(count, 3);
    edge.destroy(); dom.window.close();
});

test('切换时旧取样失效，原生操作串行，最后关闭恢复', async () => {
    const dom = new JSDOM('<body></body>');
    let finish, valid; const modes = [];
    const edge = createEdgeColor(dom.window.document, async (mode, isCurrent) => {
        modes.push(mode);
        if (mode === 'dark') { valid = isCurrent; await new Promise(r => { finish = r; }); }
    });
    edge.apply('dark'); edge.apply('soft'); edge.apply('off');
    assert.equal(valid(), false); finish(); await tick();
    assert.deepEqual(modes, ['dark', 'off']);
    edge.destroy(); dom.window.close();
});

test('接口失败不改网页并明确提示，重试成功清除错误', async () => {
    const dom = new JSDOM('<body></body>'); let fail = true; const messages = [];
    const before = dom.window.document.documentElement.outerHTML;
    const edge = createEdgeColor(dom.window.document, async () => { if (fail) throw Error('unsupported'); }, m => messages.push(m));
    edge.apply('soft'); await tick(); assert.match(messages.at(-1), /未同步/);
    assert.equal(dom.window.document.documentElement.outerHTML, before);
    fail = false; await edge.retry(); assert.equal(messages.at(-1), '');
    edge.destroy(); await tick(); dom.window.close();
});

const snapshot = { width: 4, height: 6, insets: { top: 2, bottom: 2, left: 0, right: 0 } };
const rows = { top: Uint8ClampedArray.from([0,0,0,255,0,0,0,255,240,230,220,255,240,230,220,255]), bottom: Uint8ClampedArray.from([10,20,30,255,10,20,30,255,255,250,245,255,255,250,245,255]) };
test('平板按每列保留左右分区、日间浅色和不同的上下颜色，不画进网页', () => {
    const data = edgePixels(snapshot, rows, 'dark', [100,100,100]);
    const pixel = (x, y) => [...data.slice((y * 4 + x) * 4, (y * 4 + x + 1) * 4)];
    assert.deepEqual(pixel(0, 0), [0,0,0,255]);
    assert.deepEqual(pixel(3, 0), [240,230,220,255]);
    assert.deepEqual(pixel(3, 5), [255,250,245,255]);
    assert.deepEqual(pixel(0, 2), [0,0,0,0]);
});
test('渐变只在原生区域变化，与网页相接的第一行保持精确颜色', () => {
    const data = edgePixels(snapshot, rows, 'soft', [100,100,100]);
    assert.deepEqual([...data.slice(4 * 4, 4 * 4 + 4)], [0,0,0,255]);
    assert.deepEqual([...data.slice(0, 4)], [12,12,12,255]);
    assert.deepEqual([...data.slice(2 * 4 * 4, 4 * 4 * 4)], Array(32).fill(0));
    assert.deepEqual([...data.slice(4 * 4 * 4, 4 * 4 * 4 + 4)], [10,20,30,255]);
});
test('旧设置默认关闭，未知值不能开启效果', () => {
    assert.equal(normalizeTidy({}).edgeColor, 'off');
    assert.equal(normalizeTidy({ edgeColor: 'bad' }).edgeColor, 'off');
    assert.equal(normalizeTidy({ edgeColor: 'soft' }).edgeColor, 'soft');
});

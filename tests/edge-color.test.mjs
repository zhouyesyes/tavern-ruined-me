import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const { JSDOM } = createRequire(process.env.JSDOM_DIR || '/tmp/jsd/')('jsdom');
import { createEdgeColor } from '../src/edge-color.mjs';
import { edgePixels, toolbarColor } from '../src/native-edge.mjs';
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
const color = [0,0,0];
test('顶部图标栏只取一个背景色，外层所有列和上下同色，不画进网页', () => {
    const data = edgePixels(snapshot, color, 'dark', [100,100,100]);
    const pixel = (x, y) => [...data.slice((y * 4 + x) * 4, (y * 4 + x + 1) * 4)];
    assert.deepEqual(pixel(0, 0), [0,0,0,255]);
    assert.deepEqual(pixel(3, 0), [0,0,0,255]);
    assert.deepEqual(pixel(3, 5), [0,0,0,255]);
    assert.deepEqual(pixel(0, 2), [0,0,0,0]);
    const light = edgePixels(snapshot, [240,230,220], 'dark', [255,255,255]);
    assert.deepEqual([...light.slice(0,4)], [240,230,220,255]);
});
test('渐变只在原生区域变化，与网页相接的第一行保持精确颜色', () => {
    const data = edgePixels(snapshot, color, 'soft', [100,100,100]);
    assert.deepEqual([...data.slice(4 * 4, 4 * 4 + 4)], [0,0,0,255]);
    assert.deepEqual([...data.slice(0, 4)], [12,12,12,255]);
    assert.deepEqual([...data.slice(2 * 4 * 4, 4 * 4 * 4)], Array(32).fill(0));
    assert.deepEqual([...data.slice(4 * 4 * 4, 4 * 4 * 4 + 4)], [0,0,0,255]);
});
test('旧设置默认关闭，未知值不能开启效果', () => {
    assert.equal(normalizeTidy({}).edgeColor, 'off');
    assert.equal(normalizeTidy({ edgeColor: 'bad' }).edgeColor, 'off');
    assert.equal(normalizeTidy({ edgeColor: 'soft' }).edgeColor, 'soft');
});

test('自选颜色只改变渐变外端，接缝保留实际取样；统一模式忽略自选色', () => {
    const target = '#abcdef';
    const data = edgePixels(snapshot, color, 'soft', [100,100,100], target);
    assert.deepEqual([...data.slice(0,4)], [171,205,239,255]);
    assert.deepEqual([...data.slice(4*4,4*4+4)], [0,0,0,255]);
    assert.deepEqual([...data.slice(4*4*4,4*4*4+4)], [0,0,0,255]);
    assert.deepEqual([...data.slice(5*4*4,5*4*4+4)], [171,205,239,255]);
    assert.deepEqual(edgePixels(snapshot, color, 'dark', [100,100,100], target), edgePixels(snapshot, color, 'dark', [100,100,100]));
    assert.equal(normalizeTidy({ edgeGradientColor:'#ABCDEF' }).edgeGradientColor, '#abcdef');
    assert.equal(normalizeTidy({ edgeGradientColor:'bad' }).edgeGradientColor, null);
});

test('同一渐变模式换颜色也重新发布，并能恢复自动配色', async () => {
    const dom = new JSDOM('<body></body>'), requests = [];
    const edge = createEdgeColor(dom.window.document, async (mode, current, color) => { requests.push([mode,color]); });
    edge.apply('soft', '#ABCDEF'); await tick();
    edge.apply('soft', '#123456'); await tick();
    edge.apply('soft', null); await tick();
    assert.deepEqual(requests, [['soft','#abcdef'], ['soft','#123456'], ['soft',null]]);
    edge.destroy(); await tick(); dom.window.close();
});

test('图标栏主背景色不受少量图标、文字和图片杂色干扰', () => {
    const pixels = Uint8ClampedArray.from([8,8,9,255,200,150,170,255,8,8,9,255,255,255,255,255,8,8,9,255]);
    assert.deepEqual(toolbarColor(pixels), [8,8,9]);
    assert.deepEqual(toolbarColor(Uint8ClampedArray.from([243,239,230,255,20,20,20,255,243,239,230,255])), [243,239,230]);
    assert.throws(() => toolbarColor(new Uint8ClampedArray(4)), /未能识别/);
});

test('前台恢复立即重放缓存，合并焦点事件，不等待重新取样；关闭后不再重放', async () => {
    const dom = new JSDOM('<body></body>', { pretendToBeVisual:true });
    let sampled = 0, replayed = 0;
    const edge = createEdgeColor(dom.window.document, async () => { sampled++; }, () => {}, async valid => { assert.equal(valid(), true); replayed++; });
    edge.apply('dark'); await tick(); assert.equal(sampled, 1);
    dom.window.dispatchEvent(new dom.window.Event('focus'));
    dom.window.dispatchEvent(new dom.window.Event('pageshow'));
    dom.window.document.dispatchEvent(new dom.window.Event('visibilitychange'));
    await tick();
    assert.ok(replayed >= 1); assert.equal(sampled, 1);
    await new Promise(r => setTimeout(r, 300)); assert.equal(sampled, 2);
    edge.apply('off'); await tick(); const before = replayed;
    dom.window.dispatchEvent(new dom.window.Event('focus')); await tick(); assert.equal(replayed, before);
    edge.destroy(); dom.window.close();
});

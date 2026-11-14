import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const { JSDOM } = createRequire(process.env.JSDOM_DIR || '/tmp/jsd/')('jsdom');
import { createEdgeColor } from '../src/edge-color.mjs';
import { normalizeTidy } from '../src/tidy.mjs';
const tick = () => new Promise(resolve => setTimeout(resolve, 0));

test('两种颜色切换、同步，以及恢复期间更新的原壁纸', async () => {
    const dom = new JSDOM('<head><style>body{background-color:blue}</style></head><body><div id="bg1" style="background-image:url(old.png)"></div></body>');
    const doc = dom.window.document;
    let calls = 0;
    const edge = createEdgeColor(doc, async () => { calls++; });
    edge.apply('dark'); await tick();
    assert.equal(doc.defaultView.getComputedStyle(doc.body).backgroundColor, 'rgb(16, 16, 18)');
    assert.equal(doc.defaultView.getComputedStyle(doc.getElementById('bg1')).display, 'none');
    edge.apply('soft'); await tick();
    assert.ok(doc.getElementById('tvrm-edge-fade'));
    assert.equal(doc.defaultView.getComputedStyle(doc.body).backgroundColor, 'rgb(80, 59, 67)');
    doc.getElementById('bg1').style.backgroundImage = 'url(new.png)'; await tick();
    edge.apply('off'); await tick();
    assert.equal(doc.getElementById('tvrm-edge-fade'), null);
    assert.equal(doc.defaultView.getComputedStyle(doc.body).backgroundColor, 'rgb(0, 0, 255)');
    assert.match(doc.getElementById('bg1').style.backgroundImage, /new.png/);
    assert.notEqual(doc.defaultView.getComputedStyle(doc.getElementById('bg1')).display, 'none');
    assert.ok(calls >= 4);
    edge.destroy(); dom.window.close();
});

test('宿主不可用时明确报告，重试成功清除提示，销毁移除覆盖', async () => {
    const dom = new JSDOM('<body></body>');
    let fail = true; const messages = [];
    const edge = createEdgeColor(dom.window.document, async () => { if (fail) throw Error('unsupported'); }, m => messages.push(m));
    edge.apply('soft'); await tick();
    assert.match(messages.at(-1), /同步失败/);
    fail = false; await edge.retry();
    assert.equal(messages.at(-1), '');
    edge.destroy(); await tick();
    assert.equal(dom.window.document.querySelector('style'), null);
    assert.equal(dom.window.document.body.className, '');
    dom.window.close();
});

test('老设置默认关闭，未知值不能开启效果', () => {
    assert.equal(normalizeTidy({}).edgeColor, 'off');
    assert.equal(normalizeTidy({ edgeColor: 'bad' }).edgeColor, 'off');
    assert.equal(normalizeTidy({ edgeColor: 'soft' }).edgeColor, 'soft');
});

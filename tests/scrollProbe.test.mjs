import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { createScrollProbe } from '../src/scrollProbe.mjs';
const { JSDOM } = createRequire('/tmp/jsd/')('jsdom');
test('持续触摸和滚动均记录，保持默认行为，停止后不再收集', () => {
 const dom = new JSDOM('<div id="right-nav-panel"><div id="rm_print_characters_block"></div></div>');
 const doc=dom.window.document, el=doc.getElementById('rm_print_characters_block');
 const p=createScrollProbe(doc);p.start();
 const send=name=>{const e=new dom.window.Event(name,{bubbles:true,cancelable:true});Object.defineProperty(e,'touches',{value:[{}]});el.dispatchEvent(e);assert.equal(e.defaultPrevented,false);};
 send('touchstart');for(let i=0;i<5;i++){send('touchmove');send('scroll');}send('touchend');
 assert.match(p.report(),/移动事件 5，滚动事件 5/);
 p.stop();const before=p.report();send('touchstart');send('touchmove');assert.equal(p.report(),before);p.destroy();dom.window.close();
});

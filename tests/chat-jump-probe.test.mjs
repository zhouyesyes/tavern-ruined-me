import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { createChatJumpProbe } from '../src/chat-jump-probe.mjs';
const { JSDOM } = createRequire(process.env.JSDOM_DIR || '/tmp/jsd/')('jsdom');
const page = () => new JSDOM('<div id="chat"><div class="mes" mesid="8"><div class="mes_text">PRIVATE_MESSAGE_SENTINEL</div></div></div>', { pretendToBeVisual:true });
test('滚动命令原样执行，来源被记录；停止恢复原描述符且不读正文', () => {
 const dom=page(),doc=dom.window.document,root=doc.getElementById('chat');
 let receiver=null,args=null; const original=function(...values){receiver=this;args=values;this.scrollTop=values[0].top;return 42;}; root.scrollTo=original;
 const beforeTop=Object.getOwnPropertyDescriptor(root,'scrollTop'),beforeTo=Object.getOwnPropertyDescriptor(root,'scrollTo');
 const probe=createChatJumpProbe(doc,()=>({autoBottom:true}));probe.start();
 function hostLateScroll(){return root.scrollTo({top:512,behavior:'auto'});}
 assert.equal(hostLateScroll(),42);assert.equal(root.scrollTop,512);assert.equal(receiver,root);assert.deepEqual(args,[{top:512,behavior:'auto'}]);
 const report=probe.report();assert.match(report,/scrollTo命令/);assert.match(report,/scrollTop命令/);assert.match(report,/hostLateScroll/);assert.doesNotMatch(report,/PRIVATE_MESSAGE_SENTINEL|https?:/);
 probe.stop();assert.equal(root.scrollTop,512);assert.deepEqual(Object.getOwnPropertyDescriptor(root,'scrollTop'),beforeTop);assert.deepEqual(Object.getOwnPropertyDescriptor(root,'scrollTo'),beforeTo);
 const frozen=probe.report();root.scrollTop=123;assert.equal(probe.report(),frozen);probe.destroy();dom.window.close();
});
test('停止不会覆盖其他扩展随后安装的方法；记录有界且支持聊天切换', () => {
 const dom=page(),doc=dom.window.document,root=doc.getElementById('chat');root.scrollTo=function(){};
 const probe=createChatJumpProbe(doc);probe.start();for(let i=0;i<520;i++)root.scrollTop=i;
 probe.chatChanged();const other=function(){};root.scrollTo=other;probe.stop();
 assert.equal(root.scrollTo,other);assert.match(probe.report(),/记录 500 条/);assert.match(probe.report(),/聊天切换/);assert.doesNotMatch(probe.report(),/PRIVATE_MESSAGE_SENTINEL/);dom.window.close();
});
test('触摸不会被取消，销毁后不再收集', () => {
 const dom=page(),doc=dom.window.document,root=doc.getElementById('chat'),probe=createChatJumpProbe(doc);probe.start();
 const event=new dom.window.Event('touchstart',{bubbles:true,cancelable:true});root.dispatchEvent(event);assert.equal(event.defaultPrevented,false);assert.match(probe.report(),/touchstart/);
 probe.destroy();assert.equal(probe.running,false);dom.window.close();
});

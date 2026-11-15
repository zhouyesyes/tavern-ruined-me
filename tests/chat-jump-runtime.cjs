const {chromium}=require(process.env.PLAYWRIGHT_DIR||'/tmp/jsd/node_modules/playwright-core');
const fs=require('node:fs');const path=require('node:path');const assert=require('node:assert/strict');
(async()=>{const browser=await chromium.launch({executablePath:'/usr/bin/chromium',headless:true,args:['--no-sandbox']});
try{for(const width of [390,1280]){const page=await browser.newPage({viewport:{width,height:800}});
await page.route('http://probe.test/**',route=>{const url=new URL(route.request().url());return route.fulfill(url.pathname.endsWith('.mjs')?{contentType:'text/javascript',body:fs.readFileSync(path.join(__dirname,'..','src','chat-jump-probe.mjs'),'utf8')}:{contentType:'text/html',body:'<style>#chat{height:400px;width:100%;overflow:auto;overflow-anchor:none}.mes_text{height:120px}</style><div id="chat">'+Array.from({length:25},(_,i)=>`<div class="mes" mesid="${i}"><div class="mes_text">PRIVATE_SENTINEL_${i}</div></div>`).join('')+'</div>'});});
await page.goto('http://probe.test/');const result=await page.evaluate(async()=>{
const {createChatJumpProbe}=await import('/chat-jump-probe.mjs');const root=document.getElementById('chat'),original=root.scrollTo,probe=createChatJumpProbe(document,()=>({autoBottom:true,visualNovel:false}));
root.scrollTop=450;const before=root.scrollTop;probe.start();if(root.scrollTop!==before)throw Error('Starting moved chat');
await new Promise(r=>setTimeout(r,80));function hostLateScroll(){root.scrollTo({top:1500,behavior:'instant'});}hostLateScroll();
await new Promise(r=>setTimeout(r,80));root.querySelector('.mes_text').style.height='600px';await new Promise(r=>setTimeout(r,80));
probe.chatChanged();const during=root.scrollTop;probe.stop();return {report:probe.report(),during,after:root.scrollTop,restored:root.scrollTo===original,ownTop:Object.hasOwn(root,'scrollTop')};});
assert.equal(result.during,1500);assert.equal(result.after,1500);assert.equal(result.restored,true);assert.equal(result.ownTop,false);assert.match(result.report,/hostLateScroll/);assert.match(result.report,/高度变化/);assert.match(result.report,/聊天切换/);assert.doesNotMatch(result.report,/PRIVATE_SENTINEL/);console.log(`PASS ${width}px: native calls forwarded; delayed height changes traced; position unchanged; descriptors restored; no message text`);await page.close();}
}finally{await browser.close();}})().catch(e=>{console.error(e);process.exitCode=1;});

const {chromium}=require(process.env.PLAYWRIGHT_DIR||'playwright');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const fixture=fs.readFileSync(path.join(__dirname,'tidy.test.mjs'),'utf8').match(/const PAGE = `([\s\S]+?)`;/)[1];
(async()=>{const browser=await chromium.launch({executablePath:'/usr/bin/chromium',args:['--no-sandbox']});try{
for(const width of [390,1133]){
 const page=await browser.newPage({viewport:{width,height:844}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.route('http://extensions.test/**',route=>{const name=path.basename(new URL(route.request().url()).pathname);return route.fulfill(name.endsWith('.mjs')?{contentType:'text/javascript',body:fs.readFileSync(path.join(__dirname,'..','src',name),'utf8')}:{contentType:'text/html',body:fixture});});
 await page.goto('http://extensions.test/');
 await page.evaluate(async()=>{const {createTidy,TIDY}=await import('/tidy.mjs');const ctx={extensionSettings:{[TIDY]:{on:true,extOpen:true}},saveSettingsDebounced(){}};window.tidy=createTidy({document,getContext:()=>ctx});tidy.init();});
 assert.equal(await page.locator('#sd_container').isVisible(),false);
 await page.evaluate(()=>{const container=document.getElementById('sd_container');window.nativeContainer=container;window.nativeParent=container.parentElement;window.nativeClicks=0;container.innerHTML='<div class="inline-drawer"><div class="inline-drawer-header"><b>Image Generation</b></div><button id="native-settings">原生设置</button></div>';document.getElementById('native-settings').addEventListener('click',()=>nativeClicks++);});
 await page.waitForFunction(()=>document.getElementById('sd_container').parentElement.classList.contains('tvrm-tidy-extbody')&&!document.getElementById('sd_container').classList.contains('tvrm-tidy-gone'));
 assert(await page.locator('#native-settings').isVisible());await page.locator('#native-settings').click();assert.equal(await page.evaluate(()=>nativeClicks),1);
 await page.evaluate(()=>{tidy.restore();});assert(await page.locator('#native-settings').isVisible());
 assert(await page.evaluate(()=>nativeContainer===document.getElementById('sd_container')&&nativeContainer.parentElement===nativeParent));
 await page.locator('#native-settings').click();assert.equal(await page.evaluate(()=>nativeClicks),2);
 await page.evaluate(()=>tidy.destroy());assert.deepEqual(errors,[]);await page.close();
 console.log(`PASS ${width}px: asynchronously filled built-in panel becomes visible inside fold; native nodes, actions and restore preserved`);
}
}finally{await browser.close();}})().catch(e=>{console.error(e);process.exitCode=1;});

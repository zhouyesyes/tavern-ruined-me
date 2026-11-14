// Run: node tests/edge-color-runtime.cjs (external playwright-core + system Chromium).
const { chromium } = require(process.env.PLAYWRIGHT_DIR || '/tmp/jsd/node_modules/playwright-core');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
(async () => {
 const browser = await chromium.launch({ executablePath: '/usr/bin/chromium', headless: true, args: ['--no-sandbox'] });
 try {
  for (const width of [390, 1280]) for (const day of [false, true]) {
   const page = await browser.newPage({ viewport: { width, height: 776 } });
   const right = day ? '#f3efe6' : '#080809', left = day ? '#f8e5ed' : '#292126';
   await page.route('http://edge.test/**', async route => {
    const pathname = new URL(route.request().url()).pathname;
    if (pathname.endsWith('.mjs')) return route.fulfill({ contentType: 'text/javascript', body: fs.readFileSync(path.join(__dirname, '..', 'src', path.basename(pathname)), 'utf8') });
    if (pathname.endsWith('.svg')) return route.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><rect width="100" height="100" fill="#947b83"/><circle cx="50" cy="50" r="35" fill="#d9b8c8"/></svg>' });
    return route.fulfill({ contentType: 'text/html', body: `<style>body{margin:0;background:${right}}#bg1{position:fixed;inset:0;z-index:-1;background-size:cover}header,footer{height:44px;display:flex;background:${right}}aside{width:${width > 700 ? 28 : 0}%;background:${left}}main{height:688px;background:linear-gradient(transparent,#0003)}button{margin:8px 20px}footer{position:fixed;bottom:0;width:100%}</style><body><div id="bg1" style="background-image:url('/backgrounds/original.svg')"></div><header><aside></aside><button>设置</button></header><main>Original wallpaper remains visible</main><footer><aside></aside><button id="send">发送</button></footer></body>` });
   });
   await page.goto('http://edge.test/');
   await page.exposeFunction('capturePage', async () => (await page.screenshot()).toString('base64'));
   await page.evaluate(() => {
    window.files = new Map(); window.requests = [];
    window.__TAURITAVERN__ = { invoke: { safeInvoke: async (command, args) => {
     if (command === 'get_window_snapshot') return { revision: 1, width: innerWidth, height: innerHeight + 56, scale: 1, insets: { top:32, bottom:24, left:0, right:0 } };
     if (command === 'set_window_backdrop') { requests.push(args.request); return; }
     throw Error(command);
    } }, api: { layout: { capture: async () => new Blob([Uint8Array.from(atob(await capturePage()), c => c.charCodeAt(0))], { type:'image/png' }) } } };
    window.fetch = async (url, options) => {
     const body = JSON.parse(options.body);
     if (url === '/api/images/upload') { const path = 'user/images/' + body.ch_name + '/' + body.filename + '.png'; files.set('/' + path, body.image); return { ok:true, json:async () => ({ path }) }; }
     if (url === '/api/images/delete') { files.delete('/' + body.path.replace(/^\/+/,'')); return { ok:true, json:async () => ({}) }; }
     throw Error(url);
    };
   });
   const before = await page.screenshot();
   const result = await page.evaluate(async () => {
    const { createNativeEdge } = await import('/native-edge.mjs');
    const edge = createNativeEdge(document);
    const results = [];
    for (const [mode, target] of [['dark',null],['soft',null],['soft','#abcdef']]) {
     await edge.apply(mode, () => true, target);
     const request = requests.at(-1), encoded = files.get(request.wallpaper.resourcePath);
     const image = new Image(); image.src = 'data:image/png;base64,' + encoded; await image.decode();
     const canvas = document.createElement('canvas'); canvas.width = image.width; canvas.height = image.height;
     const ctx = canvas.getContext('2d'); ctx.drawImage(image,0,0);
     const pixel = (x,y) => [...ctx.getImageData(x,y,1,1).data];
     results.push({ mode, target, outer:pixel(5,0), width:image.width, height:image.height, left:pixel(5,31), right:pixel(innerWidth-5,31), middle:pixel(10,100), files:files.size });
    }
    await edge.apply('off');
    return { results, remaining:files.size, restore:requests.at(-1).wallpaper.resourcePath, overlay:!!document.getElementById('tvrm-edge-fade') };
   });
   assert.deepEqual(await page.screenshot(), before, 'Page pixels changed');
   const rgb = hex => [1,3,5].map(i => parseInt(hex.slice(i,i+2),16)).concat(255);
   for (const r of result.results) {
    assert.equal(r.width,width); assert.equal(r.height,832);
    assert.deepEqual(r.right,rgb(right));
    if (r.target) assert.deepEqual(r.outer, [171,205,239,255]);
    assert.deepEqual(r.left,rgb(width>700 ? left : right));
    assert.deepEqual(r.middle,[0,0,0,0]); assert.equal(r.files,1);
   }
   assert.equal(result.remaining,0); assert.equal(result.restore,'/backgrounds/original.svg'); assert.equal(result.overlay,false);
   assert.equal(await page.locator('#send').isEnabled(),true);
   console.log(`PASS ${width}px ${day ? 'day' : 'night'}: page unchanged; native colors match; no overlay; wallpaper restored; temporary files cleaned`);
   await page.close();
  }
 } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode=1; });

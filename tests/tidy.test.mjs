import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const { JSDOM } = createRequire(process.env.JSDOM_DIR || '/tmp/jsd/')('jsdom');
import { createTidy, normalizeTidy, TIDY } from '../src/tidy.mjs';

// 照酒馆 index.html 的结构摘的一小块
const PAGE = `<div id="top-bar"></div>
<div id="top-settings-holder">
  <div id="ai-config-button" class="drawer"><div class="drawer-toggle"><div title="AI Response Configuration"></div></div><div class="drawer-content">预设</div></div>
  <div id="backgrounds-button" class="drawer"><div class="drawer-toggle"><div title="Backgrounds"></div></div><div class="drawer-content">背景</div></div>
  <div id="extensions-settings-button" class="drawer"><div class="drawer-toggle"><div title="Extensions"></div></div>
    <div id="rm_extensions_block" class="drawer-content"><div class="extensions_block flex-container">
      <div class="head">Extensions</div>
      <div id="extensions_settings">
        <div id="assets_container" class="extension_container"><div class="inline-drawer"><div class="inline-drawer-header"><b>Assets</b></div></div></div>
        <div id="sd_container" class="extension_container"></div>
        <div id="other_one"><div class="inline-drawer"><div class="inline-drawer-header"><b>别的插件</b></div></div></div>
      </div>
      <div id="extensions_settings2">
        <div id="regex_container" class="extension_container"><div class="inline-drawer"><div class="inline-drawer-header"><b>Regex</b></div></div></div>
        <div id="th"><div class="inline-drawer"><div class="inline-drawer-header"><b>酒馆助手</b></div></div></div>
        <div class="inline-drawer" id="tvrm-drawer"><div class="inline-drawer-header"><b>酒馆你害我不浅</b></div></div>
      </div>
      <hr class="wide100p">
      <div class="extras-head"><h4>Extras API:</h4><div><div id="extensions_status">Not connected</div></div></div>
      <div class="extras-row"><input id="extensions_url"><div id="extensions_connect">Connect</div></div>
    </div></div>
  </div>
</div>
<div id="sheld"></div>
<div id="user-settings-block">
  <textarea id="settingsSearch"></textarea>
  <div id="UI-Theme-Block"><div name="themeElements"><div>颜色</div><div>字号</div></div></div>
  <div id="UI-Customization"><div name="CharacterHandlingToggles"><div>角色</div></div><div name="MiscellaneousToggles"><div>杂项</div></div></div>
</div>
<div id="extensionsMenu">
  <div id="sd_wand_container" class="extension_container"><div class="list-group-item"><span>生成图片</span></div></div>
  <div id="tts_wand_container" class="extension_container"><div class="list-group-item"><span>朗读</span></div><div class="list-group-item"><span>停止朗读</span></div></div>
  <div class="list-group-item" id="third_party"><span>小手机</span></div>
</div>
<div id="options"><div class="options-content">
  <a id="option_toggle_AN"><i></i><span>Author's Note</span></a>
  <a id="option_toggle_CFG"><i></i><span>CFG Scale</span></a>
  <hr>
  <a id="option_start_new_chat"><i></i><span>Start new chat</span></a>
  <a id="option_impersonate"><i></i><span>Impersonate</span></a>
</div></div>`;

function setup(saved, extra = '') {
    const dom = new JSDOM(`<head></head><body>${PAGE}${extra}</body>`);
    globalThis.queueMicrotask ??= queueMicrotask;
    const settings = saved === undefined ? {} : { [TIDY]: saved };
    const c = { extensionSettings: settings, saveSettingsDebounced() { c.saved = (c.saved || 0) + 1; } };
    const toasts = [];
    const tidy = createTidy({ document: dom.window.document, getContext: () => c, toast: (k, m) => toasts.push(m), confirm: async () => true });
    return { dom, doc: dom.window.document, c, tidy, toasts };
}
const gone = el => el.classList.contains('tvrm-tidy-gone');

test('设置整理：默认不开；扩展程序图标也能收', () => {
    const s = normalizeTidy({ hideTop: ['backgrounds-button', 'extensions-settings-button'], on: 'yes' });
    assert.equal(s.on, false);
    assert.equal(s.topOpen, false);
    assert.deepEqual(s.hideTop, ['backgrounds-button', 'extensions-settings-button']);
    assert.ok(s.menuFolded.includes('option_toggle_AN'));
    assert.deepEqual(normalizeTidy(null).hideWand, []);
});

test('没开的时候什么都不动', () => {
    const { doc, tidy } = setup();
    const before = doc.body.innerHTML;
    tidy.init();
    assert.equal(doc.body.innerHTML, before);
});

test('开了：顶部按钮、三横菜单、魔法棒、扩展页、用户设置都整理好；关掉一点不剩', async () => {
    const { doc, tidy } = setup({ on: true, hideTop: ['backgrounds-button'], hideWand: ['id:third_party', 'tts_wand_container:朗读', 'tts_wand_container:停止朗读'],
        extFolded: ['id:assets_container', 'id:tvrm-drawer'] });
    const before = doc.body.innerHTML;
    tidy.init();
    // 顶栏：背景收进最右边的 «，点开往左展开（排在折叠左边）
    const topFold = doc.querySelector('#top-settings-holder > .tvrm-tidy-topmore');
    assert.ok(topFold);
    assert.equal(topFold.style.getPropertyValue('order'), '9999');
    assert.ok(gone(doc.querySelector('#backgrounds-button > .drawer-toggle')));
    assert.ok(doc.getElementById('backgrounds-button').classList.contains('tvrm-tidy-slim'));
    assert.equal(doc.getElementById('backgrounds-button').style.getPropertyValue('order'), '9998');
    assert.ok(!gone(doc.querySelector('#ai-config-button > .drawer-toggle')));
    topFold.click();
    assert.ok(!gone(doc.querySelector('#backgrounds-button > .drawer-toggle')));
    assert.ok(topFold.classList.contains('is-open'));
    topFold.click();
    assert.ok(gone(doc.querySelector('#backgrounds-button > .drawer-toggle')));
    // 选项菜单：作者注释、CFG、AI 帮答收进最下面的 ⋯（只有图标没有字），新聊天留在外面
    const more = doc.querySelector('#options .tvrm-tidy-more-list');
    assert.deepEqual([...more.children].map(a => a.id), ['option_toggle_AN', 'option_toggle_CFG', 'option_impersonate']);
    assert.ok(more.hidden);
    assert.equal(doc.querySelector('#options .tvrm-tidy-dots').textContent, '');
    assert.equal(doc.getElementById('option_start_new_chat').parentElement.className, 'options-content');
    // 扩展菜单：收进 ⋯；一组全收走了，留下的空盒子藏起来；没收的照旧
    const wandMore = doc.querySelector('#extensionsMenu .tvrm-tidy-more-list');
    assert.deepEqual([...wandMore.children].map(e => e.textContent), ['朗读', '停止朗读', '小手机']);
    assert.ok(wandMore.hidden);
    assert.ok(gone(doc.getElementById('tts_wand_container')));
    assert.ok(!gone(doc.getElementById('sd_wand_container')));
    doc.querySelector('#extensionsMenu .tvrm-tidy-dots').click();
    assert.ok(!wandMore.hidden);
    // 扩展页：一列；咱们的面板真的挪到最前面；Assets、Extras API 真的挪进「收起的扩展程序」盒子，盒子在整个扩展列表末尾；空容器藏掉
    const order = id => Number(doc.getElementById(id).style.getPropertyValue('order'));
    const col1 = doc.getElementById('extensions_settings');
    assert.equal(col1.style.getPropertyValue('display'), 'contents');
    assert.equal(col1.firstElementChild.id, 'tvrm-drawer');
    const parent = col1.parentElement;
    const box = parent.lastElementChild;
    assert.ok(box.classList.contains('tvrm-tidy-extbox'));
    assert.equal(box.style.getPropertyValue('order'), '2147483647');
    const body = box.querySelector('.tvrm-tidy-extbody');
    assert.deepEqual([...body.children].map(e => e.id || e.className.split(' ')[0]), ['assets_container', 'wide100p', 'extras-head', 'extras-row', 'tvrm-tidy-more-tail']);
    assert.ok(order('regex_container') < order('th'));
    assert.ok(order('th') < order('other_one'));
    assert.ok(gone(body));
    assert.ok(gone(doc.getElementById('sd_container')));
    const head = box.querySelector('.tvrm-tidy-fold');
    assert.match(head.textContent, /收起的扩展程序（2）/);
    // 用户设置：两段折起来
    assert.ok(gone(doc.querySelector('[name="themeElements"] > div:not(.tvrm-tidy-fold)')));
    // 面板里收进盒子的也照样列着、勾着
    const panel = doc.createElement('div'); doc.body.append(panel); tidy.render(panel);
    assert.ok([...panel.querySelectorAll('.tvrm-tidy-check')].find(l => l.textContent === 'Assets')?.querySelector('input').checked);
    panel.remove();
    // 点开：只动这个盒子（不重建），里面的挂上「小一号、淡底色」，底下有「收起」
    const tail = body.querySelector('.tvrm-tidy-more-tail');
    head.click();
    assert.equal(parent.lastElementChild, box); // 没有重建
    assert.ok(!gone(body));
    assert.ok(doc.getElementById('assets_container').classList.contains('tvrm-tidy-sub'));
    assert.ok(!doc.getElementById('regex_container').classList.contains('tvrm-tidy-sub'));
    assert.equal(head.querySelector('.tvrm-tidy-arrow').textContent, '▾');
    // 从底下收起：动画放完才藏
    tail.click();
    assert.ok(!gone(body));
    await new Promise(r => setTimeout(r, 220));
    assert.ok(gone(body));
    assert.equal(head.querySelector('.tvrm-tidy-arrow').textContent, '▸');
    head.click(); // 再开着关掉整理，也要退干净
    // 关掉：页面和原来一模一样（菜单项回到原位置、行内样式和 class 都退回去）
    tidy.settings().on = false; tidy.apply();
    assert.equal(doc.body.innerHTML, before);
});

test('搜设置的时候用户设置全部摊开', () => {
    const { doc, tidy } = setup({ on: true });
    tidy.init();
    assert.ok(doc.querySelector('[name="themeElements"] > .tvrm-tidy-fold'));
    doc.getElementById('settingsSearch').value = '字号';
    tidy.apply();
    assert.equal(doc.querySelector('[name="themeElements"] > .tvrm-tidy-fold'), null);
    assert.ok(!gone(doc.querySelector('[name="themeElements"] > div')));
});

test('砚台界面整理还开着：先不动，面板上提醒', () => {
    const { doc, tidy } = setup({ on: true, hideTop: ['backgrounds-button'] }, '<style id="yt-interface-active-style"></style>');
    tidy.init();
    assert.ok(!gone(doc.querySelector('#backgrounds-button > .drawer-toggle')));
    const box = doc.createElement('div'); doc.body.append(box);
    tidy.render(box);
    assert.match(box.textContent, /砚台 · 界面整理」还在运行/);
});

test('面板：勾上顶栏图标就收起；名字用图标自己的提示字；恢复原界面后勾选还留着', async () => {
    const { doc, tidy, c } = setup({ on: true });
    tidy.init();
    const box = doc.createElement('div'); doc.body.append(box);
    tidy.render(box);
    const label = [...box.querySelectorAll('.tvrm-tidy-check')].find(l => l.textContent === 'Backgrounds');
    const input = label.querySelector('input');
    assert.equal(input.checked, false);
    input.checked = true; input.dispatchEvent(new doc.defaultView.Event('change'));
    assert.deepEqual(c.extensionSettings[TIDY].hideTop, ['backgrounds-button']);
    assert.ok(gone(doc.querySelector('#backgrounds-button > .drawer-toggle')));
    tidy.restore();
    assert.ok(!gone(doc.querySelector('#backgrounds-button > .drawer-toggle')));
    assert.equal(doc.querySelector('.tvrm-tidy-topmore'), null);
    assert.equal(c.extensionSettings[TIDY].on, false);
    assert.deepEqual(c.extensionSettings[TIDY].hideTop, ['backgrounds-button']);
});

test('扩展菜单收进 ⋯ 的，面板里照样列着、勾着', () => {
    const { doc, tidy } = setup({ on: true, hideWand: ['tts_wand_container:朗读'] });
    tidy.init();
    const box = doc.createElement('div'); doc.body.append(box);
    tidy.render(box);
    const l = [...box.querySelectorAll('.tvrm-tidy-check')].find(x => x.textContent === '朗读');
    assert.ok(l && l.querySelector('input').checked);
    assert.equal([...box.querySelectorAll('.tvrm-tidy-check')].filter(x => x.textContent === '朗读').length, 1);
});

test('后加进来的魔法棒入口也会被认出来、按设置收起', async () => {
    const { doc, tidy } = setup({ on: true, hideWand: ['id:late'] });
    tidy.init();
    const el = doc.createElement('div'); el.id = 'late'; el.className = 'list-group-item'; el.innerHTML = '<span>后来的</span>';
    doc.getElementById('extensionsMenu').append(el);
    await new Promise(r => setTimeout(r, 10)); // DOM 观察后在下一帧批量整理
    assert.equal(el.parentElement.className, 'tvrm-tidy-more-list');
});

test('酒馆自己藏着的不列出来（displayNone、只在某些聊天里才出现的）', () => {
    const dom = new JSDOM(`<head><style>.displayNone{display:none}</style></head><body>
        <div id="top-settings-holder"><div id="ai-config-button" class="drawer"><div class="drawer-toggle"></div></div><div id="ghost" class="drawer" style="display:none"><div class="drawer-toggle" title="鬼"></div></div></div>
        <div id="extensionsMenu"><div class="list-group-item"><span>看得到</span></div><div class="list-group-item displayNone"><span>藏着的</span></div></div>
        <div id="options"><div class="options-content">
            <a id="option_close_chat" class="displayNone"><span>关闭聊天</span></a>
            <a id="option_settings" class="displayNone"><span>切换面板</span></a>
            <a id="option_back_to_main" style="display: none;"><span>返回到父级聊天</span></a>
            <a id="option_start_new_chat"><span>开始新聊天</span></a>
            <a id="option_close_chat"><span>关闭聊天</span></a>
        </div></div></body>`);
    const c = { extensionSettings: { [TIDY]: { on: true } }, saveSettingsDebounced() {} };
    const doc = dom.window.document;
    const tidy = createTidy({ document: doc, getContext: () => c, toast() {}, confirm: async () => true });
    tidy.init();
    const box = doc.createElement('div'); doc.body.append(box);
    tidy.render(box);
    const labels = [...box.querySelectorAll('.tvrm-tidy-check')].map(l => l.textContent);
    assert.ok(labels.includes('开始新聊天'));
    assert.ok(labels.includes('关闭聊天')); // 两个里有一个露着
    assert.ok(!labels.includes('切换面板'));
    assert.ok(!labels.includes('返回到父级聊天'));
    assert.ok(labels.includes('看得到'));
    assert.ok(!labels.includes('藏着的'));
    assert.ok(!labels.includes('鬼'));
    assert.match(box.textContent, /另有 2 项现在没显示/);
});

test('排查信息：列出扩展页每一块的排序和显示方式', async () => {
    const { doc, tidy } = setup({ on: true });
    tidy.init();
    const box = doc.createElement('div'); doc.body.append(box);
    tidy.render(box);
    const b = [...box.querySelectorAll('button')].find(x => x.textContent === '复制排查信息');
    b.click(); await new Promise(r => setTimeout(r, 0));
    const text = box.querySelector('.tvrm-tidy-diag').value;
    assert.match(text, /div#extensions_settings\.- 父:/);
    assert.match(text, /「酒馆你害我不浅」 顺序:/);
});

test('滑动更顺（试验）：开了挂上，关了去掉', () => {
    const { doc, tidy } = setup({ on: true, smooth: true });
    tidy.init();
    assert.ok(doc.body.classList.contains('tvrm-tidy-smooth'));
    tidy.settings().smooth = false; tidy.apply();
    assert.ok(!doc.body.classList.contains('tvrm-tidy-smooth'));
    assert.equal(normalizeTidy({}).smooth, false);
});

test('扩展菜单点 ⋯ 不会把整个菜单关掉（TauriTavern 的菜单点里面任何地方就关）', () => {
    const { doc, tidy } = setup({ on: true, hideWand: ['id:third_party'] });
    tidy.init();
    const menu = doc.getElementById('extensionsMenu');
    menu.style.display = 'flex';
    // 照 TauriTavern popup-menu.js：菜单上挂一个「捕获阶段」的点击，点里面任何东西就关
    menu.addEventListener('click', () => { menu.style.display = 'none'; }, { capture: true });
    const dots = menu.querySelector('.tvrm-tidy-dots');
    dots.querySelector('i').dispatchEvent(new doc.defaultView.MouseEvent('click', { bubbles: true }));
    assert.equal(menu.style.display, 'flex');
    assert.ok(!menu.querySelector('.tvrm-tidy-more-list').hidden);
    // 两个菜单的 ⋯ 长一样（都不挂菜单项自己的样式）
    assert.ok(!dots.classList.contains('list-group-item'));
});

test('前五项和总开关一起默认折叠，独立功能放外面', () => {
    const { doc, tidy } = setup(); tidy.init();
    const panel = doc.createElement('div'); doc.body.append(panel); tidy.render(panel);
    const groups = [...panel.children];
    assert.equal(groups.length, 5);
    const group = groups[0];
    assert.equal(group.open, false);
    assert.deepEqual([...group.querySelectorAll(':scope > .tvrm-card-body > details > summary b')].map(x => x.textContent), ['顶栏', '选项菜单', '扩展菜单', '扩展程序页', '用户设置']);
    assert.ok([...group.querySelectorAll('label')].some(x => x.textContent === '开启界面整理'));
    assert.ok(!group.textContent.includes('滑动空白修复'));
    assert.ok(!group.textContent.includes('页面全屏'));
    tidy.destroy();
});

test('总开关和恢复原界面只管前五项，独立功能不受砚台影响', () => {
    const { doc, tidy } = setup({ on: false, smooth: true, regexFit: true }, '<style id="yt-interface-active-style"></style>');
    tidy.init();
    for (const cls of ['tvrm-tidy-smooth', 'tvrm-tidy-regex']) assert.ok(doc.body.classList.contains(cls));
    tidy.restore();
    for (const cls of ['tvrm-tidy-smooth', 'tvrm-tidy-regex']) assert.ok(doc.body.classList.contains(cls));
    tidy.destroy();
    assert.ok(!doc.body.classList.contains('tvrm-tidy-smooth'));
});

const tick = () => new Promise(r => setTimeout(r, 0));
const button = (box, text) => [...box.querySelectorAll('button')].find(x => x.textContent === text);
test('页面全屏：进入、系统退出同步、再次进入和退出，不依赖整理开关', async () => {
    const { doc, tidy } = setup();
    let current = null;
    Object.defineProperty(doc, 'fullscreenElement', { get: () => current });
    const sync = () => doc.dispatchEvent(new doc.defaultView.Event('fullscreenchange'));
    doc.documentElement.requestFullscreen = async () => { current = doc.documentElement; sync(); };
    doc.exitFullscreen = async () => { current = null; sync(); };
    tidy.init(); const panel = doc.createElement('div'); doc.body.append(panel); tidy.render(panel);
    button(panel, '进入全屏').click(); await tick();
    assert.equal(current, doc.documentElement); assert.ok(button(panel, '退出全屏'));
    current = null; sync(); assert.ok(button(panel, '进入全屏'));
    button(panel, '进入全屏').click(); await tick();
    button(panel, '退出全屏').click(); await tick();
    assert.equal(current, null); assert.equal(tidy.settings().on, false);
    tidy.destroy();
});

test('页面全屏：不支持或请求被拒绝时明确提示，可以重试', async () => {
    const { doc, tidy, toasts } = setup(); tidy.init();
    const panel = doc.createElement('div'); doc.body.append(panel); tidy.render(panel);
    button(panel, '进入全屏').click(); await tick();
    assert.match(toasts.at(-1), /未提供页面全屏接口/);
    doc.documentElement.requestFullscreen = async () => { throw new Error('denied'); };
    button(panel, '进入全屏').click(); await tick();
    assert.match(toasts.at(-1), /denied/); assert.ok(button(panel, '进入全屏'));
    tidy.destroy();
});

test('页面全屏：Tauri 窗口接口进入和退出', async () => {
    const { doc, tidy } = setup(); let full = false;
    doc.defaultView.__TAURI__ = { window: { getCurrentWindow: () => ({ isFullscreen: async () => full, setFullscreen: async v => { full = v; } }) } };
    tidy.init(); const panel = doc.createElement('div'); doc.body.append(panel); tidy.render(panel);
    button(panel, '进入全屏').click(); await tick(); assert.equal(full, true);
    button(panel, '退出全屏').click(); await tick(); assert.equal(full, false);
    tidy.destroy();
});

test('关掉整理后不监听动态菜单，也不会因菜单点击重绘设置', async () => {
    const { doc, tidy } = setup({ on: false }); tidy.init();
    const panel = doc.createElement('div'); doc.body.append(panel); tidy.render(panel);
    const initial = panel.firstElementChild;
    doc.getElementById('extensionsMenu').append(doc.createElement('button'));
    const trigger = doc.createElement('button'); trigger.id = 'options_button'; doc.body.append(trigger); trigger.click();
    await tick(); await tick();
    assert.equal(panel.firstElementChild, initial);
    tidy.destroy();
});

test('同一帧连续触发只整理一次，销毁会取消未执行的整理', async () => {
    const { doc, tidy } = setup({ on: true });
    let task = null, cancelled = false;
    doc.defaultView.requestAnimationFrame = fn => { assert.equal(task, null); task = fn; return 123; };
    doc.defaultView.cancelAnimationFrame = id => { assert.equal(id, 123); cancelled = true; task = null; };
    tidy.init();
    const panel = doc.createElement('div'); doc.body.append(panel); tidy.render(panel);
    const trigger = doc.createElement('button'); trigger.id = 'options_button'; doc.body.append(trigger);
    const initial = panel.firstElementChild;
    trigger.click(); trigger.click(); trigger.click();
    assert.equal(panel.firstElementChild, initial); assert.ok(task);
    const run = task; task = null; run();
    assert.notEqual(panel.firstElementChild, initial);
    trigger.click(); tidy.destroy(); assert.equal(cancelled, true);
});

test('设置搜索只在开始和清空时整理，连续输入不反复拆建其他页面', async () => {
    const { doc, tidy } = setup({ on: true }); tidy.init();
    const search = doc.getElementById('settingsSearch');
    const input = value => { search.value = value; search.dispatchEvent(new doc.defaultView.Event('input')); };
    input('字'); await new Promise(r => setTimeout(r, 10));
    assert.equal(doc.querySelector('[name="themeElements"] > .tvrm-tidy-fold'), null);
    const menu = doc.querySelector('#options .tvrm-tidy-more');
    for (const text of ['字号', '字号设', '字号设置']) { input(text); await tick(); }
    assert.equal(doc.querySelector('#options .tvrm-tidy-more'), menu);
    input(''); await new Promise(r => setTimeout(r, 10));
    assert.ok(doc.querySelector('[name="themeElements"] > .tvrm-tidy-fold'));
    tidy.destroy();
});


test('TT iPhone 即使暴露桌面窗口接口也直接请求元素全屏', async () => {
    const { doc, tidy } = setup(); let requests = 0; let nativeCalls = 0;
    Object.defineProperty(doc.defaultView.navigator, 'userAgent', { value: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X)' });
    doc.defaultView.__TAURI__ = { window: { getCurrentWindow: () => { nativeCalls++; throw new Error('Plugin window not initialized'); } } };
    doc.documentElement.requestFullscreen = () => { requests++; return Promise.resolve(); };
    tidy.init(); const panel = doc.createElement('div'); doc.body.append(panel); tidy.render(panel);
    button(panel, '进入全屏').click();
    assert.equal(requests, 1, '点击事件内同步发起全屏，保留用户激活');
    await tick(); assert.equal(nativeCalls, 0);
    tidy.destroy();
});

test('后加载的扩展始终在收起栏前面，关闭整理后不留下末尾盒子', async () => {
    const { doc, tidy } = setup({ on: true }); tidy.init();
    const root = doc.getElementById('extensions_settings2'), parent = root.parentElement;
    const late = doc.createElement('div'); late.id = 'late-extension';
    late.innerHTML = '<div class="inline-drawer-header"><b>后加载扩展</b></div>';
    root.append(late);
    await new Promise(resolve => setTimeout(resolve, 10));
    const box = parent.lastElementChild;
    assert.ok(box.classList.contains('tvrm-tidy-extbox'));
    assert.ok(Number(late.style.order) < Number(box.style.order));
    tidy.restore();
    assert.equal(doc.querySelector('.tvrm-tidy-extbox'), null);
    assert.equal(late.parentElement, root); tidy.destroy();
});

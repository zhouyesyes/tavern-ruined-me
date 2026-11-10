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
    // 扩展页：一列；咱们的面板在最上面不能收；Assets 收进「更多」；空容器藏掉；Extras API 也收
    const order = id => Number(doc.getElementById(id).style.getPropertyValue('order'));
    assert.equal(doc.getElementById('extensions_settings').style.getPropertyValue('display'), 'contents');
    assert.ok(order('tvrm-drawer') < order('regex_container'));
    assert.ok(order('regex_container') < order('th'));
    assert.ok(order('th') < order('other_one'));
    assert.ok(gone(doc.getElementById('assets_container')));
    assert.ok(!gone(doc.getElementById('tvrm-drawer')));
    assert.ok(gone(doc.getElementById('sd_container')));
    assert.ok(gone(doc.querySelector('.extras-row')));
    const head = doc.querySelector('#extensions_settings > .tvrm-tidy-fold');
    assert.match(head.textContent, /收起的扩展程序（2）/);
    // 用户设置：两段折起来
    assert.ok(gone(doc.querySelector('[name="themeElements"] > div:not(.tvrm-tidy-fold)')));
    // 点开「收起的扩展程序」：原地展开（不重排整页），收着的那几个挂上「小一号、淡底色」，底下多一个「收起」
    const tail = doc.querySelector('.tvrm-tidy-more-tail');
    assert.ok(gone(tail));
    head.click();
    assert.equal(doc.querySelector('#extensions_settings > .tvrm-tidy-fold'), head); // 没有重建
    assert.ok(!gone(doc.getElementById('assets_container')));
    assert.ok(doc.getElementById('assets_container').classList.contains('tvrm-tidy-sub'));
    assert.ok(!doc.getElementById('regex_container').classList.contains('tvrm-tidy-sub'));
    assert.ok(!gone(tail));
    assert.equal(head.querySelector('.tvrm-tidy-arrow').textContent, '▾');
    // 从底下收起：动画放完才藏
    tail.click();
    assert.ok(!gone(doc.getElementById('assets_container')));
    await new Promise(r => setTimeout(r, 220));
    assert.ok(gone(doc.getElementById('assets_container')));
    assert.ok(gone(tail));
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
    await new Promise(r => setTimeout(r, 0));
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

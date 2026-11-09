import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const { JSDOM } = createRequire(process.env.JSDOM_DIR || '/tmp/jsd/')('jsdom');
import { createTidy, normalizeTidy, fromYantai, TIDY, TOP_KEEP } from '../src/tidy.mjs';

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

test('设置整理：默认不开；「扩展」按钮不能藏', () => {
    const s = normalizeTidy({ hideTop: ['backgrounds-button', TOP_KEEP], on: 'yes' });
    assert.equal(s.on, false);
    assert.deepEqual(s.hideTop, ['backgrounds-button']);
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
    // 顶部：背景藏了，扩展不藏
    assert.ok(gone(doc.querySelector('#backgrounds-button > .drawer-toggle')));
    assert.ok(doc.getElementById('backgrounds-button').classList.contains('tvrm-tidy-slim'));
    assert.ok(!gone(doc.querySelector('#ai-config-button > .drawer-toggle')));
    // 三横菜单：作者注释、CFG、AI 帮答收进「更多工具」，新聊天留在外面
    const more = doc.querySelector('#options .tvrm-tidy-more-list');
    assert.deepEqual([...more.children].map(a => a.id), ['option_toggle_AN', 'option_toggle_CFG', 'option_impersonate']);
    assert.ok(more.hidden);
    assert.equal(doc.getElementById('option_start_new_chat').parentElement.className, 'options-content');
    // 魔法棒：一组全藏了，组也藏；没藏的照旧
    assert.ok(gone(doc.getElementById('third_party')));
    assert.ok(gone(doc.getElementById('tts_wand_container')));
    assert.ok(!gone(doc.getElementById('sd_wand_container')));
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
    assert.match(head.textContent, /更多扩展设置（2）/);
    // 用户设置：两段折起来
    assert.ok(gone(doc.querySelector('[name="themeElements"] > div:not(.tvrm-tidy-fold)')));
    // 点开「更多扩展设置」
    head.click();
    assert.ok(!gone(doc.getElementById('assets_container')));
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
    assert.match(box.textContent, /砚台 · 界面整理还开着/);
});

test('面板：勾掉顶部按钮就藏；恢复原界面全部放出来', async () => {
    const { doc, tidy, c } = setup({ on: true });
    tidy.init();
    const box = doc.createElement('div'); doc.body.append(box);
    tidy.render(box);
    const label = [...box.querySelectorAll('.tvrm-tidy-check')].find(l => l.textContent.startsWith('背景'));
    const input = label.querySelector('input');
    input.checked = false; input.dispatchEvent(new doc.defaultView.Event('change'));
    assert.deepEqual(c.extensionSettings[TIDY].hideTop, ['backgrounds-button']);
    assert.ok(gone(doc.querySelector('#backgrounds-button > .drawer-toggle')));
    // 扩展按钮那格是灰的，不能点
    const ext = [...box.querySelectorAll('.tvrm-tidy-check')].find(l => l.textContent.startsWith('扩展'));
    assert.ok(ext.querySelector('input').disabled);
    tidy.restore();
    assert.ok(!gone(doc.querySelector('#backgrounds-button > .drawer-toggle')));
    assert.equal(c.extensionSettings[TIDY].on, false);
});

test('后加进来的魔法棒入口也会被认出来、按设置藏', async () => {
    const { doc, tidy } = setup({ on: true, hideWand: ['id:late'] });
    tidy.init();
    const el = doc.createElement('div'); el.id = 'late'; el.className = 'list-group-item'; el.innerHTML = '<span>后来的</span>';
    doc.getElementById('extensionsMenu').append(el);
    await new Promise(r => setTimeout(r, 0));
    assert.ok(gone(el));
});

test('搬砚台里的选择', () => {
    const mine = normalizeTidy({});
    const next = fromYantai({ hiddenTop: ['WI-SP-button'], foldedTools: ['option_toggle_AN'], hiddenWand: ['id:x'], foldedExtensions: ['id:sd_container'],
        foldedUserSections: ['theme', 'chat'], extensionOrder: ['id:a', 'id:b'], foldMenu: false }, mine);
    assert.deepEqual(next.hideTop, ['WI-SP-button']);
    assert.deepEqual(next.menuFolded, ['option_toggle_AN']);
    assert.equal(next.foldMenu, false);
    assert.deepEqual(next.hideWand, ['id:x']);
    assert.deepEqual(next.extFolded, ['id:sd_container']);
    assert.deepEqual(next.userFolded, ['theme', 'chat']);
    assert.deepEqual(next.extSeen, ['id:a', 'id:b']);
    assert.equal(fromYantai(null, mine), null);
});

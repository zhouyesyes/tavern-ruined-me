// 酒馆你害我不浅 —— 入口。四格：世界书 / 预设 / API 共用「跟着聊天走」；界面格整理酒馆界面。
import { eventSource, event_types } from '../../../../script.js';
import { getContext } from '../../../extensions.js';
import { world_names, selected_world_info, world_info, loadWorldInfo, saveWorldInfo } from '../../../world-info.js';
import { callGenericPopup, POPUP_TYPE } from '../../../popup.js';
import { createApp } from './src/ui.mjs';
import { createPresetKeeper } from './src/preset.mjs';
import { createKeyKeeper } from './src/keysUI.mjs';
import { parseModels, normalizeUrl } from './src/keys.mjs';
import { createTidy } from './src/tidy.mjs';
// 整个模块一起导入，按名字去取：酒馆旧一点、少导出一个名字时，插件照样能加载（逐个 import 少一个就整个插件加载失败、从扩展列表里消失）
import * as oai from '../../../openai.js';
import * as secrets from '../../../secrets.js';
import { collectNativeApis } from './src/nativeApis.mjs';

// 预设格接到酒馆（聊天补全预设）。照酒馆自己 openai.js / PromptManager.js 的做法：
// - 当前预设名：oai_settings.preset_settings_openai；预设名 → 下拉选项值：openai_setting_names[name]
// - 换预设：把 #settings_preset_openai 设成那个值并触发 change（和手点下拉一样），
//   酒馆的 onSettingsPresetChange 会把预设内容（含 prompt_order）载进 oai_settings；
//   它的完成信号是 getPresetApplicationPromise()，要等它，不能靠定时器
// - 开关和顺序：promptManager.getPromptOrderForCharacter(promptManager.activeCharacter)，
//   原地改这个数组，再 promptManager.render(false) 刷新预设页，promptManager.saveServiceSettings() 存下来
const orderEntry = () => {
    const pm = oai.promptManager; if (!pm?.serviceSettings) return null;
    return pm.getPromptOrderForCharacter(pm.activeCharacter);
};
const wait = ms => new Promise(r => setTimeout(r, ms));
// 等换上的预设载完：新酒馆（1.19 起）用它自己的完成信号；旧一点的（比如 1.18）没有，
// 就等酒馆换完预设内容后发的 OAI_PRESET_CHANGED_AFTER（1.18 是在预设内容含开关顺序都载进来之后才发），最多 8 秒
function presetApplied() {
    if (typeof oai.getPresetApplicationPromise === 'function') return null;
    const type = event_types.OAI_PRESET_CHANGED_AFTER;
    if (!type) return wait(600);
    return new Promise(resolve => {
        const done = () => { eventSource.removeListener?.(type, done); resolve(); };
        eventSource.on(type, done);
        setTimeout(done, 8000);
    });
}
// 当前聊天是谁的哪一个：key = 谁|聊天名（谁 = c:角色头像文件名 / g:群聊编号），世界书格和预设格共用
const chatInfo = () => {
    const c = getContext();
    if (c.chatId == null) return null;
    const who = c.groupId ? 'g:' + c.groupId : 'c:' + (c.characters?.[c.characterId]?.avatar ?? c.characterId);
    return { key: who + '|' + c.chatId, label: (c.groupId ? c.groups?.find(g => String(g.id) === String(c.groupId))?.name : c.characters?.[c.characterId]?.name) + ' · ' + c.chatId };
};
// 排查用：这个角色现在有哪些聊天。照酒馆「聊天记录」那个窗口：POST /api/characters/chats，
// 回来是聊天文件列表（{ file_name: 'xxx.jsonl' }）；一个聊天都没有时酒馆回 { error: true }；请求失败就当查不了（返回 null）
async function listChats(avatar) {
    const res = await fetch('/api/characters/chats', { method: 'POST', headers: getContext().getRequestHeaders(), body: JSON.stringify({ avatar_url: avatar, simple: true }) });
    if (!res.ok) return null;
    const data = await res.json();
    if (data && !Array.isArray(data) && data.error) return new Set();
    const list = Array.isArray(data) ? data : Object.values(data || {});
    return new Set(list.map(x => String(x?.file_name ?? x ?? '').replace(/\.jsonl$/i, '')).filter(Boolean));
}
const presetKeeper = createPresetKeeper({
    listChats,
    document,
    getContext,
    chatInfo,
    toast: (kind, msg) => globalThis.toastr?.[kind]?.(msg),
    confirm: async text => !!await callGenericPopup(text, POPUP_TYPE.CONFIRM),
    prompt: async (title, value) => await callGenericPopup(title, POPUP_TYPE.INPUT, value),
    preset: {
        name: () => oai.oai_settings.preset_settings_openai,
        order: () => (orderEntry() || []).map(x => ({ ...x })),
        setOrder: async order => {
            const pm = oai.promptManager, oai_settings = oai.oai_settings; if (!pm?.serviceSettings) throw new Error('预设页还没准备好');
            let list = orderEntry();
            if (!list?.length && pm.activeCharacter) { // 这套预设里还没有这个位置的顺序：照酒馆的格式补一条
                oai_settings.prompt_order = (oai_settings.prompt_order || []).filter(x => String(x.character_id) !== String(pm.activeCharacter.id));
                oai_settings.prompt_order.push({ character_id: pm.activeCharacter.id, order: [] });
                list = orderEntry();
            }
            list.splice(0, list.length, ...order);
            pm.render(false);
            await Promise.race([pm.saveServiceSettings(), wait(3000)]); // 等酒馆存完（SETTINGS_UPDATED），最多等 3 秒
        },
        select: async name => {
            const sel = document.getElementById('settings_preset_openai');
            // 预设名 → 下拉选项值：新酒馆有 openai_setting_names；旧酒馆没有就照下拉里显示的名字找
            const value = oai.openai_setting_names?.[name] ?? [...(sel?.options || [])].find(o => o.textContent.trim() === name)?.value;
            if (value === undefined || !sel) throw new Error('酒馆里找不到预设「' + name + '」（可能被删了或改了名）');
            const applied = presetApplied(); // 先开始听，再换（事件可能来得很快）
            jQuery(sel).val(String(value)).trigger('change');
            await (applied ?? oai.getPresetApplicationPromise());
        },
        entryName: id => oai.promptManager?.getPromptById?.(id)?.name || id,
    },
});

// API 格（钥匙本）接到酒馆：
// - 反代列表：openai.js 的 proxies（存在设置里），只在扫描时读，不往里加（她用自定义来源，看不到那块）
// - 测连接：照酒馆「连接」按钮，POST /api/backends/chat-completions/status，带 reverse_proxy + proxy_password，
//   酒馆服务器去拉一次 /models（手机上不会被跨域拦），回来 { data: [模型] } 或 { error }
const keyKeeper = createKeyKeeper({
    document,
    getContext,
    toast: (kind, msg) => globalThis.toastr?.[kind]?.(msg),
    confirm: async text => !!await callGenericPopup(text, POPUP_TYPE.CONFIRM),
    on: (name, fn) => { if (event_types[name]) eventSource.on(event_types[name], fn); },
    nativeApis: () => collectNativeApis({
        settings: oai.oai_settings,
        profiles: getContext().extensionSettings.connectionManager?.profiles || [],
        customSecretKey: secrets.SECRET_KEYS?.CUSTOM || 'api_key_custom',
        readSecret: (key, id) => secrets.findSecret?.(key, id),
    }),
    proxy: { list: () => (oai.proxies || []).map(p => ({ name: p.name, url: p.url, password: p.password })) }, // 扫描时读一下酒馆反代列表
    probe: async (url, key) => {
        const res = await fetch('/api/backends/chat-completions/status', {
            method: 'POST', headers: getContext().getRequestHeaders(), cache: 'no-cache',
            body: JSON.stringify({ chat_completion_source: 'openai', reverse_proxy: normalizeUrl(url), proxy_password: key }),
        });
        if (!res.ok) throw new Error('酒馆返回 ' + res.status);
        const data = await res.json();
        if (data?.error) throw new Error(typeof data.error === 'string' ? data.error : data.error?.message || '地址或密钥不对');
        return parseModels(data);
    },
});

// 界面格：把不常用的按钮和设置收起来（照砚台 · 界面整理的功能自己写的）
const tidy = createTidy({
    document,
    getContext,
    toast: (kind, msg) => globalThis.toastr?.[kind]?.(msg),
    confirm: async text => !!await callGenericPopup(text, POPUP_TYPE.CONFIRM),
    on: (name, fn) => { if (event_types[name]) eventSource.on(event_types[name], fn); },
});

const app = createApp({
    tidy,
    chatInfo,
    presetKeeper,
    keyKeeper,
    document,
    getContext,
    listChats,
    confirm: async text => !!await callGenericPopup(text, POPUP_TYPE.CONFIRM),
    worldNames: () => world_names,
    bindings: () => ({ global: selected_world_info, charLore: world_info.charLore }),
    loadWorldInfo,
    saveWorldInfo,
    toast: (kind, msg) => globalThis.toastr?.[kind]?.(msg),
    setInterval: (f, ms) => setInterval(f, ms),
    // 有确定按钮就返回是否点了确定；ok 传 null 就是只看
    popup: async (el, ok) => {
        const res = await callGenericPopup(el, POPUP_TYPE.TEXT, '', ok ? { okButton: ok, cancelButton: '取消', wide: true, allowVerticalScrolling: true } : { okButton: '关闭', wide: true, allowVerticalScrolling: true });
        return !!res;
    },
});

jQuery(() => {
    app.init();
    tidy.init(); // 在面板挂上之后：扩展页排序要认得出咱们自己的面板
    keyKeeper.initFill();
    presetKeeper.onChatChanged();
    eventSource.on(event_types.CHAT_CHANGED, presetKeeper.onChatChanged);
    // 酒馆里删了聊天：预设格里这个聊天记着的也一起删（她 11/9 要的；开关在预设格最上面）。
    // 删聊天的事件只带聊天名，删的一定是当前角色 / 群聊的聊天，用当前的「谁」拼回 key
    const whoNow = () => { const c = getContext(); return c.groupId ? 'g:' + c.groupId : 'c:' + (c.characters?.[c.characterId]?.avatar ?? c.characterId); };
    // 世界书格同样：她 11/9 又要的，开关在世界书格「所有聊天」上面
    const gone = name => { const key = whoNow() + '|' + name; presetKeeper.onChatDeleted(key); app.onChatDeleted(key); };
    if (event_types.CHAT_DELETED) eventSource.on(event_types.CHAT_DELETED, gone);
    if (event_types.GROUP_CHAT_DELETED) eventSource.on(event_types.GROUP_CHAT_DELETED, gone);
    // 在预设页拨开关、拖顺序、换预设：酒馆没有专门事件，借预设页上的操作和预设变更事件来记
    for (const type of [event_types.OAI_PRESET_CHANGED_AFTER, event_types.SETTINGS_UPDATED]) if (type) eventSource.on(type, presetKeeper.onPresetEvent);
    document.addEventListener('click', e => { if (e.target.closest?.('#completion_prompt_manager')) setTimeout(presetKeeper.onPresetEvent, 300); });
    document.addEventListener('dragend', e => { if (e.target.closest?.('#completion_prompt_manager')) setTimeout(presetKeeper.onPresetEvent, 300); });
    for (const type of [event_types.WORLDINFO_UPDATED, event_types.WORLDINFO_SETTINGS_UPDATED]) {
        if (type) eventSource.on(type, app.onWorldChanged);
    }
    eventSource.on(event_types.WORLDINFO_ENTRIES_LOADED, app.onEntriesLoaded);
    eventSource.on(event_types.CHAT_CHANGED, app.onChatChanged);
    eventSource.on(event_types.CHAT_CREATED, app.onChatCreated);
    if (event_types.GROUP_CHAT_CREATED) eventSource.on(event_types.GROUP_CHAT_CREATED, app.onChatCreated);
});

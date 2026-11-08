// 酒馆你害我不浅 —— 入口。三格：世界书 / 预设 / API，共用「跟着聊天走」。
import { eventSource, event_types } from '../../../../script.js';
import { getContext } from '../../../extensions.js';
import { world_names, selected_world_info, world_info, loadWorldInfo, saveWorldInfo } from '../../../world-info.js';
import { callGenericPopup, POPUP_TYPE } from '../../../popup.js';
import { createApp } from './src/ui.mjs';
import { createPresetKeeper } from './src/preset.mjs';
import { oai_settings, openai_setting_names, promptManager, getPresetApplicationPromise } from '../../../openai.js';

// 预设格接到酒馆（聊天补全预设）。照酒馆自己 openai.js / PromptManager.js 的做法：
// - 当前预设名：oai_settings.preset_settings_openai；预设名 → 下拉选项值：openai_setting_names[name]
// - 换预设：把 #settings_preset_openai 设成那个值并触发 change（和手点下拉一样），
//   酒馆的 onSettingsPresetChange 会把预设内容（含 prompt_order）载进 oai_settings；
//   它的完成信号是 getPresetApplicationPromise()，要等它，不能靠定时器
// - 开关和顺序：promptManager.getPromptOrderForCharacter(promptManager.activeCharacter)，
//   原地改这个数组，再 promptManager.render(false) 刷新预设页，promptManager.saveServiceSettings() 存下来
const orderEntry = () => {
    const pm = promptManager; if (!pm?.serviceSettings) return null;
    return pm.getPromptOrderForCharacter(pm.activeCharacter);
};
const wait = ms => new Promise(r => setTimeout(r, ms));
const presetKeeper = createPresetKeeper({
    document,
    getContext,
    chatInfo: () => {
        const c = getContext();
        if (c.chatId == null) return null;
        const who = c.groupId ? 'g:' + c.groupId : 'c:' + (c.characters?.[c.characterId]?.avatar ?? c.characterId);
        return { key: who + '|' + c.chatId, label: (c.groupId ? c.groups?.find(g => String(g.id) === String(c.groupId))?.name : c.characters?.[c.characterId]?.name) + ' · ' + c.chatId };
    },
    toast: (kind, msg) => globalThis.toastr?.[kind]?.(msg),
    confirm: async text => !!await callGenericPopup(text, POPUP_TYPE.CONFIRM),
    prompt: async (title, value) => await callGenericPopup(title, POPUP_TYPE.INPUT, value),
    preset: {
        name: () => oai_settings.preset_settings_openai,
        order: () => (orderEntry() || []).map(x => ({ ...x })),
        setOrder: async order => {
            const pm = promptManager; if (!pm?.serviceSettings) throw new Error('预设页还没准备好');
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
            const value = openai_setting_names?.[name];
            const sel = document.getElementById('settings_preset_openai');
            if (value === undefined || !sel) throw new Error('酒馆里找不到预设「' + name + '」（可能被删了或改了名）');
            jQuery(sel).val(String(value)).trigger('change');
            await getPresetApplicationPromise();
        },
        entryName: id => promptManager?.getPromptById?.(id)?.name || id,
    },
});

const app = createApp({
    presetKeeper,
    document,
    getContext,
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
    presetKeeper.onChatChanged();
    eventSource.on(event_types.CHAT_CHANGED, presetKeeper.onChatChanged);
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

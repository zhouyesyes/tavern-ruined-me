// 酒馆你害我不浅 —— 入口。三格：世界书 / 预设 / API，共用「跟着聊天走」。
import { eventSource, event_types } from '../../../../script.js';
import { getContext } from '../../../extensions.js';
import { world_names, selected_world_info, world_info, loadWorldInfo, saveWorldInfo } from '../../../world-info.js';
import { callGenericPopup, POPUP_TYPE } from '../../../popup.js';
import { createApp } from './src/ui.mjs';
import { createPresetKeeper } from './src/preset.mjs';
import { oai_settings, promptManager } from '../../../openai.js';

// 预设格接到酒馆（聊天补全预设）：开关和顺序在 oai_settings.prompt_order 里
const orderList = () => {
    const list = oai_settings.prompt_order || [];
    const mine = list.find(x => String(x.character_id) === '100001') || list[0];
    return mine?.order || [];
};
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
        order: () => orderList().map(x => ({ ...x })),
        setOrder: async order => { const cur = orderList(); cur.splice(0, cur.length, ...order); promptManager?.render?.(false); getContext().saveSettingsDebounced?.(); },
        select: async name => {
            const sel = document.getElementById('settings_preset_openai');
            const opt = [...(sel?.options || [])].find(o => o.textContent === name);
            if (!opt) return;
            sel.value = opt.value; sel.dispatchEvent(new Event('change', { bubbles: true }));
            await new Promise(r => setTimeout(r, 800)); // 等酒馆把预设载完
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

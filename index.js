// 酒馆你害我不浅 —— 入口。三格：世界书 / 预设 / API，共用「跟着聊天走」。
import { eventSource, event_types } from '../../../../script.js';
import { getContext } from '../../../extensions.js';
import { world_names, loadWorldInfo, saveWorldInfo } from '../../../world-info.js';
import { callGenericPopup, POPUP_TYPE } from '../../../popup.js';
import { createApp } from './src/ui.mjs';

const app = createApp({
    document,
    getContext,
    worldNames: () => world_names,
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
    eventSource.on(event_types.WORLDINFO_ENTRIES_LOADED, app.onEntriesLoaded);
    eventSource.on(event_types.CHAT_CHANGED, app.onChatChanged);
    eventSource.on(event_types.CHAT_CREATED, app.onChatCreated);
    if (event_types.GROUP_CHAT_CREATED) eventSource.on(event_types.GROUP_CHAT_CREATED, app.onChatCreated);
});

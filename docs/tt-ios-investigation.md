# TT iOS 滚动与全屏排查（2026-11-10）

核对 Darkatse/TauriTavern main `85dc990`，不是拿 SillyTavern 或桌面 Tauri 行为推断手机能力。

## 全屏

- 官方 iOS 文档第 4 节规定：WKWebView 元素全屏使用标准浏览器 Fullscreen API，不增加 JS-native bridge。
- 桌面 F11 的原生窗口全屏契约排除移动端。因此插件不能因 `__TAURI__.window` 存在就优先调用它。当前本地修正：iPhone / iPad / Android 跳过桌面窗口探测，在点击事件中直接发起元素全屏，保留用户激活。
- iOS 原生布局说明明确：普通窗口始终避让安全区，没有 iOS 沉浸模式。元素全屏与普通窗口 full-bleed 不是同一功能。#426 报告了 2.4.0 上下区域不属于网页视口的现象；作者回复其背景跟随壁纸。不能由此承诺 CSS 能隐藏系统栏。
- 用户确认 iOS 18、TT 2.4.0，截图报错为 `Plugin window not initialized`，吻合误调用桌面窗口接口的失败路径。接口选择回归通过；修正后的元素全屏仍需 iPhone 真机验收。

## 滚动

- `src/scripts/BulkEditOverlay.js` 的 `onPageLoad` 为角色卡绑定未声明 passive 的 touchstart / touchmove；两个处理器本身不取消默认滚动。这是值得在宿主修复和测量的候选，不能将源码发现等同于实测根因。
- `src/scripts/utils.js` 的 `addLongPressEvent` 在 document 上安装显式非 passive 的 touchstart；人设页面为世界书按钮调用该函数。它可能让触摸路径等待主线程，但其匿名监听及长按取消语义属于宿主，扩展不应全局改写 addEventListener 或拦截他人事件来冒充修复。
- 原生 `ios_window_layout.rs` 已设置 delaysContentTouches=false，并让收键盘 pan 和网页内部 pan 同时识别。不能再凭默认 UIKit 延迟推断用户的问题。
- 未找到已确认针对「角色及人设手指滑动后延迟起动」的现成修复。需要用户版本和真实设备性能数据，将主线程阻塞与原生手势等待分开；减少模糊阴影没有改善时不应继续当成解决方案。

## 来源

- https://github.com/Darkatse/TauriTavern/blob/main/docs/iOSDevelopment.md
- https://github.com/Darkatse/TauriTavern/blob/main/docs/CurrentState/MobileStyleAdaptation.md
- https://github.com/Darkatse/TauriTavern/blob/main/src/scripts/BulkEditOverlay.js
- https://github.com/Darkatse/TauriTavern/blob/main/src/scripts/utils.js
- https://github.com/Darkatse/TauriTavern/blob/main/src-tauri/crates/tauritavern/src/platform/ios_window_layout.rs
- https://github.com/Darkatse/TauriTavern/issues/426
- https://github.com/Darkatse/TauriTavern/blob/main/docs/FrontendGuide.md#101-轻量性能仪表perf-hud

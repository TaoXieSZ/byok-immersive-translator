# Design

## Source of truth

- Status: Active
- Last refreshed: 2026-08-06
- Primary product surfaces: 网页悬浮翻译控制器、段落魔法镜、扩展 Popup、Provider 与外观设置页
- Evidence reviewed: `extension/src/content/floating-controller.mjs`、`extension/src/content/magic-lens-controller.mjs`、`extension/src/options/`、`extension/src/popup/`、`docs/features/paragraph-magic-lens/README.md`、`docs/plans/icon-refresh/2026-07-30-icon-refresh-design.md`、相关 Node 测试与真实页面截图

## Brand

- Personality: 安静、可信、专注阅读；工具应像页面边缘的阅读助手，而不是强势覆盖层。
- Trust signals: BYOK、本地保存 Token、最小网站权限、明确显示原文和译文边界。
- Avoid: 挡住正文、抢占网站原生操作、难以撤销的自动行为、持续吸引注意力的动画。

## Product goals

- Goals: 让用户低负担地开始、观察和撤销网页翻译；局部翻译必须由用户明确触发。
- Non-goals: 替换网页导航、重排原站布局、自动上传未选择的页面数据、建立新的通用设计系统。
- Success signals: 入口容易找到但不遮挡阅读；拖动和点击不会混淆；状态、错误和恢复操作可理解。

## Personas and jobs

- Primary personas: 阅读外语技术文章、文档和长文的桌面浏览器用户。
- User jobs: 快速翻译正文、临时翻译选区、随时恢复原文、避开网页已有的悬浮控件。
- Key contexts of use: 内容密集长页、右下角已有客服/回顶按钮的站点、鼠标与触控板操作、Chrome 与 macOS Safari。

## Information architecture

- Primary navigation: 浏览器工具栏 Popup 负责进入与权限；页面悬浮按钮负责当前页翻译；设置页负责 Provider 与外观。
- Core routes/screens: Popup、Options、网页悬浮控制面板、段落魔法镜。
- Content hierarchy: 原网页内容最高优先；扩展控制器靠边且可避让；状态和恢复操作优先于次级设置。

## Design principles

- 阅读优先: 页面正文和原站操作必须始终可见、可点，扩展 UI 可移动、可收起。
- 明确触发: 点击、拖动、翻译和恢复是不同意图；拖动不得触发翻译或恢复。
- 渐进复杂度: 默认行为无需配置，高级能力在需要时出现。
- Tradeoffs: 第一版用全局边缘位置偏好换取简单一致；暂不按域名保存，也不自动隐藏入口。

## Visual language

- Color: 海军蓝 `#172B3D`、珊瑚红 `#D95B40`、米白 `#F5EFE4`、暖白 `#FFFDF8`。
- Typography: 系统无衬线用于控件，阅读标题可用系统衬线；不加载远程字体。
- Spacing/layout rhythm: 4px 基础节奏，页面浮层保留至少 12px 安全边距。
- Shape/radius/elevation: 软圆角、有限阴影；层级清楚但不模拟网页原生内容。
- Motion: 160–220ms 的短过渡；遵守 `prefers-reduced-motion`。
- Imagery/iconography: Manifest 与面板使用 B2，对页内翻译动作使用 A3。

## Components

- Existing components to reuse: `.launcher`、`.panel`、段落魔法镜触发器、Popup 原生按钮。
- New/changed components: `.launcher` 支持拖动、左右贴边、键盘移动和位置恢复。
- Variants and states: idle、starting、translating、stopped、completed、error、dragging、left-docked、right-docked。
- Token/component ownership: 页面悬浮控制器的样式和位置算法由 `floating-controller.mjs` 所有；持久化 schema 由共享偏好模块所有。

## Accessibility

- Target standard: 原生语义与 WCAG 2.2 AA 的键盘、焦点、对比度基线。
- Keyboard/focus behavior: Enter/Space 保持按钮动作；Shift+方向键移动按钮；焦点轮廓始终可见。
- Contrast/readability: 控件文字和状态满足可读性；翻译内容不覆盖原文。
- Screen-reader semantics: 使用原生 `button`、动态 `aria-label`、`aria-expanded`、`aria-live`。
- Reduced motion and sensory considerations: 减少动态偏好下禁用拖动/面板装饰动画，但不移除位置反馈。

## Responsive behavior

- Supported breakpoints/devices: 桌面 Chrome、macOS Safari，以及现有窄视口兼容路径。
- Layout adaptations: 悬浮按钮始终完整留在 viewport，使用垂直比例适配窗口变化；面板朝可用空间展开。
- Touch/hover differences: 触控拖动使用 `touch-action: none`；不依赖 hover 才能发现或操作。

## Interaction states

- Loading: starting 状态显示忙碌语义，忽略重复启动。
- Empty: idle 保持可直接开始翻译。
- Error: 展开面板并在 `aria-live` 区域显示可恢复错误。
- Success: 进度和完成计数清晰，仍可一键恢复原文。
- Disabled: 无可用操作时禁用对应面板按钮。
- Offline/slow network: 保留暂停、重试、恢复入口；拖动位置不依赖网络。

## Content voice

- Tone: 简洁、具体、避免技术负担。
- Terminology: 使用“开始翻译”“恢复原文”“翻译设置”“拖动可移动位置”。
- Microcopy rules: 先说动作和结果；错误不泄露 Token、Provider 地址或页面正文。

## Implementation constraints

- Framework/styling system: 原生 WebExtension、ES modules、closed Shadow DOM，无运行时依赖。
- Design-token constraints: 复用现有 BYOK CSS variables，不新增设计系统层。
- Performance constraints: 拖动只更新本地样式；持久化仅在拖动结束或键盘移动后发生。
- Compatibility constraints: Chrome MV3 与 Safari 16.4+；内容脚本不能直接访问被限制为 trusted contexts 的 `storage.local`，必须通过后台消息。
- Test/screenshot expectations: 纯函数覆盖拖动阈值、贴边、clamp、键盘移动和坏数据回退；后台集成测试覆盖安全读写；真实页检查拖动不误触和刷新后恢复。

## Open questions

- [ ] 是否在后续版本加入闲置边缘折叠；需先验证可发现性和触控命中区域。
- [ ] 是否增加“隐藏本页按钮”；需先设计从 Popup 恢复的明确路径。
- [ ] 是否按域名保存位置；只有全局位置在真实站点上明显不足时再增加该隐私和存储复杂度。

## ADDED Requirements

### Requirement: 仅为有效网页选区提供显式入口
扩展 SHALL 在普通网页中为规范化后包含有意义字符且长度为 1 至 2000 个字符的受支持选区显示魔法镜按钮，并 MUST 在用户点击该按钮前保持完全本地且不发起翻译请求。

#### Scenario: 用户选择有效文本
- **WHEN** 用户在受支持的正文元素内完成有效选区
- **THEN** 扩展在选区附近显示魔法镜按钮且不发送远端消息

#### Scenario: 用户点击魔法镜按钮
- **WHEN** 有效选区仍与本地快照一致且用户点击魔法镜按钮
- **THEN** 扩展固定该选区、打开 loading 卡片并提交单个选区翻译请求

#### Scenario: 选区不受支持
- **WHEN** 选区为空、仅含标点、超过长度上限、跨越不兼容内容根，或位于输入控件、可编辑区域、`pre`、`code`、扩展译文或魔法镜界面中
- **THEN** 扩展不显示入口且不发出翻译请求

### Requirement: 使用受限段落上下文只翻译选中文字
扩展 SHALL 将选中文字和所在安全语义段落的规范化纯文本分别提交，并 MUST 将上下文限制为最多 4000 个字符且仅用于消歧。远端结果 MUST 只包含所选文本的译文。

#### Scenario: 所在段落可安全提取
- **WHEN** 用户点击有效选区的魔法镜按钮且所在语义段落超过或等于选区范围
- **THEN** 请求包含选中文字及覆盖该选区的有界段落上下文，并要求 Provider 只翻译选中文字

#### Scenario: 找不到安全语义段落
- **WHEN** 有效选区无法归属一个可安全提取的语义段落
- **THEN** 扩展把上下文退化为选中文字本身而不读取相邻段落

#### Scenario: 页面包含敏感或无关数据
- **WHEN** Content Script 构造选区请求
- **THEN** 请求不包含 DOM、HTML、页面 URL、Cookie、样式、元素属性、表单值、相邻段落、Provider 凭据或任意请求覆盖

### Requirement: 由可信后台执行选区翻译
Service Worker MUST 严格验证选区消息并使用当前已保存 Provider 构造请求，MUST NOT 接受由 Content Script 指定的 Provider ID、Base URL、模型、认证头、并发或重试参数。

#### Scenario: 合法选区请求
- **WHEN** Service Worker 收到包含有效 `requestId`、目标语言、选中文字、受限上下文和可选缓存绕过标记的消息
- **THEN** Service Worker 使用当前 Provider 和共享调度限制执行单段翻译

#### Scenario: 消息包含越权字段
- **WHEN** 选区消息包含未授权字段、超长内容、任意 URL、Provider 覆盖、请求头或非法缓存标记
- **THEN** Service Worker 拒绝消息且不读取凭据或发出远端请求

#### Scenario: 没有可用 Provider
- **WHEN** 用户点击魔法镜但不存在当前可用 Provider
- **THEN** 卡片显示可操作错误并允许用户打开翻译设置，页面正文保持不变

### Requirement: 卡片及时展示安全译文和明确状态
扩展 SHALL 在点击后立即显示 loading 卡片，在 Provider 支持时流式展示纯文本译文，并 MUST 将模型输出作为不可执行文本处理。卡片 SHALL 提供 loading、streaming、complete 和可重试 error 状态。

#### Scenario: 流式翻译成功
- **WHEN** Provider 返回属于当前 `requestId` 的有效流式片段并正常完成
- **THEN** 卡片逐步显示安全文本并在完成后启用复制和重新翻译操作

#### Scenario: 缓存命中
- **WHEN** 当前选区、上下文和翻译配置命中完整验证缓存
- **THEN** 卡片不发出远端请求并以 300ms 为目标展示完成结果

#### Scenario: Provider 输出包含 HTML
- **WHEN** Provider 的选区译文包含标签、脚本或样式字符
- **THEN** 卡片把这些内容显示为普通文本且不创建可执行页面节点

#### Scenario: 翻译失败
- **WHEN** 请求遇到认证、模型、限流、网络或无效响应错误
- **THEN** 卡片显示安全且可操作的错误，不泄露 Token、请求头、完整上下文或 Provider 内部配置

### Requirement: 提供轻量卡片操作
完成状态的魔法镜卡片 SHALL 允许用户复制译文、复制双语、重新翻译和关闭，并 MUST 在操作失败时提供卡片内反馈而不修改原始网页内容。

#### Scenario: 复制译文
- **WHEN** 用户点击“复制译文”且 Clipboard API 成功
- **THEN** 剪贴板只包含完成的译文且卡片显示成功反馈

#### Scenario: 复制双语
- **WHEN** 用户点击“复制双语”
- **THEN** 剪贴板包含规范化原文、一个换行分隔和完成译文，不包含隐藏上下文

#### Scenario: 重新翻译
- **WHEN** 用户点击“重新翻译”
- **THEN** 扩展以相同选区快照显式绕过读取缓存，立即返回 loading，并在新结果验证完成后原子替换旧译文

#### Scenario: 复制失败
- **WHEN** 浏览器拒绝 Clipboard API 或写入失败
- **THEN** 卡片保留译文并显示失败反馈，不请求额外权限或删除结果

### Requirement: 隔离选区请求生命周期与整页翻译
魔法镜 SHALL 使用独立 `requestId`、取消作用域和 UI 状态，MUST NOT 加入或改变整页翻译的 block、范围、进度、停止、重试或恢复原文状态。

#### Scenario: 整页翻译正在运行
- **WHEN** 用户在活动整页 session 期间发起魔法镜翻译
- **THEN** 两种翻译独立继续，任一方的完成或错误不改变另一方的进度和控制状态

#### Scenario: 用户关闭或建立新选区
- **WHEN** 卡片处于 loading 或 streaming 且用户关闭卡片、按 `Esc`、点击外部、建立新选区或页面离开
- **THEN** 扩展取消当前选区作用域并使其 `requestId` 失效

#### Scenario: 旧响应迟到
- **WHEN** 已失效 `requestId` 的流式片段、完成或错误消息随后到达
- **THEN** Content Script 丢弃消息且不重新打开、覆盖或移动当前卡片

#### Scenario: 恢复整页原文
- **WHEN** 用户对整页翻译执行恢复原文
- **THEN** 扩展只移除整页翻译节点，不把魔法镜卡片或选择状态计入恢复操作

### Requirement: 按上下文隔离完整选区缓存
扩展 MUST 仅缓存完成且验证后的选区译文，并 SHALL 以选区模式、Provider、模型、目标语言、Prompt 与响应 schema、选中文字哈希和上下文哈希共同区分缓存。缓存记录 MUST NOT 保存选区或上下文明文。

#### Scenario: 相同短语出现在不同上下文
- **WHEN** 相同选中文字在不同规范化段落上下文中发起翻译
- **THEN** 扩展生成不同缓存键且不复用可能语义不一致的译文

#### Scenario: 上下文只有空白差异
- **WHEN** 两个选区请求的上下文仅在可规范化空白上不同且其他维度一致
- **THEN** 扩展允许它们命中同一选区缓存条目

#### Scenario: 不完整或失败结果
- **WHEN** 流式请求未完成、被取消、返回无效结果或进入错误状态
- **THEN** 扩展不写入选区缓存

### Requirement: 卡片保持视口内且可通过键盘操作
魔法镜按钮和卡片 SHALL 使用隔离的 Shadow DOM、原生可操作控件、可见焦点和状态播报，并 SHALL 锚定有效选区且限制在视口安全边距内。

#### Scenario: 选区靠近视口边缘
- **WHEN** 按钮或卡片按首选方向布局会超出当前视口
- **THEN** 扩展翻转或限制位置，使主要控件保持可见且不改变页面布局

#### Scenario: 页面滚动或窗口变化
- **WHEN** 卡片打开期间发生滚动或窗口尺寸变化且选区仍有效
- **THEN** 扩展在动画帧中重新定位卡片而不连续触发布局抖动

#### Scenario: 键盘关闭卡片
- **WHEN** 魔法镜入口或卡片打开且用户按下 `Esc`
- **THEN** 扩展关闭当前入口和卡片、使请求失效，并把控制权返回页面

#### Scenario: 网站样式具有冲突规则
- **WHEN** 页面定义全局按钮、字体、动画或高优先级普通选择器
- **THEN** 魔法镜的视觉和交互仍由 Shadow DOM 内样式控制，不污染网页自身元素

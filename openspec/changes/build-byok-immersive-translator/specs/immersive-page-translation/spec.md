## ADDED Requirements

### Requirement: 手动控制当前页翻译
扩展 SHALL 允许用户从 Popup 对当前活动的普通 HTTP 或 HTTPS 页面开始翻译，并 SHALL 显示当前 session 的排队、翻译完成和失败数量。

#### Scenario: 开始当前页翻译
- **WHEN** 用户已选择可用 provider 并点击开始翻译
- **THEN** 扩展在当前标签页建立新的翻译 session、提取候选块并显示进度

#### Scenario: 缺少可用 provider
- **WHEN** 用户在没有已授权可用 provider 时点击开始翻译
- **THEN** 扩展不修改页面，并引导用户打开配置页

#### Scenario: 页面不允许注入
- **WHEN** 当前页是浏览器内部页面或其他禁止 Content Script 注入的页面
- **THEN** 扩展显示该页面无法翻译，而不报告虚假成功

### Requirement: 提取适合翻译的可见文本块
扩展 MUST 按 DOM 顺序识别可见的语义文本块，并 MUST 排除脚本、样式、表单控件、代码、可编辑区域、纯标点、不可见内容和扩展自身插入的节点。父子候选块 MUST 去重，避免同一文本重复提交。

#### Scenario: 普通文章页面
- **WHEN** 页面包含标题、段落、列表项和引用
- **THEN** 扩展按阅读顺序生成不重复且带稳定 ID 的候选块

#### Scenario: 页面包含不可翻译内容
- **WHEN** 页面同时包含脚本、样式、代码块、输入框和隐藏文本
- **THEN** 这些内容不进入任何远端翻译请求

#### Scenario: 页面没有候选文本
- **WHEN** 当前页面不存在符合条件的可见文本块
- **THEN** 扩展保持页面不变并显示没有可翻译内容

### Requirement: 分批请求并严格映射译文
扩展 SHALL 按条目数和字符预算对候选块分批，并 MUST 要求 provider 返回 block ID 到纯文本译文的映射。系统 MUST 在渲染前验证响应仅包含当前批次 ID 且每个译文为字符串。

#### Scenario: 批次响应完整
- **WHEN** provider 返回当前批次所有 block ID 的有效译文
- **THEN** 扩展把每个译文渲染到对应原文块，不受响应字段顺序影响

#### Scenario: 批次响应缺项或格式错误
- **WHEN** provider 返回未知 ID、缺少预期 ID或无法解析的响应
- **THEN** 扩展不猜测映射，最多重试该批次一次，并在再次失败后把相关块标记为失败

#### Scenario: 某一批请求失败
- **WHEN** 一个批次遇到网络、认证、限流或服务端错误
- **THEN** 其他成功批次保持已翻译状态，失败批次保持原文并可单独重试

### Requirement: 保留原文并安全插入译文
扩展 MUST 保留原始 DOM 内容，并 SHALL 在对应文本块后插入带扩展标记的纯文本译文元素。任何 provider 输出 MUST 作为文本处理，不得作为 HTML 或脚本执行。

#### Scenario: 渲染成功译文
- **WHEN** 一个文本块收到已验证的译文
- **THEN** 原文内容和内联格式保持不变，译文紧随其后且具有可识别的双语样式

#### Scenario: 译文包含 HTML 字符串
- **WHEN** provider 输出包含标签或脚本样式的字符
- **THEN** 页面将其显示为普通文本且不创建可执行节点

#### Scenario: 重复收到同一结果
- **WHEN** 同一 session 的同一 block ID 因重试或迟到响应再次到达
- **THEN** 扩展保持单个译文元素，不重复插入

### Requirement: 停止、重试与恢复原文
扩展 SHALL 允许用户停止活动 session、重试失败块并恢复原文。停止后 MUST 不再提交新批次，迟到或属于旧 session 的响应 MUST 被忽略。

#### Scenario: 停止正在进行的翻译
- **WHEN** 用户点击停止
- **THEN** 扩展取消或忽略尚未完成的请求、不再提交新批次，并保留已经成功插入的译文

#### Scenario: 重试失败块
- **WHEN** 用户在存在失败块时点击重试
- **THEN** 扩展只重新提交失败块，不重复翻译成功块

#### Scenario: 恢复原文
- **WHEN** 用户点击恢复原文
- **THEN** 扩展只移除该扩展添加的译文节点和状态标记，不改变页面原有节点

#### Scenario: 旧 session 响应迟到
- **WHEN** 页面已开始新 session 或恢复原文后收到旧 session 的响应
- **THEN** 扩展丢弃该响应且不修改页面

### Requirement: 翻译动态加入的页面内容
活动翻译 session SHALL 观察新加入的页面内容，对新增候选块进行合并、去重和追加翻译，而 MUST NOT 因单次 DOM 变化重新翻译整个页面。

#### Scenario: 无限滚动加载新段落
- **WHEN** 活动 session 所在页面追加新的可见文章段落
- **THEN** 扩展只把尚未处理的新段落加入后续批次

#### Scenario: 扩展插入译文触发观察器
- **WHEN** 扩展自己的译文节点出现在 DOM 变化记录中
- **THEN** 观察器忽略这些节点，不产生递归翻译

### Requirement: 页面内容最小化传输
扩展 MUST 只向当前选中的 provider 发送完成翻译所需的候选文本、稳定 ID、目标语言和翻译指令，MUST NOT 附带完整页面 HTML、Cookie、表单值或浏览历史。

#### Scenario: 构造远端翻译请求
- **WHEN** Service Worker 接收一个有效文本批次
- **THEN** 请求载荷不包含完整 DOM、当前页面 Cookie、未选中文本或 API Key 之外的浏览器数据

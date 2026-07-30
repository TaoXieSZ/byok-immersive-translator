## Context

当前扩展是零运行时依赖的 Manifest V3 Chrome/Chromium 扩展。Popup 通过 `activeTab` 注入 Content Script，页面控制器、文本提取和 session 状态机运行在 Content Script 中；Service Worker 持有 Provider 凭据、发送 OpenAI-compatible 请求并执行共享并发限制。

现有悬浮按钮单击只展开面板，用户仍需先打开 Popup 才能注入；启动流程同步扫描整页、为全部块插入 loading，再以固定并发发送非流式 JSON 批次。这个路径把首段反馈绑定到整页 DOM 成本和完整模型响应，且没有跨块去重、会话缓存或过载自适应。

本变更跨 Manifest 权限、动态 Content Script 注册、页面调度、消息协议、Provider adapter、缓存与测试。安全边界保持不变：API Key 只存在于可信扩展上下文；Content Script 不能指定 URL、模型或认证头；Provider 输出只通过 `textContent` 渲染；网页正文默认不持久化。

相关平台约束：

- `activeTab` 权限只在用户手势后临时授予，并会在跨 origin 导航后撤销，因此不能单独提供始终存在的页面按钮。
- Chrome `optional_host_permissions` 与动态 Content Script 注册允许用户自愿授权后持久注入，并允许撤销后回退。
- Chat Completions 流式输出适合降低首个可见结果时间，但多条 ID 到译文的 JSON 映射在响应完成前不能安全提交。

参考：

- [Chrome activeTab](https://developer.chrome.com/docs/extensions/develop/concepts/activeTab)
- [Chrome optional permissions](https://developer.chrome.com/docs/extensions/develop/concepts/declare-permissions)
- [Chrome scripting API](https://developer.chrome.com/docs/extensions/reference/api/scripting)
- [DeepSeek streaming FAQ](https://api-docs.deepseek.com/faq)

## Goals / Non-Goals

**Goals:**

- 空闲悬浮按钮单击即可启动翻译，启动后不自动遮挡正文。
- 经用户可选授权后，普通网页无需先打开 Popup 即可出现控制器；拒绝授权仍可正常使用。
- 将点击到 loading、首个请求、首个 token 和视口完成变成可测量预算。
- 以首屏单段流式通道降低感知延迟，以去重、缓存、批量和自适应并发提高整页吞吐。
- 默认翻译主要内容，同时提供整个页面范围和快捷键。
- 保持现有配置、取消、迟到响应丢弃、凭据隔离和纯文本渲染兼容。

**Non-Goals:**

- 本次不实现鼠标悬停翻译、划词弹窗、PDF、字幕或图片 OCR。
- 本次不建设云端缓存、账号同步、翻译代理或自有后端。
- 本次不承诺第三方 Provider 的绝对网络延迟；验收预算在确定性 stub 下验证扩展开销，真实 Provider 指标作为观测数据。
- 本次不增加运行时第三方依赖，也不为每个站点建立专用规则库；提取器只保留后续规则扩展点。

## Decisions

### 1. 悬浮按钮按 session 状态分派单击行为

控制器使用 `idle | starting | translating | stopped | completed | completed-with-errors` 状态。`idle` 单击发送与 Popup 相同的开始命令并保持面板折叠；页面进入翻译中、停止、完成或部分失败状态后再次单击，会取消仍在进行的工作、移除译文并恢复原文。`starting` 状态立即写入并忽略快速连点，防止建立重复 session。缺少 Provider 或页面无文本时才展开面板显示可操作错误。

替代方案是始终先开面板再确认。它保留更多显式控制，但无法满足一次点击开始，且增加高频阅读操作的摩擦。

### 2. 网站访问采用可选授权、动态持久注册和 `activeTab` 回退

Options 增加“一键页面入口”权限说明与开关。用户开启时请求普通 HTTP/HTTPS 的可选 host permission；成功后由 Service Worker 通过 `chrome.scripting.registerContentScripts` 注册固定 ID 的脚本，设置 `persistAcrossSessions: true` 并在启动时幂等核对。撤销权限时注销脚本。已有 Popup 注入继续作为未授权或撤销后的回退，并通过页面 bootstrap 标记保证幂等。

不把全站 host permission 改为必需权限，因为这会扩大安装时授权面并削弱用户信任。也不依赖每次导航由 Service Worker 手工注入，因为事件页休眠和竞态会使控制器出现不稳定。

### 3. Content Script 采用渐进发现和可重排优先队列

启动路径只同步发现当前视口和可信主要内容容器的首批候选块，立即插入轻量 loading；其余 DOM 通过 `requestIdleCallback` 分片扫描，并提供超时回退以避免空闲回调饥饿。队列项保留稳定 block ID、规范化文本哈希、视口级别、正文级别和 DOM 顺序。节流后的 scroll/resize 只重排尚未提交项，不取消已在途请求。

主要内容选择按 `article`、`main`、`[role=main]` 和正文密度启发式依次判断；无法可靠识别时回退到当前视口优先的安全候选块。整个页面模式复用既有排除规则。

替代方案是继续一次性 `querySelectorAll` 后排序。实现简单，但长页启动成本仍在关键路径上，滚动后优先级也会过期。

### 4. 极速通道使用单段纯文本流，吞吐通道保留批量 JSON

消息协议新增带 session ID 和 block ID 的 stream start/chunk/complete/error 事件。极速通道每次只翻译一个当前视口块，提示词要求纯文本，adapter 解析 SSE `data:` 帧并把增量文本转发给原发起 tab。只有收到完成事件且 session 仍有效时，Content Script 才把结果标记为 translated 并写缓存；部分输出可显示为临时文本，但失败时必须清除，随后最多回退一次非流式单段请求。

后台通道继续使用严格的 ID→译文 JSON 批次，因为它提供更高吞吐和完整映射验证。对不支持流式的 Provider，极速通道退化为单段非流式请求，不阻塞后台批次。

替代方案是让批量 JSON 也流式渲染。JSON key/value 在流结束前可能不完整或被模型修正，增量映射会破坏“验证后渲染”的安全与正确性边界。

### 5. 去重与缓存位于 Content Script，缓存由可信 Service Worker 托管

Content Script 在当前页面按规范化文本和翻译上下文建立 canonical block，将重复 DOM 块扇出到一个请求结果。它只把原文哈希和请求项发给 Service Worker。Service Worker 使用 `chrome.storage.session` 保存已验证最终译文，键由 provider ID、模型、目标语言、提示词版本、响应协议版本和原文哈希构成；值只包含最终译文和会话元数据，不保存原文。浏览器不支持 session storage 时使用 Service Worker 内存 Map。

目标语言跳过使用轻量 Unicode 脚本比例判定，只在高置信度时跳过；混合语言或短文本继续翻译，避免误判。

替代方案是使用 `chrome.storage.local` 建立持久缓存。命中率可能更高，但会在磁盘保留可关联的阅读内容，不符合默认隐私边界。

### 6. Service Worker 统一拥有 Provider 调度器

固定全局 permit 池替换为按 provider ID 保存的调度状态：`currentConcurrency`、`min`、`initial`、`max`、成功计数和冷却截止时间。DeepSeek 内置画像为流式、初始 6、范围 2–8；未知自定义 Provider 为非流式、初始 3。429/503 或连续高延迟触发乘法降速和带抖动退避，尊重合法 `Retry-After`；连续成功达到阈值后每次增加 1。等待项绑定 session，取消时同时清除排队、退避和 `AbortController`。

Content Script 只表达通道和请求项，不得传入并发、URL、模型或认证覆盖。共享运行限制模块导出画像约束和纯调度算法，使内容侧预取窗口与后台真实上限使用同一来源。

替代方案是只把固定并发从 3 调高。它在低限制 Provider 上更容易产生 429，也无法在过载后恢复。

### 7. 性能事件使用统一单调时间线

session 在用户命令到达 Content Script 时创建 `performance.now()` 基点。内容侧记录 loading、提取、请求发起、首 token、视口完成和全页完成；后台记录排队、permit、fetch、首 SSE 帧、完成、429 和并发变化。跨上下文事件都携带 session ID、通道和索引，耗时以各上下文 duration 记录，不比较不同时间原点的绝对值。

测试新增确定性 provider stub 和 122 块长文章 fixture，分别断言扩展预算、请求数、滚动重排、缓存和退避。真实网站手测报告 Provider 网络耗时，但不把互联网波动作为单元测试门禁。

替代方案是只观察控制器总时长。总时长无法区分 DOM、排队、网络和模型瓶颈，后续优化容易误判。

### 8. 快捷键复用同一命令入口

Manifest 声明两个 `commands`：翻译/原文切换默认建议 `Alt+A`，整个页面翻译默认建议 `Alt+W`；若平台快捷键冲突，用户可在浏览器扩展快捷键页调整。Service Worker 把命令转发给活动普通网页，必要时走与 Popup 相同的 `activeTab` 注入。所有入口最终调用 Content Script 的单一 session command handler。

不为快捷键建立独立翻译路径，因为那会复制权限、状态与取消逻辑。

## Risks / Trade-offs

- [全站可选权限可能让用户犹豫] → 在 Options 明确说明用途、保持默认关闭，并保证拒绝后 Popup/`activeTab` 完整可用。
- [流式 SSE 在不同 OpenAI-compatible Provider 上存在差异] → 仅对内置或用户显式确认的能力启用；解析失败自动回退非流式，且不缓存部分结果。
- [提高 DeepSeek 并发可能增加费用或触发账户级限制] → 设置 2–8 硬边界、429/503 乘法降速、可取消队列，并在日志显示请求数而不记录正文。
- [语言检测误判导致漏译] → 只在高置信度目标语言占比时跳过，混合文本保守提交，并为判定函数添加多脚本测试。
- [DOM 分片扫描可能漏掉复杂站点内容] → 保留 MutationObserver，扫描完成后做一次低优先级校验，并在整个页面模式覆盖完整安全候选集合。
- [页面滚动频繁导致排序开销] → 对 scroll/resize 节流，只重排 queued 项并使用已缓存的几何信息。
- [session 缓存保存译文仍可能包含敏感内容] → 只用 `storage.session` 或内存、提供清除动作、从不记录缓存值或原文。
- [快捷键与网站或系统冲突] → 使用 Chrome commands 的可修改建议键，不在页面捕获全局 `keydown`。

## Migration Plan

1. 先增加消息协议、调度器纯函数、缓存键和性能时间线的测试，不切换现有入口。
2. 实现 Service Worker 双响应通道与自适应调度；保留现有 `TRANSLATE_BATCH` 作为后台兼容路径。
3. 实现渐进提取、去重、目标语言跳过和会话缓存，再把现有开始命令切换到新 orchestrator。
4. 更新悬浮控制器单击状态、主要内容范围和快捷键，Popup 继续调用同一开始命令。
5. 增加可选权限开关与动态 Content Script 注册；默认关闭，验证撤销与 `activeTab` 回退。
6. 在确定性基准通过后更新 DeepSeek 新建预设；已有 Provider 数据只补充缺失的性能默认值，不修改其模型字段。
7. 在目标真实网站进行冷启动、滚动、停止、恢复和浏览器重启手测，记录扩展开销与 Provider 延迟。

回滚时可先关闭动态注册和流式能力开关，恢复 Popup 注入与非流式批次；消息协议在迁移期保留旧批次处理，因此不需要修改或删除用户已有 Provider 数据。

## Open Questions

- DeepSeek 自适应升速所需的连续成功阈值和高延迟阈值，先由确定性压测选取并固化为共享常量，真实试用数据只用于后续独立变更。
- 正文密度启发式的最低置信度需在目标网站和一组新闻、文档、论坛 fixture 上校准；如果稳定性不足，本变更回退到 `article/main/[role=main]` 明确容器而不引入站点规则。

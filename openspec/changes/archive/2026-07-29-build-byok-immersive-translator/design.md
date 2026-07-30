## Context

这是一个从零开始的 Chrome 扩展。用户需要的是由自己控制的沉浸式网页翻译体验，而不是新的翻译后端：扩展负责网页文本识别、请求编排和双语渲染，实际翻译由用户配置的 DeepSeek 或其他 OpenAI-compatible API 完成。

主要约束如下：

- 首版必须能以未打包扩展在 Chrome 中运行。
- 不建设自有服务器，不接触或转存用户的 API Token 与网页正文。
- 页面本身属于不可信执行环境，不能接触 Token 或决定任意跨域请求目标。
- Manifest V3 Service Worker 可能被浏览器回收，流程不能依赖永久驻留的内存状态。
- 不复用沉浸式翻译官方插件的代码、资源、品牌或私有接口。

## Goals / Non-Goals

**Goals:**

- 建立可独立加载、配置和使用的 Chrome Manifest V3 扩展。
- 支持多个用户自有的 OpenAI-compatible 服务配置，并内置 DeepSeek 配置预设。
- 对普通文章页面和动态加载页面提供稳定的原文下方译文展示。
- 将页面操作、敏感配置和远程请求分隔在不同扩展上下文。
- 对无效配置、权限拒绝、限流、网络错误和无效模型响应给出可恢复反馈。
- 保持运行时无第三方服务依赖，并使核心提取、分批和映射逻辑可自动化测试。

**Non-Goals:**

- 不提供账号、云同步、共享 Token、代理服务器或计费服务。
- 不处理 PDF 阅读器、视频字幕、图片 OCR、输入框翻译和移动浏览器。
- 不承诺绕过需要登录、反爬限制或浏览器禁止注入的页面。
- 不在首版提供自动翻译站点规则、术语库或持久化翻译缓存。
- 不追求与沉浸式翻译官方插件的界面或全部功能一致。

## Decisions

### 1. 使用 Manifest V3 的四上下文边界

扩展分为以下部分：

- Popup：显示当前页状态，触发开始、停止、重试和恢复原文。
- Options：管理服务配置、目标语言并执行连接测试。
- Service Worker：读取敏感配置、校验消息、调用固定的已选服务端点并归一化错误。
- Content Script：提取页面块、提交带稳定 ID 的文本、插入纯文本译文并观察动态内容。

Content Script 只发送翻译任务，不传入请求 URL、请求头或 Token。Service Worker 根据已保存的 provider ID 自行构造请求，拒绝未知消息类型和越界载荷。

选择这一结构是为了把不可信网页与跨域权限、Token 隔开。备选方案是在 Content Script 中直接请求 API，但它同时受网页跨域环境影响，并扩大凭据暴露面，因此拒绝。

### 2. 使用轻量、无运行时框架的浏览器原生实现

首版使用浏览器原生 ES modules、DOM API、`fetch` 和 `chrome.*` API；核心纯函数使用 Node 内置测试运行器验证。代码按职责拆分为可测试模块，但不引入 UI 框架、状态管理框架或远程托管代码。

选择该方案是因为仓库为空、界面规模有限，能够减少供应链和构建复杂度，并让未打包扩展直接加载。若后续界面或跨浏览器构建复杂度显著增长，再通过独立变更评估构建工具。

### 3. 将 provider 建模为用户可切换的本地配置

每个 provider 保存：

- 稳定 ID 和显示名称
- Base URL
- API Key
- Model
- 默认目标语言
- 可选的请求参数能力标记

DeepSeek 作为预设只预填 Base URL，不写死当前模型名；用户仍可编辑所有字段。远程请求使用 OpenAI-compatible Chat Completions 语义，由 provider adapter 负责端点拼接、请求体和响应归一化。

API Key 存入 `chrome.storage.local`，明确禁止 Chrome Sync，并把该 storage area 的访问级别限制为 trusted extension contexts。该措施能阻止普通页面与 Content Script 读取，但不声称能抵御掌握本机浏览器配置或扩展调试权限的攻击者。

备选方案是由自有代理隐藏 Token，但这会引入服务器、运维和隐私依赖，与目标冲突。

### 4. API 域名采用运行时最小授权

Manifest 声明可选的 HTTP/HTTPS host permissions。用户保存或测试 provider 时，Options 页面从 Base URL 解析出精确 origin，并在明确的用户操作中申请该 origin。Service Worker 只允许请求当前选中且已获授权的 provider origin。

除 loopback 地址外，带 API Key 的远程 provider 必须使用 HTTPS。删除或变更 provider 时，扩展在不影响其他 provider 的前提下移除不再使用的 origin 权限。

备选方案是在安装时申请所有 HTTPS 域名权限，实现更简单但授权范围过大，因此拒绝。

### 5. 以可见文本块为翻译和渲染单位

Content Script 从语义块元素中选择候选内容，例如段落、标题、列表项、引用和表格单元格。它排除脚本、样式、表单、代码、不可见内容、可编辑区域、纯标点以及扩展自己插入的节点，并避免父子块重复翻译。

每个候选块获得当前翻译 session 内唯一且稳定的 ID。原始 DOM 不被替换；译文作为标记过的相邻元素插在原块之后，使用 `textContent` 渲染。恢复原文时只删除本 session 创建的元素和属性。

选择块级翻译是为了在上下文质量、映射稳定性与保留原页面内联格式之间取得平衡。逐文本节点翻译会破坏句子上下文，整体页面翻译则难以可靠映射回 DOM。

### 6. 使用受限批次和显式 ID 映射

候选块按 DOM 顺序分批，每批同时受条目数和字符预算限制。请求提示明确要求返回从 block ID 到纯文本译文的 JSON 对象；支持 JSON response format 的 provider 可以启用对应能力，不支持时仍按文本 JSON 解析。

响应必须满足以下条件后才能渲染：

- 是对象且只包含当前批次允许的 ID。
- 每个期望 ID 对应字符串译文。
- 不接受 HTML、脚本或额外请求指令。

缺项或格式错误的批次只重试一次；仍失败时保留原文并标记该批可重试，不错位插入其他译文。首版使用非流式响应，因为流式 JSON 的中间状态会增加映射和恢复复杂度。

### 7. 翻译过程由可恢复的 session 状态驱动

每次开始翻译生成 session ID。Content Script 保存块级状态：`queued`、`translating`、`translated`、`failed` 或 `cancelled`。Popup 通过消息读取当前标签页的汇总状态。

停止操作阻止新批次提交，并请求 Service Worker 中止当前 session 的活动请求；即使 Service Worker 已被回收，迟到响应也必须携带 session ID，Content Script 会丢弃不匹配的结果。重试只重新排队失败块，恢复原文则清除 session 产生的 DOM。

页面处于活动翻译 session 时，`MutationObserver` 只收集新加入且符合条件的块，并进行短暂合并后追加翻译，避免整个页面重复扫描。

## Risks / Trade-offs

- [LLM 输出无法稳定遵循 JSON 映射] → 严格校验 ID、限制重试并让失败批次保持可重试，绝不猜测对应关系。
- [复杂网页的 DOM 结构导致漏译或重复翻译] → 首版聚焦语义块，建立包含嵌套、隐藏、代码和动态节点的提取测试夹具。
- [API Token 保存在本机仍可被高权限本地用户读取] → 清楚说明安全边界、限制 Content Script 访问并建议用户使用独立且有限额的 Token。
- [自定义服务的 OpenAI compatibility 不完整] → 归一化常见错误，连接测试先验证端点和模型；非兼容差异通过后续 provider adapter 变更扩展。
- [动态页面产生大量 Mutation] → 合并观察事件、去重已标记节点并限制并发和批次预算。
- [Service Worker 生命周期中断请求状态] → 不依赖它保存权威页面状态，以 session ID 和幂等响应处理迟到或丢失结果。
- [最小权限流程增加首次配置步骤] → 在保存或测试服务时解释授权原因，并只请求精确 origin。

## Migration Plan

这是全新项目，无现有用户数据需要迁移。

1. 完成核心模块和自动化测试。
2. 以未打包扩展方式在 Chrome 验证安装、授权、配置和翻译闭环。
3. 使用测试 Token 验证 DeepSeek 预设和一个自定义 OpenAI-compatible 服务。
4. 打包发布前检查权限声明、隐私说明和许可证。

回滚方式是禁用或移除扩展；移除扩展会清除其本地配置，不会改写用户网页或远端数据。

## Open Questions

- 项目正式名称、图标和开源许可证在发布前确定；它们不阻塞 MVP 实现。
- 其他浏览器支持不属于首版范围，后续按需要单独评估。

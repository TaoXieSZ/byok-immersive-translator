## Why

用户希望停止依赖沉浸式翻译官方插件，同时继续获得网页原文与译文并排阅读的体验，并能直接使用自己持有的 DeepSeek 或其他兼容 API Token。当前仓库为空，因此需要先建立一个无自有后端、行为透明且可独立维护的开源 Chrome 扩展基线。

## What Changes

- 新建一个面向 Chrome 的 Manifest V3 浏览器扩展。
- 允许用户配置、测试和选择 DeepSeek 或任意 OpenAI-compatible 翻译服务，包括 Base URL、API Key、模型和目标语言。
- 从网页中识别可翻译文本，分批请求用户选择的 API，并在保留原文和页面结构的前提下插入对应译文。
- 提供手动开始、停止、重试、恢复原文和错误反馈能力。
- 将 Token 与配置保存在本机；扩展不提供自有后端，不上传配置，不通过浏览器同步 Token。
- 将远程请求集中在扩展 Service Worker 中，并仅在用户配置服务时申请所需 API 域名权限。
- 首版不包含账号系统、云同步、PDF 翻译、视频字幕、移动端或自动订阅计费。

## Capabilities

### New Capabilities

- `byok-provider-configuration`: 配置、验证和选择用户自有的 DeepSeek 或 OpenAI-compatible API，并在本机受限保存敏感凭据。
- `immersive-page-translation`: 提取网页正文、可靠映射批量译文、保留原文插入译文，并控制翻译过程及错误恢复。

### Modified Capabilities

无。

## Impact

- 新增 Chrome Manifest V3 扩展代码、配置页、弹出页、Service Worker、Content Script 和样式。
- 新增针对纯文本提取、分批与响应映射逻辑的自动化测试，以及浏览器内的手动验收流程。
- 运行时依赖用户选择的远程翻译 API，但不依赖沉浸式翻译官方插件、服务或代码。
- 扩展需要网页注入权限、本地存储权限，以及用户在添加 API 服务时授予的目标 API 域名权限。

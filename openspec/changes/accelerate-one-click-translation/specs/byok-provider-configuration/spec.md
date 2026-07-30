## MODIFIED Requirements

### Requirement: 管理翻译服务配置
扩展 SHALL 允许用户创建、编辑、删除和选择多个 OpenAI-compatible 翻译服务配置。每个配置 MUST 包含显示名称、Base URL、API Key、模型和默认目标语言，且 DeepSeek 预设的所有字段 SHALL 保持可编辑。新建 DeepSeek 配置 SHALL 默认使用当前快速非思考模型 `deepseek-v4-flash`，已保存配置的模型 MUST 保持不变，除非用户明确编辑。

#### Scenario: 创建 DeepSeek 配置
- **WHEN** 用户选择 DeepSeek 预设并填写有效的 API Key 和目标语言
- **THEN** 扩展保存一个可被选择的 provider 配置，预填 DeepSeek Base URL 和 `deepseek-v4-flash` 模型

#### Scenario: 读取已有 DeepSeek 配置
- **WHEN** 用户升级扩展且已有配置使用其他 DeepSeek 模型名称
- **THEN** 扩展保留原模型名称和选择状态，不静默迁移或覆盖

#### Scenario: 创建自定义兼容配置
- **WHEN** 用户填写有效的自定义 Base URL、API Key、模型和目标语言
- **THEN** 扩展保存该配置，而不要求它属于预置服务商

#### Scenario: 删除当前配置
- **WHEN** 用户确认删除一个 provider 配置
- **THEN** 扩展删除该配置及其 API Key，并要求用户选择其他可用配置后才能翻译

## ADDED Requirements

### Requirement: Provider 性能画像
扩展 MUST 为每个 provider 解析一份不含凭据的性能画像，至少包含是否支持可靠流式响应、初始并发、最小并发和最大并发。DeepSeek 预设 SHALL 使用支持流式响应且初始并发为 6、允许范围为 2 至 8 的内置画像；自定义 OpenAI-compatible provider 在用户未声明能力时 SHALL 使用非流式、初始并发为 3 的保守画像。性能画像 MUST 只影响调度，不得允许 Content Script 覆盖请求 URL、模型或认证信息。

#### Scenario: 选择 DeepSeek 预设
- **WHEN** Service Worker 加载一个有效的 DeepSeek provider
- **THEN** 调度器获得支持流式响应、初始并发 6、最小并发 2 和最大并发 8 的画像

#### Scenario: 选择未声明能力的自定义 Provider
- **WHEN** Service Worker 加载一个没有性能能力设置的自定义 provider
- **THEN** 调度器使用非流式和初始并发 3 的保守画像

#### Scenario: 用户调整自定义能力
- **WHEN** 用户为自定义 provider 显式启用流式响应或调整允许范围内的并发上限并通过连接测试
- **THEN** 扩展保存该不含凭据的性能设置并在后续 session 中使用

#### Scenario: Content Script 尝试覆盖性能画像
- **WHEN** Content Script 消息携带并发、流式能力、请求 URL、模型或认证覆盖字段
- **THEN** Service Worker 拒绝越权字段并只使用已保存 provider 的可信配置

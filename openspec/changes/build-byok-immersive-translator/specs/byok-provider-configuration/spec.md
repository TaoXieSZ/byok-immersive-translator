## ADDED Requirements

### Requirement: 管理翻译服务配置
扩展 SHALL 允许用户创建、编辑、删除和选择多个 OpenAI-compatible 翻译服务配置。每个配置 MUST 包含显示名称、Base URL、API Key、模型和默认目标语言，且 DeepSeek 预设的所有字段 SHALL 保持可编辑。

#### Scenario: 创建 DeepSeek 配置
- **WHEN** 用户选择 DeepSeek 预设并填写有效的 API Key、模型和目标语言
- **THEN** 扩展保存一个可被选择的 provider 配置，并预填 DeepSeek Base URL

#### Scenario: 创建自定义兼容配置
- **WHEN** 用户填写有效的自定义 Base URL、API Key、模型和目标语言
- **THEN** 扩展保存该配置，而不要求它属于预置服务商

#### Scenario: 删除当前配置
- **WHEN** 用户确认删除一个 provider 配置
- **THEN** 扩展删除该配置及其 API Key，并要求用户选择其他可用配置后才能翻译

### Requirement: 验证服务地址与最小授权
扩展 MUST 在保存或测试 provider 前验证 Base URL，并 SHALL 仅在用户操作触发时请求该 provider 精确 origin 的运行时 host permission。除 loopback 地址外，携带 API Key 的服务地址 MUST 使用 HTTPS。

#### Scenario: 授权有效 HTTPS 服务
- **WHEN** 用户保存使用 HTTPS Base URL 的 provider 并同意浏览器权限提示
- **THEN** 扩展仅获得该 Base URL origin 的访问权限并继续保存

#### Scenario: 拒绝远程明文服务
- **WHEN** 用户提交非 loopback 的 HTTP Base URL
- **THEN** 扩展拒绝保存并说明 API Key 不能通过远程明文连接发送

#### Scenario: 用户拒绝域名权限
- **WHEN** 用户拒绝 provider origin 的运行时权限
- **THEN** 扩展不把该 provider 标记为可用，并显示可再次授权的提示

### Requirement: 本地隔离敏感凭据
扩展 MUST 将 API Key 保存在扩展本地存储中，MUST NOT 使用浏览器同步存储或任何自有远端服务保存凭据，并 MUST 将包含凭据的 storage area 限制为 trusted extension contexts。

#### Scenario: Content Script 请求配置
- **WHEN** Content Script 查询当前翻译配置或发起翻译任务
- **THEN** 返回数据不包含 API Key、认证请求头或其他 provider 凭据

#### Scenario: 浏览器同步已启用
- **WHEN** 用户在浏览器中启用了配置同步
- **THEN** provider API Key 仍只保留在当前设备的扩展本地存储

### Requirement: 测试 provider 连接
扩展 SHALL 提供显式的连接测试，使用当前表单中的 origin、API Key 和模型发出最小请求，并 MUST 将成功或可操作的失败原因反馈给用户。

#### Scenario: 连接测试成功
- **WHEN** provider 返回符合 OpenAI-compatible Chat Completions 结构的成功响应
- **THEN** 扩展显示连接成功且不记录或展示完整 API Key

#### Scenario: 认证失败
- **WHEN** provider 返回认证或授权错误
- **THEN** 扩展显示 Token 无效或无权限的提示，而不将原始 Token 写入日志

#### Scenario: 模型或限流失败
- **WHEN** provider 返回模型不存在或请求限流错误
- **THEN** 扩展显示对应的可操作错误，而不是笼统显示未知失败

### Requirement: 只由可信上下文调用远端 API
扩展 Service Worker MUST 根据已保存且已选择的 provider 构造远端请求，并 MUST 拒绝由 Content Script 指定任意请求 URL、认证头或模型覆盖。

#### Scenario: 合法翻译任务
- **WHEN** Content Script 提交有效 session ID、目标语言和受限文本批次
- **THEN** Service Worker 使用已选择 provider 的保存配置构造请求

#### Scenario: 越权请求参数
- **WHEN** Content Script 消息包含任意 URL、Authorization 头或未授权 provider ID
- **THEN** Service Worker 拒绝该消息且不发出远端请求

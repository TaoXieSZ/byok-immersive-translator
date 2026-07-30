## ADDED Requirements

### Requirement: 管理本机译文字体偏好
扩展 SHALL 允许用户选择默认字体、Maple Mono 预设或受限的自定义本机字体栈，并 MUST 将有效偏好保存在当前设备的扩展本地存储。字体偏好 MUST 与 Provider 配置和凭据分离，且 MUST NOT 使用同步存储。

#### Scenario: 选择 Maple Mono
- **WHEN** 用户在 Options 中选择 Maple Mono 并保存
- **THEN** 扩展保存版本化预设标识，并使用内置的 Maple Mono 与系统回退字体栈

#### Scenario: 保存自定义字体
- **WHEN** 用户输入数量、长度和字符均符合限制的本机字体名称
- **THEN** 扩展保存规范化的字体 family 列表且不保存任意 CSS 声明

#### Scenario: 提交非法字体值
- **WHEN** 自定义值包含 URL、CSS 函数、`@font-face`、声明分隔符、控制字符、过多 family 或超长名称
- **THEN** 扩展拒绝保存、保留上一份有效设置并显示可操作的校验提示

#### Scenario: 首次使用或旧版本升级
- **WHEN** 本地存储中没有字体偏好或存在未知 schema 版本
- **THEN** 扩展使用默认继承字体且不修改 Provider 配置

### Requirement: 预览与字体可用性反馈
Options SHALL 提供包含中文、英文、数字、标点和行内代码的译文字体预览，并 SHALL 尽力检测首选本机字体是否可用。字体缺失或检测 API 不可用 MUST NOT 阻止安全保存和回退。

#### Scenario: 首选字体可用
- **WHEN** 浏览器确认所选字体可以匹配
- **THEN** 预览使用该字体并显示字体可用

#### Scenario: 首选字体未安装
- **WHEN** 浏览器无法匹配 Maple Mono 或自定义首选字体
- **THEN** 预览显示实际回退效果并提示用户需要自行安装该字体

#### Scenario: 浏览器不能检测字体
- **WHEN** 当前浏览器不提供可靠的字体检测 API
- **THEN** Options 显示无法检测并继续使用确定性的 CSS 回退栈

### Requirement: 仅将字体应用于扩展译文
扩展 MUST 只把字体偏好应用于自己插入的译文容器及其中的受支持格式节点，MUST NOT 修改原文节点、网站控件、页面根元素或网站样式。行内 `code` 和 `kbd` SHALL 优先使用所选字体并继续包含安全的等宽回退。

#### Scenario: 翻译新页面内容
- **WHEN** Content Script 在已保存字体偏好下创建普通或格式化译文
- **THEN** 新译文及其中的行内代码使用对应字体变量，原文样式保持不变

#### Scenario: 页面已存在译文
- **WHEN** 用户在 Options 中更改字体且页面已经包含译文
- **THEN** 已有和后续译文在不重新请求 Provider 的情况下更新字体

#### Scenario: 恢复原文
- **WHEN** 用户再次点击悬浮按钮或选择恢复原文
- **THEN** 扩展删除译文及其字体状态，原页面 DOM 不留下字体属性、class 或内联样式

#### Scenario: 字体不可用
- **WHEN** 首选字体未安装或加载失败
- **THEN** 译文按已验证字体栈回退，仍保持可读且不影响翻译状态

### Requirement: 最小化字体设置消息与网络能力
扩展 SHALL 只向 Content Script 暴露经过校验的字体偏好版本、模式和本机 family 名称，MUST NOT 暴露 Provider 凭据或任意 storage 内容。字体选择 MUST NOT 触发远程字体请求、增加网站或字体权限、改变翻译请求载荷或影响翻译缓存键。

#### Scenario: Content Script 获取字体偏好
- **WHEN** 新页面安装翻译控制器
- **THEN** Service Worker 返回最小安全字体偏好且不包含 API Key、Provider URL 或其他本地设置

#### Scenario: 字体设置实时变化
- **WHEN** trusted extension context 保存新的有效字体偏好
- **THEN** Service Worker 仅向普通网页标签广播安全字体更新，受限页面失败不会产生扩展错误

#### Scenario: 尝试覆盖消息边界
- **WHEN** 字体消息包含 CSS、URL、文件路径、Base64 数据、额外字段或请求配置
- **THEN** 扩展拒绝该消息且不创建样式或发起网络请求

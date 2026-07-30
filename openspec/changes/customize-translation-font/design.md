## Context

译文目前通过 `.byok-translator__translation` 使用 `font-family: inherit`，行内 `code`、`kbd` 使用固定等宽字体栈。Options 只管理 Provider 和页面访问权限；Provider 凭据所在的 `chrome.storage.local` 已限制为 trusted extension contexts，因此 Content Script 不应直接读取整个本地存储。

这项外观偏好需要跨 Options、Service Worker、Content Script 和 CSS 生效，同时必须保持零运行时依赖、不新增权限、不远程加载代码或字体、不改变原文 DOM，也不能因为字体变化重新请求翻译。

## Goals / Non-Goals

**Goals:**

- 提供默认、Maple Mono 预设和受限自定义本机字体栈。
- 让用户在 Options 中预览中英文、数字、标点和行内代码，并了解首选字体是否可用。
- 只更新扩展拥有的译文节点，设置保存后让已打开页面的现有及后续译文立即采用新字体。
- 保持 `code`、`kbd` 的等宽回退语义，以及字体缺失、旧设置或非法设置下的确定性安全回退。
- 保持字体偏好与 Provider 凭据、翻译请求和缓存语义完全分离。

**Non-Goals:**

- 不打包、下载、托管或自动安装 Maple Mono 或其他字体文件。
- 不接受远程字体 URL、CSS 声明、`@font-face`、任意样式规则、字体文件路径或 Base64 数据。
- 不改变原文、网站控件、悬浮控制器、Popup 或 Options 自身的界面字体。
- 不在首版提供字号、行高、字重、颜色或逐站点字体规则。

## Decisions

### 1. 使用版本化外观偏好，而不是保存原始 CSS

新增共享外观模块，定义版本化偏好：

- `mode`: `default`、`maple-mono` 或 `custom`
- `customFamilies`: 自定义模式下经过规范化的 1–4 个本机字体 family 名称

默认模式不设置自定义字体；Maple Mono 模式映射到扩展内硬编码的 Maple Mono/CJK/系统回退栈；自定义模式把每个经过长度和字符校验的 family 单独引用后组成字体栈。存储层只保存结构化数据，不保存可直接执行的 CSS。

替代方案是保存一个完整 `font-family` 字符串。它更灵活，但把 CSS 语法、URL 和函数注入带入消息与 DOM 边界，因此不采用。

### 2. 字体文件由操作系统提供

Maple Mono 只是字体栈预设。扩展通过正常的 `font-family` 匹配使用用户已安装的字体；缺失时按预设顺序回退，不添加 `chrome.fontSettings` 权限，也不访问远端 CDN。

Options 使用 `document.fonts.check()` 并结合 Canvas 字宽对照做尽力而为的可用性提示，避免 Chromium 把不存在但可由系统字体回退的 family 误报为已安装。任一检测能力不可用时显示“无法检测”，但仍允许保存，因为实际 CSS 回退始终安全。

替代方案是随扩展打包字体。它会显著增加扩展体积，并引入字体版本、许可证和更新责任，因此不进入当前变更。

### 3. 通过 Service Worker 暴露最小安全偏好

Options 作为 trusted extension context 使用共享 repository 读写外观偏好。Content Script 通过新增的只读消息获取经过校验的公开偏好，避免获得对 Provider storage 的读取能力。

Service Worker 监听对应 storage key 的变化，并向普通网页标签发送只含版本、模式和规范化字体名称的更新消息。新注入的 Content Script 在安装控制器时主动拉取一次；无法联系后台时使用默认字体。

替代方案是让 Content Script 直接监听 `chrome.storage.onChanged` 并读取 storage。由于本地存储同时包含 Provider 凭据且已限制访问级别，这会破坏现有隔离边界，因此不采用。

### 4. 只在扩展拥有的译文容器上设置 CSS 变量

Content Script 保存当前安全偏好，并在创建译文容器时应用：

- `--byok-translation-font`
- `--byok-translation-mono-font`

设置变化时只遍历 `.byok-translator__translation[data-byok-translator]`，更新扩展拥有的节点。默认模式移除变量，继续继承网站正文；自定义模式以所选字体开头并追加安全系统回退。`code`、`kbd` 使用 mono 变量，确保 Maple Mono 或自定义字体优先，同时保留 `ui-monospace` 等回退。

不在 `documentElement` 或原文节点写入属性、class 或 style。恢复原文删除译文容器后不会留下字体状态。

### 5. 字体变化不进入翻译或缓存协议

字体是纯本地表现偏好。它不进入 Content Script 到 Service Worker 的翻译载荷、Provider prompt、结构指纹或翻译缓存键。更新字体只重绘已有译文，不重新提取文本、不发起 Provider 请求，也不重建格式标记。

## Risks / Trade-offs

- [Maple Mono 未安装或字体 family 名称因版本不同而变化] → 预设覆盖常见 family 名称，Options 显示检测结果，CSS 始终包含系统回退。
- [浏览器限制本机字体枚举或 `document.fonts.check()` 结果不完整] → 结合 Canvas 字宽对照降低误报；检测仍只作提示，不作为保存或渲染前提。
- [自定义名称尝试携带 CSS 或 URL] → 结构化 family 数组、严格长度/字符/数量校验和逐项引用；消息边界拒绝额外字段。
- [大量译文节点同时更新产生短暂重绘] → 只更新扩展节点且不重建 DOM；一次设置变更合并到一个 animation frame。
- [站点使用 `!important` 覆盖字体] → 扩展现有译文选择器继续使用受限 `!important`，但不复制或修改站点样式。

## Migration Plan

1. 增加外观偏好 schema、默认值、校验器和 repository；不存在旧值时自然使用默认模式。
2. 增加 Options 字体选择、预览和保存反馈。
3. 增加 Service Worker 最小消息与 storage 变化广播。
4. 在 Content Script 和译文 CSS 中接入变量，验证现有与新增译文均实时更新。
5. 回滚时移除字体 UI、消息和变量应用；已保存偏好成为无害的孤立 key，不影响 Provider 配置或翻译缓存。

## Open Questions

首版没有阻塞实现的问题。后续可根据使用反馈决定是否提供字体大小、行高、逐站点偏好或可选的用户自行导入本地字体文件。

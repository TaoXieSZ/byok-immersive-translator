## 1. 锁定现有字体与安全边界

- [x] 1.1 为默认译文、格式化译文、行内 `code`/`kbd`、恢复原文和动态新增译文补充字体行为基线测试
- [x] 1.2 为 Options 本地设置、Content Script 无权读取 Provider storage、翻译载荷和缓存键不含外观偏好补充回归断言
- [x] 1.3 运行 `npm run verify`，确认引入字体设置前的既有翻译、格式和性能行为全部通过

## 2. 版本化字体偏好与本地存储

- [x] 2.1 新建零依赖外观偏好模块，定义 schema 版本、`default`/`maple-mono`/`custom` 模式、默认值和 Maple Mono 安全回退栈
- [x] 2.2 实现自定义 family 数量、单项长度、总长度和字符白名单校验，拒绝 URL、CSS 函数、声明分隔符、控制字符、文件路径与 Base64 数据
- [x] 2.3 实现从结构化偏好生成逐项引用的正文和 mono 字体栈，不接受或拼接原始 CSS 声明
- [x] 2.4 实现 trusted-context repository，仅使用 `chrome.storage.local` 的独立 key 保存有效偏好，并让缺失、损坏或未知版本设置回退默认值
- [x] 2.5 为 Maple Mono 预设、自定义规范化、非法输入、旧版本回退、存储隔离和 CSS 字体栈生成补充单元测试，然后运行 `npm run verify`

## 3. 最小消息边界与实时同步

- [x] 3.1 扩展消息协议，增加读取字体偏好和字体偏好更新事件，只允许版本、模式和规范化 family 列表
- [x] 3.2 在 Service Worker 中读取并返回安全公开偏好，确保响应不包含 API Key、Provider URL 或其他 storage 字段
- [x] 3.3 监听外观偏好 key 的本地 storage 变化，向普通 HTTP/HTTPS 标签广播更新，并静默忽略受限页、已关闭页和未注入页
- [x] 3.4 为额外字段、CSS/URL 注入、越权 storage 读取、无接收端广播和受限页面失败补充消息与 Service Worker 测试，然后运行 `npm run verify`

## 4. Options 字体选择与预览

- [x] 4.1 在 Options 增加“译文字体”设置区，提供默认、Maple Mono 和自定义字体选项以及明确的本机字体说明
- [x] 4.2 增加包含中文、英文、数字、标点、`code` 和 `kbd` 的实时预览，并让未保存的选择立即反映到预览
- [x] 4.3 使用 `document.fonts.check()` 做尽力而为的字体可用性检测，区分可用、未安装和无法检测，且检测结果不阻止安全保存
- [x] 4.4 接入 repository 的加载、保存、校验错误和成功反馈，非法输入必须保留上一份有效设置
- [x] 4.5 为表单状态、Maple Mono 预设、自定义输入、预览、字体检测降级和保存反馈补充 Options 测试，然后运行 `npm run verify`

## 5. Content Script 字体应用与 CSS 隔离

- [x] 5.1 在 Content Script 安装时拉取一次安全字体偏好；后台不可用或响应无效时继续使用默认字体
- [x] 5.2 实现只针对 `.byok-translator__translation[data-byok-translator]` 的字体变量应用器，并在创建普通、格式化、流式、缓存和动态译文时统一调用
- [x] 5.3 接收字体更新事件，在一个 animation frame 内更新已有译文且不重新提取文本、不请求 Provider、不重建翻译 DOM
- [x] 5.4 更新译文 CSS，让正文使用 `--byok-translation-font`，`code`/`kbd` 使用 `--byok-translation-mono-font` 并保留系统等宽回退
- [x] 5.5 验证默认模式移除自定义变量，恢复原文后页面根元素、原文节点和网站样式不存在扩展字体残留
- [x] 5.6 为已有/新增译文实时更新、格式化节点、缓存命中、设置连点合并、非法消息、缺失字体回退和原 DOM 不变补充编排测试，然后运行 `npm run verify`

## 6. BrowserOS 真实验收

- [x] 6.1 在 BrowserOS 的 Options 中选择已安装的 Maple Mono，验证预览与可用性反馈，并确认没有新增字体或网站权限
- [x] 6.2 在 `https://claude-code-from-source.com/ch01-architecture/` 验证已有和新生成中文译文使用 Maple Mono，行内代码保持等宽且原文、悬浮按钮和网站控件字体不变
- [x] 6.3 翻译保持开启时切换默认、Maple Mono 和自定义字体，确认页面实时更新、Provider 请求数不增加、缓存结果不失效
- [x] 6.4 验证未安装字体安全回退、非法 CSS/URL 输入被拒绝、再次点击移除翻译后原始 DOM 无字体残留且扩展错误页无新增条目
- [x] 6.5 运行最终 `npm run verify`、`git diff --check` 和 `openspec validate customize-translation-font --strict`，记录本机字体检测差异和未安装字体为后续风险

## 1. 锁定现有行为与性能基线

- [x] 1.1 为 Popup 启动、悬浮控制器状态切换、批次取消、迟到响应丢弃和纯文本渲染补充回归测试，确保重构前核心行为有保护
- [x] 1.2 增加 122 块代表性长文章 fixture、确定性非流式/流式 Provider stub 和单调时钟测试工具，并记录现有点击到请求、首屏完成和请求数基线
- [x] 1.3 运行 `npm run verify`，确认新增基线测试和既有测试全部通过

## 2. Provider 性能画像与可信消息协议

- [x] 2.1 在共享配置与运行限制模块中实现性能画像校验和默认值：DeepSeek 为流式、初始并发 6、范围 2–8，自定义 Provider 为保守非流式、初始并发 3
- [x] 2.2 更新 DeepSeek 新建预设为 `deepseek-v4-flash`，为旧配置补充缺失的性能默认值但不改写已保存模型，并增加迁移测试
- [x] 2.3 扩展共享消息协议以支持单段 stream start/chunk/complete/error 和翻译范围，同时拒绝 Content Script 提供的 URL、模型、认证或并发覆盖字段
- [x] 2.4 为 Provider 性能画像、旧配置兼容和消息权限边界补充单元测试，然后运行 `npm run verify`

## 3. Service Worker 双通道调度

- [x] 3.1 在 OpenAI-compatible adapter 中实现单段纯文本请求和健壮 SSE 解析，只输出已归属当前 block 的文本增量，并为畸形帧、中断和非流式回退补充测试
- [x] 3.2 将固定 permit 池替换为按 Provider 隔离的可取消自适应调度器，实现 429/503、合法 `Retry-After`、带抖动退避、高延迟降速和连续成功逐级恢复
- [x] 3.3 在 Service Worker 接入极速单段通道与既有批量 JSON 通道，保证停止 session 会清除在途、排队和退避任务，且所有请求只使用可信 Provider 配置
- [x] 3.4 为并发上下界、降速恢复、公平出队、session 取消、迟到流事件和批量兼容路径补充编排测试，然后运行 `npm run verify`

## 4. 会话缓存、去重与语言跳过

- [x] 4.1 实现带版本的缓存键、原文哈希和 `chrome.storage.session` 仓库，并在不可用时回退到 Service Worker 内存缓存；只保存验证完成的译文且不保存原文
- [x] 4.2 在 Content Script 建立 canonical block 到重复 DOM 块的扇出映射，确保相同规范化文本只请求一次且多个位置安全渲染
- [x] 4.3 实现高置信度目标语言判定，跳过主要使用目标语言的文本并保守处理短文本和混合语言
- [x] 4.4 为缓存隔离维度、会话清除、失败结果不缓存、重复文本扇出和多脚本语言判定补充测试，然后运行 `npm run verify`

## 5. 渐进提取与首屏优先编排

- [x] 5.1 把提取器拆成当前视口首批和可中断的后台分片扫描，复用既有安全排除、稳定 ID、MutationObserver 和动态内容去重规则
- [x] 5.2 实现主要内容识别及回退，并在整个页面模式下覆盖所有合格候选块
- [x] 5.3 实现只重排 queued 项的视口优先队列；对 scroll/resize 节流，使新进入视口的块优先且已提交块不重复发送
- [x] 5.4 重构 session orchestrator：100ms 内创建首批 loading，首个未缓存可见块走极速通道，其余内容并行进入批量后台通道
- [x] 5.5 为长页分片、正文范围、范围回退、滚动重排、动态追加、流式失败清理和非流式单段回退补充测试，然后运行 `npm run verify`

## 6. 一键悬浮入口与控制体验

- [x] 6.1 更新悬浮控制器状态机：空闲单击立即开始且面板保持折叠，starting 防重复点击，翻译中/停止/完成/失败再次单击停止会话并恢复原文，错误时展示可操作入口
- [x] 6.2 让 Popup、悬浮按钮和 Content Script 消息统一调用同一 session command handler，并在主要内容/整个页面间保存用户选择
- [x] 6.3 在 Manifest 和 Service Worker 增加翻译切换与整页翻译 commands，通过 `activeTab` 安全注入或转发到现有控制器，不在网页捕获全局键盘事件
- [x] 6.4 为一键启动、防重复 session、面板行为、范围切换、快捷键复用、停止和恢复补充测试，然后运行 `npm run verify`

## 7. 可选网站访问与持久控制器

- [x] 7.1 在 Options 增加默认关闭的网站访问说明与开关，使用现有可选 host permissions 请求或撤销普通网页权限，并清楚展示 `activeTab` 回退状态
- [x] 7.2 在 Service Worker 幂等注册或注销固定 ID、`persistAcrossSessions` 的动态 Content Script，并在安装、启动和权限变化时核对实际授权
- [x] 7.3 加固 bootstrap 幂等性和受限页面判断，确保自动注册、Popup 注入与快捷键注入不会产生重复控制器
- [x] 7.4 为授权、拒绝、撤销、浏览器重启恢复、无重复注册、受限页面和 `activeTab` 回退补充边界测试，然后运行 `npm run verify`

## 8. 性能遥测与验收

- [x] 8.1 实现不含正文与凭据的结构化性能时间线，分别记录内容侧 loading/提取/首 token/视口/全页和后台排队/fetch/首帧/降速耗时
- [x] 8.2 将确定性基准加入自动化验证，断言 122 块 fixture 在 100ms 内显示 loading、200ms 内发出请求、2.5s 内首 token、5s 内完成视口、整页不超过 8 请求，缓存命中视口在 300ms 内完成且零请求
- [x] 8.3 在 `https://claude-code-from-source.com/ch01-architecture/` 完成冷启动、滚动重排、停止、恢复、权限拒绝/授权和浏览器重启手测，分别记录扩展开销与 DeepSeek 网络耗时
- [x] 8.4 运行最终 `npm run verify` 和 `openspec validate accelerate-one-click-translation --strict`，确认零已知错误并把实际性能差距或 Provider 波动记录为后续风险

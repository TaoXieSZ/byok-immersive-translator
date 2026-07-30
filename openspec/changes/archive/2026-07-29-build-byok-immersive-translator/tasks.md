## 1. 扩展基线

- [x] 1.1 创建可直接加载的 Manifest V3 目录结构、manifest、Popup、Options、Service Worker、Content Script 和基础样式
- [x] 1.2 定义扩展上下文之间的消息类型、载荷校验、错误码与翻译 session 状态模型
- [x] 1.3 配置不含运行时依赖的 Node 内置测试命令，并添加最小模块加载测试
- [x] 1.4 在 Chrome 中以未打包扩展加载，确认安装权限与四个扩展上下文可正常启动

## 2. BYOK Provider 配置

- [x] 2.1 实现 provider 本地存储仓库、当前 provider 选择和 trusted-context storage 访问限制
- [x] 2.2 实现 Base URL 规范化与校验，包括远程 HTTPS 限制和 loopback HTTP 例外，并添加单元测试
- [x] 2.3 实现精确 origin 的运行时权限申请、复用与无引用权限清理
- [x] 2.4 实现 Options 中 DeepSeek 预设、自定义 provider 的创建、编辑、删除、选择和目标语言配置
- [x] 2.5 实现 OpenAI-compatible Chat Completions adapter，包括请求构造、JSON 响应提取和认证、模型、限流、网络错误归一化
- [x] 2.6 实现 provider 连接测试及不泄露完整 API Key 的成功和失败反馈
- [x] 2.7 添加 provider CRUD、Token 不进入 sync、敏感字段不返回 Content Script 及越权消息被拒绝的测试

## 3. 文本提取与批次协议

- [x] 3.1 实现候选块标签、文本有效性、排除规则和父子去重的纯逻辑，并覆盖普通文章、隐藏内容、代码与表单场景
- [x] 3.2 实现按 DOM 阅读顺序提取可见块、生成 session 内稳定 ID，并提供浏览器测试夹具验证真实 DOM 行为
- [x] 3.3 实现同时受条目数和字符预算限制的顺序分批函数，并覆盖超长单块与边界条件
- [x] 3.4 实现要求 ID 到纯文本译文 JSON 映射的提示构造，确保载荷不包含完整 DOM、Cookie、表单值或未选中文本
- [x] 3.5 实现严格响应校验，拒绝未知 ID、缺失 ID、非字符串值和不可解析结果，并添加顺序打乱与恶意输出测试

## 4. 翻译 Session 与页面渲染

- [x] 4.1 实现 Content Script session 状态机、进度汇总和每批最多一次自动重试
- [x] 4.2 实现 Service Worker 翻译消息处理、已选 provider 请求、并发限制和按 session 中止活动请求
- [x] 4.3 实现使用 `textContent` 的幂等译文插入、双语样式和只移除扩展节点的恢复原文操作
- [x] 4.4 实现停止、失败块重试和旧 session 迟到响应丢弃，并覆盖状态转换测试
- [x] 4.5 实现合并 MutationObserver 事件的新增块翻译，确保忽略扩展译文节点且不重新扫描整页
- [x] 4.6 使用浏览器测试夹具验证嵌套块、HTML 样式模型输出、重复响应、恢复原文和无限滚动追加内容

## 5. Popup 交互

- [x] 5.1 实现当前标签页可翻译性检测，以及未配置 provider 和禁止注入页面的明确提示
- [x] 5.2 实现开始、停止、重试失败块和恢复原文操作，并让按钮状态随 session 状态变化
- [x] 5.3 显示排队、翻译中、成功、失败数量和归一化 API 错误，不展示 Token 或完整认证请求
- [x] 5.4 验证 Popup 关闭再打开后能从 Content Script 恢复当前标签页的权威状态

## 6. 安全与端到端验证

- [x] 6.1 审查 manifest 权限，确认网页注入使用当前标签页授权、API 访问使用运行时精确 origin 权限且无远程托管代码
- [x] 6.2 使用本地 mock OpenAI-compatible 服务完成配置、授权、连接测试、整页翻译、批次失败、重试、停止和恢复原文闭环
- [x] 6.3 在 Chrome 的普通文章页和动态内容页执行手动验收，并记录浏览器版本与结果
- [x] 6.4 运行全部自动化测试和 OpenSpec 校验，修复所有失败后记录 MVP 已满足的场景及已知限制
- [x] 6.5 编写 README、未打包安装说明、API Token 安全边界、隐私说明和首版功能范围

# BYOK 翻译扩展浏览器验收

## 环境

- 日期：2026-07-27
- 浏览器：Google Chrome for Testing 146.0.7680.80
- 扩展：Manifest V3 未打包目录
- API：本地 OpenAI-compatible mock 与真实 DeepSeek `deepseek-chat`
- 真实站点：[Claude Code from Source — Chapter 1](https://claude-code-from-source.com/ch01-architecture/)

本地 mock 返回 `译：` 加原文，用于验证分块、协议、状态和渲染；它不用于评价实际翻译质量。

## 已验证结果

- Options 中连接测试成功，Provider 与 Token 保存在本地。
- 普通测试夹具正确提取标题、段落、列表和嵌套正文。
- 代码、隐藏内容和表单输入未被翻译。
- 页面动态追加段落只翻译一次。
- 真实站点按 DOM 顺序插入 122 个译文块。
- Popup 关闭再打开后恢复 `122 / 122` 的权威进度。
- 恢复原文后译文节点为 0，原 H1 文本保持不变。
- 非法响应使 122 个块进入失败状态；修正 Provider 后，“重试失败”恢复到 122 个译文块。
- 慢速请求在 72/122 时停止；等待超过一个请求周期后仍为 72，没有迟到响应继续写入。
- 页面只使用 `textContent` 写入译文；模拟 HTML 模型输出不会作为页面标记执行。
- 使用用户在浏览器中亲自保存的真实 DeepSeek Token 完成 122/122 个文本块翻译；Token 始终保持掩码，未被读取或输出到测试日志。
- 真实返回示例包括“AI代理的架构”“快速启动——引导管道”“状态——双层架构”和“与 Claude 对话——API 层”。

## 视觉证据

当前轻量双语样式：

![真实站点翻译结果](./assets/real-site-translated-light.png)

样式依据用户提供的沉浸式翻译原版截图收敛为“原文下方自然跟随译文”，不再使用醒目的卡片背景和边框。

真实 DeepSeek 翻译结果：

![真实 DeepSeek 翻译结果](./assets/real-site-deepseek.png)

## 尚未覆盖

- 其他浏览器不属于首版范围。
- PDF、字幕、图片 OCR 和复杂 Web App 编辑器不属于首版范围。

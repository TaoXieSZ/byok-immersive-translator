# 段落魔法镜

段落魔法镜适合阅读技术文章时快速翻译局部内容。划选正文后点击悬浮按钮，卡片会保留原文格式、流式显示译文，并在完成后提供缩写和专有名词解释入口。

## 术语识别

术语识别在浏览器本地完成，不会额外增加翻译请求的延迟或费用。下面的真实页面示例识别出了 `REPL`、`React` 和 `Ink`：

![段落魔法镜识别 REPL、React 和 Ink](./assets/term-chips.png)

## 按需解释

只有点击某个词条时，扩展才会使用当前 Provider 请求结合段落上下文的解释。同一词条在本次会话中再次点击会直接使用内存缓存：

![段落魔法镜解释 REPL](./assets/repl-explanation.png)

## 验收环境

- 浏览器：BrowserOS
- 测试页面：[Claude Code from Source — Chapter 2](https://claude-code-from-source.com/ch02-bootstrap/)
- Provider：DeepSeek（OpenAI-compatible API）
- 截图内容：真实划选、流式翻译、术语识别与 `REPL` 按需解释

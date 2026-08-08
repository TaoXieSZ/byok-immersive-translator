# Safari 版（macOS）

Safari 版是由 Apple Safari Web Extension Packager 生成的 macOS App + Safari Web Extension 工程。Xcode 工程通过相对路径直接引用仓库根目录的 `extension/manifest.json`、`extension/src/` 和 `extension/assets/`，因此 Chrome 与 Safari 共用同一套翻译、配置和隐私逻辑，不维护复制代码。

## 环境要求

- macOS 13.3 或更高版本
- Safari 16.4 或更高版本
- 完整版 Xcode（不是只有 Command Line Tools）

Safari 16.4 是本项目所用 ES module background service worker、`storage.session` 和动态 content script 注册 API 的最低版本。

## 本地构建

在仓库根目录执行：

```bash
npm run safari:build
```

该命令执行无签名 Debug 构建，产物位于：

```text
build/safari/Build/Products/Debug/BYOK Immersive Translator.app
```

## 在 Safari 中运行

1. 用 Xcode 打开 `BYOK Immersive Translator/BYOK Immersive Translator.xcodeproj`。
2. 在 App 与 Extension 两个 target 的 Signing & Capabilities 中选择同一个开发团队。
3. 运行 `BYOK Immersive Translator` scheme。
4. 在打开的容器 App 中点击“打开 Safari 扩展设置”，启用扩展。
5. 在 Safari 工具栏打开扩展，进入设置并配置翻译服务。

本地无签名调试需要 Safari 的开发者功能和“允许未签名扩展”；该设置在退出 Safari 后可能重置。正式分发需要 Apple Developer 签名，并通过 App Store Connect 或 Developer ID + notarization 发布。

## 兼容性说明

- `manifest_version: 3`、`service_worker`、`chrome.*` API、`options_page`、`commands` 与 optional host permissions 由 Safari Web Extension 直接承载。
- Xcode 工程只提供原生容器、扩展启用入口和签名边界，不接触 API Key 或翻译正文。
- Apple packager 当前仍可能对 `background.type = module` 输出兼容性提示；WebKit 与 Safari 16.4 release notes 已确认该能力从 Safari 16.4 起受支持，因此本工程将最低系统版本锁定为 macOS 13.3。
- 网站访问与 Provider 地址仍按需请求，不会因为 Safari 打包而扩大默认权限。

## 官方资料

- [Safari Web Extensions](https://developer.apple.com/documentation/safariservices/safari-web-extensions)
- [Packaging a web extension for Safari](https://developer.apple.com/documentation/safariservices/packaging-a-web-extension-for-safari)
- [Assessing browser compatibility](https://developer.apple.com/documentation/safariservices/assessing-your-safari-web-extension-s-browser-compatibility)
- [Running your Safari web extension](https://developer.apple.com/documentation/safariservices/running-your-safari-web-extension)
- [Safari 16.4 Web Extension updates](https://webkit.org/blog/13966/webkit-features-in-safari-16-4/)

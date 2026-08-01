# Changelog

本项目遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/) 的基本结构，并使用语义化版本号。

## [0.2.0] - 2026-08-01

### Added

- 可递归的多层语义解释空间、逐层预生成与探索历史导航。
- 首层 Mermaid 概念总览，以及可关闭、可缩放至 300% 的大图视图。
- 选中文本后的“向 AI 提问”和“深入”双入口；AI 对话栏按需打开并可关闭。
- Java 17 后端：知识会话、对话回合、幂等状态和模型/搜索供应商配置持久化。
- OpenAI Chat Completions 与 Anthropic Messages 协议支持。
- OpenAI、Anthropic、DeepSeek、Kimi、GLM、Gemini、通义千问、OpenRouter 和自主设置模型预设。
- 可插拔 `SearchProvider` 边界，以及 Tavily Search、Brave Search 适配器。
- 主问题联网开关和选区对话逐轮关闭/自动/强制模式。

### Security

- 默认 DeepSeek Key 由 Windows Credential Manager 保存；Java 供应商 Key 使用 AES-256-GCM 加密并只写不回显。
- 模型、设置和 Java BFF 写入入口校验 Fetch Metadata/Origin，并在流式读取阶段拒绝非 JSON 或超限请求。
- Java 与 TypeScript 模型/搜索适配器在使用、返回或持久化响应前拒绝原样回显当前 API Key。
- 模型与搜索目标实施 HTTPS、私网地址、重定向和受限认证 Header 校验。
- 运行时数据库、环境文件、IDE 配置和本地构建产物排除在版本控制之外。
- CI 拒绝跟踪运行时敏感文件，并扫描当前源码与完整 Git 历史中的疑似密钥。

### Known limitations

- 完整 `dev:local` 模式当前依赖 Windows Credential Manager。
- owner cookie 仅提供单设备数据隔离，不等同于账号认证或多租户授权。
- Tavily 当前只接入 Search，不包含 Extract、Crawl、Map 或 Research。
- 公共多用户部署仍需额外实现认证、授权、限流、配额、Secret Manager 与网络出站控制。

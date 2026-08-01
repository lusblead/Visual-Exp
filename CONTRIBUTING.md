# 参与贡献

感谢你帮助改进 Visualized Exp。请保持变更小而完整，并以可验证行为为准，而不是只修改界面文案或 happy path。

## 开发环境

- Node.js 22.13.0+
- Java 17+
- Maven 3.6.3+
- .NET SDK 10.0+
- 完整 `dev:local` 体验需要 Windows Credential Manager

从仓库根目录运行：

```powershell
npm install
npm run dev:local
```

无真实模型的前端演示：

```powershell
$env:EXPLANATION_MODEL_PROVIDER = "demo"
npm run dev
```

## 提交原则

1. 一个 PR 聚焦一个问题，避免夹带无关重构、依赖升级或全局格式化。
2. 先说明可观察行为和失败场景，再修改实现。
3. 行为变更必须更新 `docs/feature-flows/` 中对应的 `flow.md` 与 `traceability.yaml`。
4. 缺陷修复应尽量增加能复现原问题的回归测试。
5. 保持本地优先和单用户边界；若提议公共部署能力，请明确认证、授权、租户、配额与迁移方案。

新增模型供应商时，应优先复用已有的 OpenAI Chat Completions 或 Anthropic Messages 协议，并把“协议实现”和“可编辑预设”分开描述。新增搜索服务时，应实现后端 `SearchProvider` 适配边界，不得让模型直接控制请求 URL、认证 Header 或任意出站目标。

## 安全要求

绝不要提交或上传：

- 真实 API Key、Token、密码、私钥或连接字符串；
- `.env`、本地 H2/PostgreSQL 快照、日志、抓包或凭据缓存；
- 个人会话、提示词、回答、用户名、绝对本机路径或包含敏感信息的截图；
- 含真实环境绑定的构建产物。

测试请使用短小、明显的伪密钥，并确保 HTTP 客户端被 stub/mock。怀疑发现漏洞时，请按 [SECURITY.md](SECURITY.md) 私下报告，不要先提交公开 Issue 或 PR。

## 提交前验证

完整门禁：

```powershell
npm run harness:minimal
```

该命令包含 companion 构建、Java 测试、前端构建、Node 测试、TypeScript 类型检查和 ESLint。也请运行：

```powershell
git diff --check
```

如果因环境限制跳过任何验证，请在 PR 中明确写出未运行的命令、原因和剩余风险。

## PR 说明

PR 描述至少应包含：

- 用户可观察到的变化；
- 关键设计取舍和兼容影响；
- 实际运行的验证；
- 未验证内容及剩余风险；
- UI 变更的前后截图（不得包含密钥或个人数据）。

提交贡献即表示你同意按仓库的 [MIT License](LICENSE) 授权你的贡献。

# Visualized Exp Java Backend

这个模块负责完整知识会话、选区 AI 对话、模型/搜索供应商配置，以及受控联网搜索。它不接管现有 `/api/lineage` 语义图生成编排，但会通过私有内部入口为主问题提供搜索证据。

## Requirements

- Java 17+
- Maven 3.6.3+
- 本地默认使用 H2；部署可使用 PostgreSQL

## Local start

推荐从仓库根目录运行：

```powershell
npm run dev:local
```

启动器会生成进程间 Bearer Token，从 Windows 本地凭据派生稳定的加密主密钥，并把 Java 服务绑定到 `127.0.0.1`。也可以手动启动：

```powershell
$env:APP_CREDENTIAL_MASTER_KEY = "<base64-encoded 32-byte key>"
$env:APP_INTERNAL_TOKEN = "<random internal token>"
mvn -f backend/pom.xml spring-boot:run
```

网站进程必须使用相同的内部 Token：

```powershell
$env:VISUALIZED_EXP_BACKEND_URL = "http://127.0.0.1:8080"
$env:VISUALIZED_EXP_BACKEND_TOKEN = $env:APP_INTERNAL_TOKEN
npm run dev
```

不要把上述密钥或 Token 写入前端变量、日志或版本库。

## Storage

默认连接：

```text
jdbc:h2:file:./data/visualized-exp;MODE=PostgreSQL;DATABASE_TO_LOWER=TRUE;DEFAULT_NULL_ORDERING=HIGH
```

PostgreSQL 部署示例变量：

```text
APP_DATABASE_URL=jdbc:postgresql://db.example.internal:5432/visualized_exp
APP_DATABASE_USERNAME=visualized_exp
APP_DATABASE_PASSWORD=<server secret>
APP_CREDENTIAL_MASTER_KEY=<stable base64 32-byte secret>
APP_INTERNAL_TOKEN=<shared web-to-Java bearer>
APP_BIND_ADDRESS=0.0.0.0
```

`APP_CREDENTIAL_MASTER_KEY` 必须在数据库生命周期内保持稳定；丢失或轮换但未迁移密文，会导致已保存的供应商 Key 无法解密。

## Provider boundary

模型预设包括 OpenAI、Anthropic、DeepSeek、Gemini OpenAI compatibility、Qwen DashScope compatibility 和 OpenRouter，另有自主设置模板。预设只是默认值：模型配置可选择 OpenAI Chat Completions 或 Anthropic Messages、Base URL 或完整请求 URL，以及 Bearer、`x-api-key`、`api-key` 或一个受限自定义认证 Header。搜索通过服务端 `SearchProvider` SPI 注册适配器，当前实现 Tavily 和 Brave，设置页默认 Tavily。

- 选区对话优先使用 owner 当前启用的模型覆盖；没有覆盖时，回退到本地启动器注入的固定回环 DeepSeek companion。Java 不读取、复制或持久化 Windows Credential Manager 中的 Key。
- 供应商 Key 使用 AES-256-GCM 和 owner/config/provider 关联数据加密。
- Key 只写不回显。
- 模型请求 URL 禁止凭据、query、fragment、回环和私网解析；HTTP 客户端禁止重定向和自动重试，并把实际建连所用的 DNS 解析绑定到同一套公网地址校验，避免“先校验、后重新解析”的 DNS 重绑定窗口。本地 TUN 代理把域名映射到 `198.18.0.0/15` 时，只有内置官方域名可使用该 fake-IP 段，自定义域名仍会被拒绝。
- 这不是网络层 egress sandbox；生产环境仍建议使用防火墙或出站代理限制 Java 进程的访问范围，作为纵深防御。

## Chat and tool semantics

`POST /api/v1/chat/turns` 先持久化 `PENDING`。同一 owner 的 `clientTurnId` 唯一：

- `COMPLETED`：重复请求返回已经保存的结果；
- `PENDING` / `UNKNOWN`：只返回当前状态，不重放模型请求；
- `FAILED`：要求客户端修正后使用新的 `clientTurnId`；
- 服务重启遗留的 `PENDING` 超过 5 分钟后转为 `UNKNOWN`。

联网许可与搜索供应商的“已配置/当前线路”分离：

- 选区对话每轮接受 `OFF`、`AUTO`、`FORCE`。`OFF` 不向模型提供工具；`AUTO` 允许模型自行决定；`FORCE` 要求精确调用 `web_search`，供应商缺失或模型不支持工具时返回类型化失败。
- 主问题接受 `off`、`on`，默认 `off`。`on` 时网站服务端通过 Bearer 和 owner 调用 `POST /internal/v1/search`；该入口不经过浏览器 BFF，返回有界 HTTPS 结果。视觉模型只接收稳定证据 ID，最终文档必须引用其中至少一个 ID，否则修复或失败。
- Java 校验函数名、参数、每轮最多 2 次、每次最多 5 条结果，然后按当前搜索线路精确选择已注册适配器；缺失或重复适配器不会回退到其他供应商。每个选区回合持久化搜索模式、执行状态、配置 ID 与调用次数。

## Verification

```powershell
mvn -B -ntp -f backend/pom.xml test
```

测试覆盖 H2/Flyway V1→V3、owner 隔离、会话 revision CAS、供应商密钥不回显、本机 DeepSeek 默认路由、对话幂等/UNKNOWN、三种搜索模式、主问题内部搜索，以及 `tool_call → web search → tool result → final answer`。

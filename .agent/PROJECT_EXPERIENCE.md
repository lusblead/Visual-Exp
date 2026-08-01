# Visual Explanation Platform - AI 项目经验簿

> 目的：维护当前项目中已经验证、能够直接改变未来 Agent 行动的工程经验。
>
> 本文档不是任务日志。当前代码、协议、测试与运行结果优先于通用经验。

- 项目 ID：`visual-explanation-platform`
- 项目类型：`backend-service`、`frontend-web`、`ml-system`
- 人类工程经验库：`%USERPROFILE%\Documents\Obsidian Vault\工程实践经验`
- 文档状态：active
- 创建日期：2026-07-22
- 最近整理：2026-08-01

## 0. 快速索引

| ID | 主题 | 触发信号 | 作用域 | 状态 | 最后验证 |
|---|---|---|---|---|---|
| `PX-ARCH-001` | 冻结语义协议而非视觉布局 | 新增渲染器、宿主或布局能力 | `schemas/**`、`lib/lineage-contracts.ts`、`components/**` | active | 2026-07-25 |
| `PX-ARCH-002` | 模型厂商只存在于适配器层 | 切换模型、增加 provider、处理密钥与降级 | `lib/*-model.ts`、`lib/model-port.ts`、`app/api/lineage/**` | active | 2026-07-22 |
| `PX-AI-001` | 模型生成语义草稿，本地组装正式协议 | JSON 可解析但业务协议持续失败 | `lib/deepseek-*.ts`、`tests/deepseek-*.test.mjs` | active | 2026-07-26 |
| `PX-ARCH-003` | 来源状态与置信度正交 | 增加检索、引用或证据展示 | `lib/source-safety.ts`、`components/lineage-studio.tsx` | active | 2026-07-22 |
| `PX-SEC-001` | 本地持久密钥必须跨过独立可信边界 | 页面需要“一次写入、重启可用”的 API Key | `companion/**`、`lib/companion-client.ts`、`vite.config.ts` | active | 2026-07-26 |
| `PX-SEC-002` | 客户端回传的派生 AI 上下文必须由服务器签名绑定 | 递归解释依赖上一次模型结果 | `lib/explanation-context-token.ts`、`app/api/lineage/route.ts` | active | 2026-07-26 |
| `PX-SEC-003` | 运行时持久化数据不得进入 Git | 开源、发布、增加数据库或发现历史敏感文件 | `.gitignore`、`backend/data/**`、Git refs 与发布流程 | active | 2026-08-01 |
| `PX-UX-001` | 增加知识密度不等于增加节点数量 | 内容过薄、文字溢出或产品像导图 | `lib/visual-content-quality.ts`、`components/lineage-stage.tsx`、`app/styles/scenes.css` | active | 2026-07-26 |
| `PX-CONC-001` | 异步解释的可见性、任务与缓存必须分离 | 多个解释切换、关闭或并行生成时丢结果 | `lib/*-cache.mjs`、`components/lineage-studio.tsx` | active | 2026-08-01 |
| `PX-DATA-001` | 增量操作按版本应用并重验全图 | 修改 expand、操作类型或持久化 | `lib/lineage-contracts.ts`、`app/api/lineage/route.ts` | active | 2026-07-22 |
| `PX-BACKEND-001` | LLM 工具调用由 Java 裁剪能力并以持久状态闭合 | 增加对话、工具、外部检索或重试 | `backend/**`、`app/api/backend/**`、`lib/selection-chat-client.ts` | active | 2026-07-30 |
| `PX-DATA-002` | 持久化解释缓存恢复时重算规范身份 | 恢复会话、修改缓存键或父解释链 | `lib/knowledge-session-contract.ts`、`lib/*-cache.mjs` | active | 2026-07-28 |
| `PX-PERF-001` | Token 与延迟按测量层分账 | 调整预生成、比较模型成本或宣称提速 | `lib/prefetch-policy.mjs`、`lib/usage-receipt-metrics.mjs`、`evals/**` | active | 2026-07-28 |
| `PX-TEST-001` | 完整验收是四道门禁 | 提交、发布或修改模型/协议 | `package.json`、`tests/**` | active | 2026-07-26 |
| `PX-OPS-001` | 发布成功不等于在线模型已激活 | 配置 Sites、模型密钥或发布说明 | `.openai/hosting.json`、`.env.example`、`README.md` | active | 2026-07-22 |
| `PX-TOOL-001` | Windows 工具链不得假定 POSIX/Bash | 修改 npm 脚本、Sites 打包或 Wrangler 配置 | `package.json`、`vite.config.ts`、`build/**` | active | 2026-07-30 |
| `PX-ARCH-004` | 未知 provider 的降级语义存在规格冲突 | 修改 `resolveLineageModel` | `lib/model-port.ts`、`docs/lineage-mvp.md` | conflicting | 2026-07-22 |
| `PX-ARCH-005` | 协议存在多个事实源 | 协议进入 v2 或出现第二客户端 | `lib/lineage-contracts.ts`、`schemas/**`、`components/lineage-studio.tsx` | candidate | 2026-07-22 |
| `PX-ARCH-006` | 网页模型中转必须保留产品自有提问入口 | 接入网页 AI 或复用浏览器采集插件 | `specs/conversation-source-and-credentials.md`、`tests/web-relay-policy.test.mjs` | candidate | 2026-07-26 |

## 1. 项目不变量与高优先级约束

### PX-ARCH-001：冻结语义协议，不冻结视觉布局

- 状态：active
- 证据等级：direct
- 作用域：`schemas/**`、`lib/lineage-contracts.ts`、`components/lineage-studio.tsx`
- 触发条件：新增视觉形式、用户布局、宿主集成或协议字段
- 标签：`architecture`、`protocol`、`decoupling`、`visualization`
- 最后验证：2026-07-25

#### 问题与识别信号

当模型输出 DOM、组件名、像素坐标或某一种布局时，模型、协议、渲染器和宿主会一起变化，产品会退化为某一种“AI 导图生成器”。

#### 当前项目的正确做法

1. `visual-explanation-document/2` 只保存内容、父子层级、语义关系、表现建议、来源状态和正文术语标注。
2. `visual-explanation-operations/2` 只暴露 `add_node`、`add_relation`、`update_node`。
3. `x`、`y`、`style`、颜色、动画和组件名不得进入语义协议。
4. 若要保存用户布局，新增独立的 view-state/layout 协议，通过稳定 node ID 关联语义文档。
5. 名词解释等瞬时派生查询使用独立响应协议；不通过节点或增量操作把浮层状态写回 `VisualDocument`。

#### 最短安全路径

- 实现捷径：先修改 canonical 语义规则，再修改渲染器；不要让 provider 直接生成视图状态。
- 快速验证：`npm test` 中的 schema 测试必须继续证明协议没有 `x/y/style`。
- 完整验证：`npm test && npm run typecheck && npm run lint`，再人工检查新视觉形式不改变文档语义。

#### 正确性条件与适用边界

- 必须成立：同一份文档可被不同渲染器消费，且宿主不需要知道模型厂商。
- 不适用：纯一次性图片生成且无需继续编辑或追问的场景。

#### 可复用资产与证据

- 代码：`lib/lineage-contracts.ts`
- Schema：`schemas/visual-lineage-document.schema.json`
- 测试：`tests/contracts.test.mjs`
- 派生查询测试：`tests/api-lineage.test.mjs`

#### 关联

- 项目工程章节：`EL-AIBOUNDARY-001`
- 全局工程经验：`GX-SHARED-VALIDATION-001`

### PX-ARCH-002：模型厂商只存在于适配器层，降级必须显式

- 状态：active
- 证据等级：direct
- 作用域：`lib/model-port.ts`、`lib/deepseek-model.ts`、`lib/openai-model.ts`、`lib/demo-model.ts`、`app/api/lineage/route.ts`
- 触发条件：切换主模型、增加 provider、修改密钥、超时、重试或 fallback
- 标签：`provider`、`adapter`、`fallback`、`secrets`
- 最后验证：2026-07-25

#### 当前项目的正确做法

1. DeepSeek、OpenAI 和 deterministic demo 实现相同的 `VisualModelPort.create/expand/defineTerm`。
2. API 与 UI 只消费协议和 `{provider, model, fallbackReason}`，不导入厂商 SDK。
3. 托管密钥只从服务端环境读取；Windows 本地持久密钥只由回环 companion 从 Windows Credential Manager 读取，禁止 `NEXT_PUBLIC_*`、浏览器持久化和明文读回接口。
4. 缺少所选 provider 的密钥时可进入 demo，并必须返回 `provider: "demo"` 和降级原因。
5. 已配置 provider 但上游失败时返回类型化安全错误，不能静默伪装为 AI 成功；认证/无凭据/限流/暂时不可用必须可区分。

#### 最短安全路径

- 快速验证：设置 `LINEAGE_MODEL_PROVIDER=demo` 后运行 `npm test`。
- 完整验证：对目标 provider 验证真实 `create`、`expand`、空响应重试、非法 JSON、上游 5xx 和 90 秒超时。

#### 避免与失败方法

- 不要把 demo 通过称为模型质量通过。
- 不要在 provider 调用失败后自动切 demo；这会把故障伪装成成功。

#### 正确性条件与适用边界

- demo 只验证协议、交互和状态流，不验证问题理解、事实质量、延迟或费用。
- 2026-07-26 已用 Windows Credential Manager 中的真实 DeepSeek Key 验证本地 `create → expand → define`；这不代表 OpenAI 路径或生产环境 secret 已完成验收。

#### 关联

- 项目工程章节：`EL-DEGRADATION-001`

### PX-AI-001：让模型生成语义草稿，本地代码组装正式协议

- 状态：active
- 证据等级：direct
- 作用域：`lib/deepseek-model.ts`、`lib/deepseek-draft-contract.ts`、`lib/provider-errors.ts`、`tests/deepseek-*.test.mjs`
- 触发条件：JSON mode 返回合法 JSON，但图协议、作用域、术语或内容质量校验持续失败
- 标签：`prompt-engineering`、`structured-output`、`deterministic-assembly`、`repair`
- 最后验证：2026-07-26

#### 问题与识别信号

DeepSeek JSON mode 只约束 JSON 语法，不会替应用执行完整业务 Schema。让模型同时生成问题原文、协议版本、ID、父子指针、深度、版本、证据数组、状态和带大量 `null` 的 operation envelope，会把确定性机械工作变成概率性协调问题。原实现一次真实 create 在约 106 秒后连续两次被本地校验拒绝，最终只显示“内容无法解析”，同时丢失了真正的失败阶段。

#### 当前项目的正确做法

1. Prompt 先给动作级 Task Definition，再给精简 draft Schema 和一个完整正例；问题与场景上下文明确标为不可信数据。
2. DeepSeek 只生成标题、解释、语义类型、表现建议、同层关系索引和术语候选；协议、ID、版本、层级、证据、状态及 nullable envelope 由本地代码确定性生成。
3. 非关键术语候选在本地去重、限长并验证正文逐字出现；Create/Expand 的节点术语与 Define/Define Batch 的嵌套术语都按稳定顺序丢弃无效项，不拖垮整份可用场景或解释。被丢弃项从不进入可点击允许列表；正文、图结构、来源、签名上下文、递归深度和数学偏好仍保持硬校验。
4. Provider Retry 与 Content Repair 使用独立的一次预算：网络、429、可恢复 5xx 和资源不足原样重放；空、截断、非法或语义不合格候选携带有界坏输出、安全错误类别和类别专用修复要求重试一次。分类必须先匹配 relation/source/math/term/content 等具体字段，再匹配泛化 child shape；修复 Prompt 还要重申原始 Schema/数量/来源/数学不变量，避免“修好 shape 却新加公式”这种跨类别回归。
5. 认证、余额、参数错误和内容过滤立即停止；日志只记录 action、phase、attempt、duration、finish reason、长度和稳定类别，不记录 Key、问题、Prompt 或模型正文。
6. 动作级路由固定为：`create`、`expand`、`dive` 走 `deepseek-v4-pro`；`define`、`define_batch` 和嵌套名词解释走 `deepseek-v4-flash`。两者共享同一 Key 和传输边界，模型选择由动作决定，不暴露给画布协议或默认 UI。
7. 数学表达使用 `avoid | optional | requested` 三态，而不是“出现公式/完全禁止”二选一。默认 `optional` 最多允许一个确实帮助理解的公式且必须紧跟白话解释；`avoid` 禁止公式；`requested` 才允许完整推导。通行技术名词保持 `Encoder（编码器）` 这类双语整体，不机械地只保留中文。
8. 模型只能返回语义内容、同层关系与表现建议，不能返回 Mermaid/UML 源码、HTML、SVG、坐标、CSS 或组件名；关系图由渲染器从 canonical 文档安全投影。
9. 不一次生成完整知识空间：create 只生成 3–6 个高层入口，expand 只生成所选分支的 3–5 个直接子节点。场景准备只沿当前场景的直接入口按阅读顺序串行推进一个语义前沿；术语准备先处理当前节点，再处理可见入口，按节点最多 8 项批量且只有一个并发，不存在任意的“最多 6 项”波次上限。
10. 取消必须从 React controller 经过 `/api/lineage` 的 `request.signal` 一直传到 provider fetch；Abort 是终止状态，不能再触发 Provider Retry 或 Content Repair。前台点击可以中止不再需要的后台预取批次，但不能因为用户切换当前解释就取消仍有缓存价值的独立前台任务。

#### 已验证证据

- fake provider 覆盖确定性 create/expand 装配、503 原样重放、内容修复、修复耗尽、content filter 不重试与 define。
- 边界测试覆盖 77–80 节点容量、depth 11/12、关系索引、ID 冲突和术语安全丢弃。
- 名词契约回归覆盖非数组、非字符串、换行、超长、祖先重复、规范化重复、正文不存在及超上限嵌套候选；有效正文仍保留，只有前四个合法候选进入允许列表。
- 真实 ReLU Create 暴露了 `child_count_or_shape_invalid` 的过宽分类；关系自连接回归现证明它优先归入 `relation_reference_invalid`，并把有效且不相同的索引要求送入第二次 Prompt。
- 同一 ReLU 问题还暴露了未请求公式被归入 `semantic_contract_invalid`；数学偏好现拥有独立类别，修复 Prompt 明确删除公式、函数记法、推导和复杂度表达式，同时保留原有 fail-closed 边界。
- 真实第二次重试证明单一类别提示仍可能发生级联失败：主候选 child shape 不合格，修复候选改好 shape 后引入公式。现有修复 Prompt 会重申跨类别不变量，单测断言这段约束始终存在。
- 真实本地链路连续两轮成功。最终测量中 `deepseek-v4-pro` create 为 19.666 秒、expand 为 14.093 秒，`deepseek-v4-flash` define 为 1.921 秒；前一轮分别为 10.897、14.238、1.265 秒，证明单次延迟波动明显。
- 同一固定短提示的流式探针中，Pro TTFT 为 744–803 毫秒，Flash TTFT 为 512–677 毫秒；结构化场景仍需等完整 JSON、本地装配和校验后才能展示，所以 TTFT 不能冒充用户可用结果延迟。
- 2026-07-26 本轮固定短流探针测得 Pro TTFT 819 毫秒、Flash TTFT 613 毫秒；同轮完整可用结果为 Pro create 29.014 秒、Pro expand 21.474 秒、Flash define 1.503 秒。TTFT、完整可用结果和预生成命中是三种不同指标。
- 真实 Transformer 浏览器链路中，已准备入口在约 290 毫秒内完成点击与 DOM 切换且没有进入加载态；ReLU 的 Pro 深入结果继续通过已签名上下文调用 Flash 解释“梯度消失”。
- 最终同题 ReLU 浏览器回归中，Create 主候选因未请求公式进入 `math_preference_invalid`，13.250 秒的定向修复后在总计约 32.9 秒成功接纳；解释内“激活函数”的递归 Flash 请求约 1.7 秒成功。后台 Expand 若触发公式修复可达约 31.6–45.2 秒，进一步说明预生成改善的是点击命中，不降低上游总成本。

#### 关联

- 项目工程章节：`EL-STRUCTUREDGEN-001`
- 全局工程经验：`GX-MLSYSTEM-OUTPUTCONTRACT-001`、`GX-SHARED-UNCERTAINOUTPUT-001`

### PX-SEC-001：浏览器需要持久模型密钥时，引入 OS 凭据库与认证回环 companion

- 状态：active
- 证据等级：direct
- 作用域：`companion/**`、`scripts/start-local.mjs`、`lib/companion-client.ts`、`app/api/model-settings/**`、`vite.config.ts`
- 触发条件：页面设置 API Key、刷新/重启后继续使用、增加本地 provider
- 标签：`secrets`、`windows`、`credential-manager`、`loopback`
- 最后验证：2026-07-26

#### 当前项目的正确做法

1. 页面只提交候选 Key 和读取 `configured` 状态，不提供明文读取 API，不使用 localStorage、IndexedDB、URL 或仓库文件。
2. .NET companion 只监听 `127.0.0.1` 随机端口，拒绝浏览器 `Origin`，并要求每次启动随机生成的 bearer。
3. 候选 Key 先通过固定 DeepSeek `/models` 验证，确认 `deepseek-v4-pro` 与 `deepseek-v4-flash` 同时可用后才调用 `CredWrite`；无效替换不得覆盖旧 Key。
4. companion 固定上游 origin，并只允许 Pro/Flash 两个精确模型 ID；状态和错误响应不得包含 Key。
5. Vinext/Cloudflare 本地 Worker 不会自动继承任意进程环境变量；启动器变量必须在 `vite.config.ts` 显式映射为 server-worker bindings，并用“启动器 → `/api/model-settings`”端到端测试证明，而不能只验证两个进程分别启动。

#### 已验证证据

- `tests/local-companion.test.mjs` 覆盖 bearer/Origin 拒绝、凭据重启持久化、无效替换、固定模型代理、显式删除、sentinel 不泄露，以及 launcher 到 Vinext Worker 的绑定。
- `tests/model-settings.test.mjs` 覆盖无 companion、非法输入和响应不回显。
- 2026-07-26 Windows 实跑中，首次发现仅通过 child-process 环境变量传递时网页仍显示 companion 不可用；增加 Worker binding 后状态端点返回 `persistentAvailable=true`，并新增回归测试。

#### 关联

- 项目工程章节：`EL-LOCAL-SECRETS-001`

### PX-SEC-002：客户端回传的派生 AI 上下文必须由服务器签名绑定

- 状态：active
- 证据等级：direct
- 作用域：`lib/explanation-context-token.ts`、`app/api/lineage/route.ts`、`components/lineage-studio.tsx`、`scripts/start-local.mjs`、`tests/explanation-context-token.test.mjs`、`tests/api-lineage.test.mjs`
- 触发条件：下一次生成需要引用上一次术语解释或深入解释
- 标签：`trust-boundary`、`hmac`、`derived-context`、`recursive-generation`
- 最后验证：2026-07-26

#### 问题与识别信号

客户端回传的父解释即使满足 JSON Schema，也不能证明它确由当前服务器、当前文档和当前节点生成。若服务端只校验字段形状，客户端可以伪造更强的“已验证上下文”，再诱导模型基于它继续递归生成。

#### 当前项目的正确做法

1. `ect1` 是 payload-free HMAC-SHA256 token，绑定 `documentId`、节点 ID、节点内容指纹以及完整 canonical term/deep explanation。
2. 下一次递归请求必须同时回传父结果和 token；服务端重建完整 binding 并用常量时间比较，在调用 provider 之前拒绝篡改、跨文档、跨节点、协议混用和内容漂移。
3. token 只保存在客户端内存 `WeakMap`，不进入语义文档、URL、持久存储或日志；它不是通用 bearer credential，也不携带可自行解释的 claims。
4. 本地启动器每次启动生成独立 32 字节 secret；多实例生产环境必须配置并共享至少 32 字节的 `EXPLANATION_CONTEXT_TOKEN_SECRET`，缺失或过弱时 fail closed。

#### 已验证证据

- token 测试覆盖精确 binding、篡改、跨文档、跨节点、short/deep 分离、secret 轮换、开发进程内 fallback 和生产弱/缺失 secret。
- API 测试证明伪造或错配的父解释会在 provider 调用前被拒绝。
- 真实浏览器链路证明 Pro 深入结果中的“梯度消失”可带签名上下文继续获得 Flash 解释。

#### 关联

- 项目工程章节：`EL-DERIVED-CONTEXT-001`
- 全局工程经验：`GX-MLSYSTEM-OUTPUTCONTRACT-001`

### PX-SEC-003：运行时持久化数据绝不能进入 Git，发布必须同时审计工作树与完整历史

- 状态：active
- 证据等级：direct
- 作用域：`.gitignore`、`backend/data/**`、Git index/history/remote refs、开源与 Release 流程
- 触发条件：首次公开仓库、发布 Release、增加数据库/缓存/日志持久化、发现历史敏感文件或轮换凭据
- 标签：`git-history`、`persistent-data`、`secret-scanning`、`incident-response`、`release`
- 最后验证：2026-08-01

#### 问题与识别信号

文件型 H2 数据库属于运行时状态，不是可复现的源码或 migration。它可能混合会话、对话和加密后的供应商配置；即使当前工作树已删除、Key 不是明文或发布包来自一个干净新仓库，旧提交、远程分支、PR 引用和平台缓存仍可能继续提供原对象。只扫描当前 diff 会把“当前版本看起来干净”误判为“从未公开过数据”。

#### 根因

数据库目录在首次运行前没有被排除，并曾作为普通文件进入 Git 历史；后补 `.gitignore` 或在 HEAD 执行删除只阻止未来跟踪，不会改变已存在的对象和远程引用。密钥加密解决静态数据库泄露中的明文读取风险，但不能把包含用户数据或凭据密文的运行时快照变成可发布资产。

#### 当前项目的正确做法

1. `/backend/data/`、环境文件、日志和本地构建绑定必须在首次运行前进入 `.gitignore`；数据库结构通过 Flyway migration 重建，演示数据只能使用明确、可审查且不含个人信息的文本 fixture。
2. 每次公开或 Release 前执行两套独立门禁：工作树/index 扫描当前待发布内容；完整历史扫描所有本地分支、远程跟踪分支和标签。两者任何一项失败都停止发布。
3. 发现数据库进入历史后，先停止继续发布并确认所有受影响引用；任何可能出现在快照中的供应商凭据都必须在供应商端撤销和轮换，不能因为密文未被解开或扫描器未命中明文就保留旧 Key。
4. 干净新仓库或干净 source archive 只能保证新的发布物不再携带数据库，不能修复仍可访问的旧 GitHub 仓库。旧仓库还必须删除或重写所有受影响引用，并按 GitHub 敏感数据清理流程联系 Support 处理 PR refs、缓存和不可见引用。
5. 清理本地数据库内容、删除远程仓库、重写历史和 force push 都是不同的破坏性动作，必须分别确认准确目标和用户授权；清理过程中不得读取、打印或复制会话与凭据内容。

#### 最短安全路径

- 诊断捷径：先运行 `git ls-files -- backend/data` 与 `git log --all -- backend/data/`；前者检查当前 index，后者检查完整本地历史，不能互相替代。
- 实现捷径：先在 `.gitignore` 排除整个运行时目录，再用 `git rm --cached` 只解除跟踪并保留本地文件；只有用户明确授权后才能删除本地数据。
- 快速验证：对工作树运行 secret scanner，并确认 `git ls-files -- backend/data` 无输出；对历史运行 `gitleaks git --log-opts="--all"` 或等价的全引用扫描，并确认 `git log --all -- backend/data/` 无输出。
- 完整验证：`git fetch --all --prune` 后重新扫描所有远程跟踪引用；再下载拟发布的 GitHub source archive 检查数据库与密钥模式。若旧公开仓库曾包含数据，还必须以凭据轮换结果和 GitHub Support 清理结果作为独立完成证据。

#### 避免与失败方法

- 不要把“HEAD 已删除”“`.gitignore` 已补充”或“新仓库是干净的”称为旧仓库已经清理。
- 不要只扫描当前工作树、当前分支或最近一个 commit。
- 不要提交加密数据库并把“无法直接读 Key”当作隐私边界。
- 不要在未轮换凭据、未处理远程引用和平台缓存时仅依赖 force push 宣称事件结束。

#### 正确性条件与适用边界

- 必须成立：发布 source archive 不含运行时持久化文件；所有可达 Git refs 的历史扫描不含数据库或凭据；任何曾可能暴露的凭据已经轮换。
- 若敏感对象曾到达公开 GitHub，仅清理本地 clone 不成立；若它从未离开本机，远程 Support 清理不适用，但本地解除跟踪和发布门禁仍必须完成。
- 明确、合成、无个人信息的测试 fixture 可以进入 Git，但必须是最小、可审查的文本/代码资产，不能复用实际运行数据库。

#### 可复用资产与证据

- 2026-08-01 发布审查中，`git log --all -- backend/data/visualized-exp.mv.db` 直接证明运行时数据库曾进入分支历史；当前修复已在 `.gitignore` 排除 `/backend/data/` 并从 index 解除跟踪。
- 同轮 Gitleaks 完整历史扫描未发现明文凭据模式；该结果只证明扫描器未命中明文，不会覆盖数据库快照、远程可达性和凭据轮换门禁。
- 发布物校验入口：`.github/workflows/ci.yml`、`SECURITY.md`、`CONTRIBUTING.md`。

#### 关联

- 项目工程章节：暂无；本条只维护当前项目的精确发布作战规则。
- 全局工程经验：暂无；待独立项目证据支持后再考虑晋升。

### PX-UX-001：知识密度由当前场景正文与语义缩放承担，不靠堆更多节点

- 状态：active
- 证据等级：direct
- 作用域：`lib/visual-content-quality.ts`、`lib/primary-material.ts`、`components/lineage-stage.tsx`、`components/lineage-scene-primitives.tsx`、`components/semantic-diagram.tsx`、`app/styles/**`
- 触发条件：用户反馈“内容太少”“像知识导图”“边框使文字溢出”
- 标签：`semantic-zoom`、`content-density`、`responsive-layout`、`terms`
- 最后验证：2026-07-26

#### 当前项目的正确做法

1. 默认投影是一条从上到下的线性 knowledge spine，而不是卡片墙或关系胶囊；保持首层 3–6 个入口、展开 3–5 个子入口，不为“看起来丰富”增加节点数。
2. 每层先给克制标题和醒目的直接回答，再用多段正文交代背景、作用、机制与边界，最后才显示下一层入口；标题降权，正文承担主要视觉权重。
3. 每个入口必须说明自身内容及 `whyHere`，让用户知道“为什么它出现在这里”；节点使用 normal flow 和自适应高度，禁止固定径向坐标、line-clamp、ellipsis 与固定卡片高度。
4. `terms` 是正文中实际出现的 0–8 个语义标注；当前正文、短解释中的嵌套术语和深入解释中的术语都可继续解释。
5. 短解释以右侧（窄屏为底部）工作区并列容纳多个卡片；关闭单卡只改变可见性，不取消任务或删除缓存。双击术语或选择正文后显式点击“深入”走 Pro，并在正文流中全宽展开。
6. 数学偏好使用三态：用户避开数学时完全不生成；默认场景只在确有帮助时给一个带白话解释的公式；明确要求数学时才展开推导。常见中英技术名词作为一个可交互整体保留，例如 `Encoder（编码器）`。
7. 当前层的直接入口和可见术语在阅读期间后台准备；预生成只改善 prepared hit，不改变 provider TTFT，也不能提前递归生成未进入分支的孙层内容。
8. 架构、流程、比较或时间内容可显示由渲染器生成的关系投影，但线性正文始终是权威内容；投影只消费 canonical 节点和关系，不能执行模型返回的图形源码。
9. 文学作品等知识性提问先显示可验证的主体材料，再进入解释。完整正文只允许来自用户输入、公共领域或已授权来源；受保护、未知或本地没有可靠正文时显示节选或明确“无法提供”，不能让模型凭记忆补写。
10. 共享质量守卫同时约束 DeepSeek、OpenAI 和 demo，拒绝过薄、重复、导航填充与正文中不存在的术语。
11. “逐字子串存在”不等于“可交互语义边界”。生成校验与渲染必须共用同一术语匹配器：ASCII 遵守词边界和长词优先；中文单字只在独立语义位置命中，不能把“关键”拆成“关[键]”。

#### 已验证证据

- 全量自动测试覆盖线性阅读、whyHere、公式延迟、递归术语、选择文本深入、场景/术语预生成及并发取消。
- 真实 Transformer 根场景首先显示直接答案、背景、作用、机制和边界；ReLU 短解释含可递归的“激活函数”，Pro 深入结果按“直接理解/为什么会出现/在这里的作用/如何工作/边界”展开。
- 真实《静夜思》浏览器链路先显示完整原文、作者和可追溯来源，再显示解读；根正文实测为 18.56–21px、标题约 28px，且桌面视口没有横向溢出。
- 同一链路的两个名词解释卡可同时存在；关闭一个后另一个保留，再次点击已关闭名词约 0.5 秒直接恢复且无加载态。已准备的下一层约 284 毫秒完成 DOM 切换且没有进入加载态。

#### 关联

- 项目工程章节：`EL-AIBOUNDARY-001`、`EL-READABILITY-001`

### PX-ARCH-003：来源状态与模型置信度必须正交

- 状态：active
- 证据等级：direct
- 作用域：`lib/source-safety.ts`、`lib/primary-material.ts`、`lib/*-model.ts`、`components/primary-material-block.tsx`、`components/lineage-studio.tsx`
- 触发条件：增加检索、引用、证据节点、来源徽标或置信度逻辑
- 标签：`provenance`、`confidence`、`hallucination`、`evidence`
- 最后验证：2026-07-26

#### 当前项目的正确做法

1. 没有检索或来源输入时，create 禁止 `source_backed`，`evidence` 必须为空。
2. expand 只能逐字段复用输入文档已有证据的指纹，不能引入新来源。
3. UI 分别展示 `sourceStatus` 与 `confidence`；高置信不能冒充有来源。
4. 接入搜索时新增 `EvidencePort`，由它提供可追溯来源；不要放宽模型适配器的自证权限。
5. 主体材料另有 `complete | excerpt | unavailable` 与 `user | public_domain | licensed | protected | unknown` 两组正交状态。完整再现只允许用户提供、公共领域或明确授权；其他情况降为有界节选或不可用，并保留原因和来源链接。

#### 最短安全路径

- 快速验证：`npm test` 验证 demo create/expand 不生成证据和 `source_backed`。
- 完整验证：对来源伪造、URL 变体、空证据却声明有来源、已有证据原样复用做行为测试。

#### 正确性条件与适用边界

- “允许复用”不等于来源真实；当前项目尚未验证输入来源的真实性、时效或权威性。

#### 关联

- 项目工程章节：`EL-EPISTEMIC-001`
- 全局工程经验：`GX-MLSYSTEM-OUTPUTCONTRACT-001`

### PX-DATA-001：增量操作按基础版本应用，并在提交后重验全图

- 状态：active
- 证据等级：direct
- 作用域：`lib/lineage-contracts.ts`、`app/api/lineage/route.ts`、`tests/api-lineage.test.mjs`
- 触发条件：修改 expand、增加操作类型、增加保存/协作或改变版本语义
- 标签：`versioning`、`mutation`、`consistency`、`graph`
- 最后验证：2026-07-22

#### 当前项目的正确做法

1. `baseVersion` 必须等于当前文档 `version`。
2. 在副本上顺序应用受限操作；整批成功后版本只增加一次。
3. 应用完成后重新运行完整文档校验，拒绝重复 ID、悬空关系、自引用和非法继承。
4. API 返回服务端已验证的完整 `document`，同时可返回 `operations` 供 UI 解释变化。

#### 正确性条件与适用边界

- 当前服务端不持久化权威文档，客户端会提交完整文档；这只提供会话内乐观一致性。
- 多设备或多人协作前必须引入服务端文档版本、CAS/ETag 或事件日志，不能把当前版本号当作并发控制完成。

#### 可复用资产与证据

- 代码：`applyLineageOperations`、`parseLineageDocument`
- 测试：`tests/api-lineage.test.mjs`

#### 关联

- 项目工程章节：`EL-AIBOUNDARY-001`

## 2. 标准工作流与安全捷径

### PX-TEST-001：完整验收是 build、行为测试、类型检查、Lint 四道门禁

- 状态：active
- 证据等级：direct
- 作用域：`package.json`、`package-lock.json`、`tests/**`、`dist/**`、`lib/*-model.ts`
- 触发条件：提交、发布或修改协议、provider、API、SSR 和 UI
- 标签：`testing`、`build`、`contract`、`release`
- 最后验证：2026-07-26

#### 当前项目的正确做法

```text
npm ci                       # 先证明 package.json 与 lockfile 可复现
npm test                     # companion build + web build + 协议/API/本地凭据测试
npm run typecheck            # vinext build 不替代类型检查
npm run lint                 # 独立静态门禁
npm run harness:minimal      # 聚合上述门禁并检查当前产品规格的稳定约束
```

`npm test` 当前覆盖 SSR、协议不变量、内容质量、explanation v2/deep v1、正文与递归术语、批量定义、场景/术语预生成优先级、取消传播、签名上下文与防伪、provider 配置、demo API、模型设置，以及 Windows companion 的真实 Credential Manager 生命周期和 launcher-to-worker 桥接。跨组件行为流还必须运行 Feature Flow `validate` 与 `finalize`。

#### 避免与失败方法

- 不要只运行 `npm test` 就宣称完整通过；它不包含 typecheck 与 lint。
- 不要把源码正则断言当作上游运行时集成测试。
- 不要把服务端 HTML 关键文案测试当作浏览器交互、移动端或视觉回归。
- 不要把远端任务摘要中的“已通过”当作门禁证据；必须在指定提交的本地副本上重跑。
- GitHub diff/patch 文本不能证明原始 blob 是合法 UTF-8；逐文件 hash 异常时应直接检查 raw blob 编码并以编译器结果为准。

#### 完整验证

- 远端分支同步：核对 base/head SHA、变更文件集合和 Git blob；再运行 `npm ci` 暴露锁文件漂移。
- 普通改动：上述四道门禁全部通过。
- 行为或跨组件流程改动：Feature Flow `validate` 必须为 0 errors/0 warnings，随后 `finalize`；这证明行为节点、边、守卫、代码和测试引用完整，不证明浏览器视觉质量或真实模型延迟。
- provider 改动：再加假上游故障注入、真实 key 的 create/expand 和生产环境调用。
- 本地凭据改动：必须保留 fake DeepSeek、Windows Credential Manager 实写和启动器到网页状态端点的跨进程测试。
- 发布：确认 `dist/server/index.js` 与 `dist/.openai/hosting.json` 存在，保存版本的 commit SHA 等于已推送 HEAD。
- 2026-07-26 当前最终 Harness 实测 125/125，通过 companion Release build、Vinext production build、行为测试、TypeScript 与 Lint；Feature Flow 另行要求 0 error/0 warning。
- 本轮视觉规范把正文行高从旧值调整为 1.84 后，专用 Harness 因仍冻结 1.78 而失败；更新现行规格断言后通过。这一故障说明视觉 Harness 必须与当前规格同步，且稳定行为断言优先于无业务含义的历史常量。

#### 关联

- 项目工程章节：`EL-VALIDATION-001`
- 全局工程经验：`GX-SHARED-VALIDATION-001`

### PX-OPS-001：发布成功与在线模型激活是两份独立证据

- 状态：active
- 证据等级：direct
- 作用域：`.openai/hosting.json`、`.env.example`、`README.md`、Sites 运行环境
- 触发条件：发布、设置 runtime secret 或对外描述线上能力
- 标签：`deployment`、`secret`、`verification`、`deepseek`
- 最后验证：2026-07-22

#### 当前项目的正确做法

1. Sites 成功只证明已验证构建被发布，不证明 DeepSeek 已被调用。
2. 没有 `DEEPSEEK_API_KEY` 时，线上按设计进入 demo，必须在 UI/API 中显式标记。
3. 设置 Sites secret 后，必须重新做生产环境 `create` 与 `expand`，确认 `provider: "deepseek"`。
4. 发布报告分别列出：源码/构建/测试状态、部署状态、真实模型在线验收状态。

#### 正确性条件与适用边界

- 当前已验证：本地构建、离线测试、已保存凭据下的真实 DeepSeek create/define/nested define/dive，以及安全分类驱动的 create repair。
- 当前未验证：Sites 生产 secret、线上部署链路、长期延迟/费用分布和真实 provider 的高并发行为。

#### 关联

- 项目工程章节：`EL-VALIDATION-001`

### PX-TOOL-001：Windows 工具链不得以命令存在推断 Bash 可用

- 状态：active
- 证据等级：direct
- 作用域：`package.json`、`vite.config.ts`、Sites 初始化与打包流程
- 触发条件：修改 npm 脚本、Wrangler、Miniflare、Sites 初始化或发布打包
- 标签：`windows`、`bash`、`wrangler`、`tooling`
- 最后验证：2026-07-30

#### 问题与识别信号

Windows 上可能存在 `bash.exe`，但 WSL 内没有 `/bin/bash`；`Get-Command bash` 成功仍不能运行 Bash 脚本。POSIX 形式 `ENV=value command` 也不能由默认 Windows npm shell 执行。

#### 当前项目的正确做法

1. npm 脚本保持 `vinext dev/build/start`，不要写 POSIX 行内环境变量。
2. Wrangler/Miniflare 的非敏感项目内路径在 `vite.config.ts` 设置，并在导入 Cloudflare 插件前完成。
3. 使用 Bash helper 前执行真实命令验证；不可用时采用语义等价的 PowerShell 流程。
4. Node 24 在 Windows 上可能对直接 `spawn/spawnSync("*.cmd", args)` 返回 `EINVAL`；只含固定内部命令时，可用 shell 模式或显式 `cmd.exe /d /s /c` 包装，禁止拼接不可信输入。`scripts/start-local.mjs` 的 Maven 启动必须由隔离端口和内存数据库集成测试覆盖。
5. Sites 归档必须检查 `dist/server/index.js` 和 `dist/.openai/hosting.json` 两个精确条目。
6. Vinext/Cloudflare 的 Miniflare inspector proxy 在 Windows 的全链路 launcher 测试中可能于 workerd 重配时出现 `ECONNRESET`。若 all-in-one launcher 不提供调试入口，应只对该 launcher 的 web 子进程设置 `inspectorPort: false`；普通 `npm run dev` 继续保留默认 inspector，不能为修测试全局关闭开发能力。

#### 最短安全路径

- 诊断捷径：运行 `bash --version` 或最小 `bash -lc`，不要只看命令是否存在。
- 快速验证：`npm run harness:minimal`，确认 Windows 子进程能够依次执行 test、typecheck 与 lint，并由 launcher 集成用例穿过 companion、Java、Vinext Worker。
- 完整验证：build、归档条目校验、保存版本、核对 commit SHA、私有部署状态成功。

#### 可复用资产与证据

- Windows Harness：`harness/minimal-visual-conversation.mjs`
- 验证结果：2026-07-30 在 Node 24.11.1 / Windows 上通过；launcher 专用 inspector 关闭后连续目标用例与完整 Harness 通过。

#### 关联

- 项目工程章节：`EL-PORTABILITY-001`

## 3. 架构与模块边界

本项目的权威边界由 `PX-ARCH-001`、`PX-ARCH-002`、`PX-ARCH-003` 和 `PX-DATA-001` 维护。

## 4. 数据、事务与一致性

Java 后端现已通过 Flyway 管理会话、对话回合和供应商配置；语义谱系一致性规则仍见 `PX-DATA-001`，浏览器会话中的 AI 派生缓存继续按 `PX-DATA-002` 重建内容身份。

### PX-BACKEND-001：LLM 工具调用必须由 Java 裁剪能力并以持久状态闭合

- 状态：active
- 证据等级：direct
- 作用域：`backend/src/main/java/com/visualizedexp/backend/**`、`backend/src/main/resources/db/migration/**`、`app/api/backend/**`、`components/selection-chat-panel.tsx`、`lib/selection-chat-client.ts`
- 触发条件：新增 AI 对话、Tool Calling、外部检索、供应商凭据、回合重试或会话恢复
- 标签：`java-backend`、`tool-calling`、`idempotency`、`recovery`、`secret-boundary`
- 最后验证：2026-07-30

#### 当前项目的正确做法

1. canonical 语义文档、`chat_turns` 和供应商配置分别持久化；对话不能把临时问答写回语义文档。
2. 客户端为每个提交生成稳定 `clientTurnId`，Java 用 `(owner_id, client_turn_id)` 唯一约束和请求摘要裁决重复请求；同键异参拒绝。
3. 外部模型调用前先写 `PENDING`。成功才转 `COMPLETED`；确定失败转 `FAILED`；模型传输结果不确定或进程中断留下的陈旧回合转入不可重放的歧义状态。
4. 选区模型只能提出 `web_search(query, freshness?)` 候选。Java 校验工具名、严格参数、两次调用预算、查询长度和结果上限；不会抓取结果页。主问题使用 Bearer + owner 保护的私有内部搜索 Controller，浏览器 BFF 不暴露通用搜索接口。
5. `ProviderWebSearchClient` 是稳定 Tool Gateway：它只选择 active profile、裁剪输入并规范化结果；`SearchProviderRegistry` 按 `ProviderType` 精确分发到 Tavily/Brave adapter。重复、错误 kind 或缺失 adapter 必须 fail closed，不能回退。新增搜索供应商不修改模型 tool loop。
6. 搜索配置验证和运行时搜索必须复用同一个 `SearchProvider` adapter，避免保存时与运行时的 URL、认证头、请求体和响应解析漂移。
7. 模型预设只是可编辑模板。供应商保存必须用所选模型 ID、API 格式、Base/完整 URL 和认证方式发起最小完成；不要用统一的 `GET /models + Bearer` 冒充跨供应商验证。
8. 搜索结果以 `EXTERNAL_UNTRUSTED_EVIDENCE` 注入模型，只有 HTTPS、非空标题和有界字段能进入回合来源；保存来源不等于证明最终回答逐条引用。
9. Java 模型/搜索覆盖的 API Key 只写入 Java，使用 AES-256-GCM 和 owner/config/provider AAD 加密；本机 DeepSeek Key 仍只存在 Windows Credential Manager，Java 通过固定回环 companion 使用它而不读取或复制。BFF 只传服务端生成的 owner ID 与内部 bearer，不转发浏览器 Cookie。
10. 联网能力必须按用户入口逐条验收：`provider configured`、`provider active`、`entry permission`、`tool/evidence offered`、`search executed` 和 `sources persisted` 是不同事实。主问题用显式 on/off 驱动确定性预搜索和证据 ID；selection chat 用 OFF/AUTO/FORCE 驱动 Tool Calling，并持久化执行 trace。配置存在不能自动开启联网。
11. 模型路由按“owner 模型覆盖 → 本机 DeepSeek companion → 类型化未配置错误”解析；这样上方一次配置即可支持语义图和 AI 对话，下方保留为可选覆盖，而不是复制密钥或合并两个密钥事实域。
12. 对话 Tool loop 在开始时只解析一次 active search profile，并把 provider 明文快照与配置 ID 固定到不可变 `SearchSession`；后续激活切换不能让实际执行者与审计 ID 指向不同配置。
13. 每次搜索 I/O 完成后，在发送下一次模型请求前立刻把 `USED`、配置 ID、完成调用数与规范化来源写回仍为 `PENDING` 的回合。之后模型确定失败可转 `FAILED`，传输不确定可转 `UNKNOWN`，但都不能擦除已观察到的搜索事实。`OFFERED` 只表示允许联网且未记录到完成或失败的搜索调用，不证明模型没有尝试。
14. 只有结构化上游错误明确提到 `tools` 或 `tool_choice` 时才映射 `model_tools_unsupported`；普通 400/404、认证或 companion 拒绝必须保留原错误分类，且不得通过去掉 tools 重试来掩盖不兼容。

#### 最短安全路径

```text
selection chat: insert PENDING once
  -> model completion with a server-owned tool catalog
  -> validate tool call and execute fixed Java adapter
  -> persist USED trace and sources while still PENDING
  -> append bounded untrusted evidence
  -> final model completion
  -> COMPLETED, or FAILED/UNKNOWN while retaining observed search progress

main create with search=on
  -> private Java search once
  -> stable evidence IDs
  -> visual model draft
  -> validate at least one canonical evidence reference

known provider failure -> FAILED
ambiguous transport or stale PENDING -> non-replayable state
duplicate same hash -> return stored state
duplicate different hash -> conflict
```

- 快速验证：`mvn -f backend/pom.xml test`、selection/provider/BFF JavaScript tests；搜索层至少覆盖 registry 精确分发、缺失/重复 fail-closed，以及每个 adapter 的 URI、方法、鉴权、参数和响应映射。
- 完整验证：依次运行 `npm test`、`npm run typecheck`、`npm run lint`，再用真实浏览器验证桌面/移动布局、刷新恢复和同源代理。

#### 边界与反例

- 当前工具是只读、低风险检索，因此无需照搬写操作的 Preview/确认/Outbox；若以后加入业务写 Tool，必须重新引入权限、确认、后置校验和对账。
- 当前 owner 是 HttpOnly 设备 Cookie，不是账户认证或多设备同步；公开共享部署前仍需真实身份、租户配额、限流和并发上限。
- 自定义供应商拒绝非 HTTPS、重定向和非公网地址；实际建连也通过同一安全 DNS resolver 获取已校验地址，消除了应用内“预检查后再次解析”的窗口。生产网络 egress 仍应作为纵深防御。
- 同一设置窗口展示多个配置域时必须标明解析优先级。上方本机 DeepSeek 是语义图和 AI 对话默认通道；下方模型配置是 owner 范围的可选覆盖；搜索配置只选线路，入口开关才授予联网许可。
- 不能等最终模型回答成功后才保存搜索来源。第二次模型请求是新的失败边界，必须先提交已完成的搜索进度；provider 路由也必须在 loop 开始时固定快照，避免并发切换导致执行与审计漂移。
- 本轮 fake provider、H2、V1→V3 迁移、两种搜索 adapter 请求契约和浏览器配置界面已有证据；真实模型/搜索 Key、PostgreSQL、生产部署与并发压测仍未验证。

#### 关联

- 项目工程章节：`EL-TOOLGATEWAY-001`
- 全局工程经验：`GX-AGENTSYSTEM-EXECUTION-001`、`GX-AGENTSYSTEM-CONTEXTEVIDENCE-001`

### PX-DATA-002：持久化解释缓存恢复时必须重算 canonical identity

- 状态：active
- 证据等级：direct
- 作用域：`lib/knowledge-session-contract.ts`、`lib/term-prefetch-priority.mjs`、`lib/deep-reading-cache.mjs`、`tests/knowledge-session.test.mjs`、`tests/knowledge-session-repository.test.mjs`
- 触发条件：新增或修改会话恢复、解释持久化、缓存键、节点正文、嵌套术语或深入解释父链
- 标签：`persistence`、`cache-identity`、`derived-data`、`fail-closed`
- 最后验证：2026-07-28

#### 问题与识别信号

解释对象通过 Schema 只证明字段形状合法；携带服务器签名的上下文 token 只证明该模型产物曾由可信边界签发。二者都不能证明持久化记录的 `key` 仍与当前文档、节点正文、术语、选择文本及父解释链对应。若恢复时只信任存下来的 key，格式正确且签名真实的旧结果仍可能被显示到错误内容旁边。

#### 当前项目的正确做法

1. 先解析 canonical 文档，再把 term/deep 记录当作不可信派生数据逐项解析。
2. 使用运行时同一组 `termExplanationCacheKey`、`nestedTermExplanationCacheKey`、`deepTermExplanationCacheKey` 和 `deepReadingCacheKey` helper 重算身份，并与持久化 key 精确比较。
3. 根术语还必须是节点允许且正文中存在的标注；嵌套术语与深入结果按已保留的 canonical 父结果做有界不动点遍历，不能由一个悬空子结果自行成为信任根。
4. 恢复路径丢弃单个无效、重复、悬空或非规范缓存，再清理 card stack、可见 key 与 active deep key；不能因为一个可丢弃缓存损坏就丢整份 canonical 知识文档。
5. 写入内存中的新会话使用严格模式：非规范身份直接拒绝，避免把新坏数据保存后再依靠下次恢复清理。
6. 签名验证与缓存身份重算是两道正交门禁，任何一方都不能替代另一方。

#### 最短安全路径

- 实现捷径：缓存身份只通过共享 helper 生成；持久化层调用 helper 重算，不复制哈希拼接规则。
- 快速验证：运行 `tests/knowledge-session.test.mjs` 与 `tests/knowledge-session-repository.test.mjs`。
- 完整验证：再运行会话 Harness、TypeScript、Lint，并注入错 key、旧正文、错误父链、重复 key 和混合有效/无效缓存。

#### 正确性条件与适用边界

- canonical 文档结构或集合外形非法仍应拒绝整份会话；只有可独立重建的派生缓存适合逐项丢弃。
- 签名 token 的密钥轮换、过期和真实性由安全边界负责；本条只保证“恢复到正确语义位置”，不把本地缓存升级为事实来源。

#### 可复用资产与证据

- 恢复实现：`retainCanonicalExplanationCaches`
- 身份生成：`lib/term-prefetch-priority.mjs`、`lib/deep-reading-cache.mjs`
- 回归测试：`tests/knowledge-session.test.mjs` 中的 canonical parent、错误 key、深层 lineage 与 strict creation 场景

#### 关联

- 项目工程章节：`EL-CACHING-001`
- 全局工程经验：`GX-FRONTEND-CACHEIDENTITY-001`

## 5. 并发、锁与异步任务

当前已有设备 owner 范围内的服务端会话存储和 revision CAS，但没有账户登录、多设备同步或多人协作。不要把该设备级边界宣称为多用户并发控制。浏览器内的解释任务仍有真实的异步竞态，按以下条目处理。

### PX-CONC-001：异步解释必须把可见性、任务与缓存生命周期分开

- 状态：active
- 证据等级：direct
- 作用域：`components/lineage-studio.tsx`、`lib/explanation-task-cache.mjs`、`lib/deep-reading-cache.mjs`、`lib/backend-knowledge-session-repository.ts`、`tests/explanation-task-cache.test.mjs`、`tests/deep-reading-cache.test.mjs`、`tests/backend-knowledge-session-repository.test.mjs`
- 触发条件：允许同时打开多个解释、切换 A/B 深入结果、关闭后恢复、预取、快速切换控制面或重试
- 标签：`async-task`、`cache`、`generation-guard`、`react`
- 最后验证：2026-08-01

#### 问题与识别信号

若“当前显示的解释”同时充当“正在执行的请求”和“已经得到的缓存”，切换 A→B 会取消 A 或让 B 的迟到结果覆盖 A；关闭卡片也会意外删除缓存。文档版本的无关变化若进入缓存键，还会制造大量无效重算。

#### 当前项目的正确做法

1. 稳定 identity 绑定文档、节点、选择文本、源正文和已签名父解释内容；不绑定与内容无关的整个 `document.version`。
2. 每个 identity 独立维护 `pending | ready | error`、generation 和 Promise；同 key pending 去重，不同 key 可以独立完成。
3. `visibleKeys` 与任务注册表分开；close/hide 只移除可见 key，不 abort、不删除 ready/error，也不让 pending 失去落点。
4. 每次 settle 必须校验当前 generation；显式 retry/reset 先递增 generation，旧请求迟到也不能覆盖新状态。
5. 新文档或组件卸载才执行全量 abort/reset；容量淘汰只能选择非 pending、非 visible 的最旧 settled 项。
6. 可替换的后台请求还要把当前 `AbortController` 当作所有权 token：只有仍拥有 ref 的 controller 可以写 `ready/failed` 或失败集合；当前请求取消后必须把可见的 `preparing` 收口为 `idle`，旧请求不能污染接替者。
7. 高频控制面要拆开“用户想要的值”和“实际启动后台工作的有效值”。切换预生成挡位时先暂停有效后台策略并替换 settle timer，只有最新稳定意图可以重新启动，已完成缓存和前台任务不受影响。
8. 从 IndexedDB 迁移到 Java 后端时不能丢失浏览器内写入顺序。`save`、`activate`、`delete` 共用 failure-tolerant write tail，快照在入队时固定；Java revision CAS 继续负责持久层防旧写，客户端队列负责避免同页并发 PUT 和动作乱序。

#### 最短安全路径

- 快速验证：运行 `tests/explanation-task-cache.test.mjs`、`tests/deep-reading-cache.test.mjs`、`tests/client-navigation.test.mjs` 与 `tests/backend-knowledge-session-repository.test.mjs`，覆盖 A/B 乱序完成、同 key 去重、hide/reopen、retry/reset、controller 所有权、最新意图调度、快照固定和 failure-tolerant 串行写。
- 完整验证：浏览器除验证多卡并存外，还要快速切换预生成挡位，确认最终选项、保存状态、入口准备状态和控制台错误；延迟首个浏览器 mutation，再发后续 save/activate/delete，确认 `maxInFlight === 1` 且失败不会堵塞队列。

#### 已验证证据

- 2026-08-01 全量验证通过：Java 62 项、前端与协议 208 项、本地伴侣 17 项；串行 mutation 回归直接断言同时在途请求不超过 1，首次失败后后续写继续。
- 真实浏览器快速切换 `深入 → 省流 → 平衡` 后最终保持平衡、保存状态为已保存，入口无残留准备中/失败，控制台无错误；这是运行时 UI 证据，不替代对中间请求是否真正发出的网络级观测。

#### 关联

- 项目工程章节：`EL-ASYNC-EXPLANATION-001`
- 全局工程经验：`GX-FRONTEND-TASKLIFETIME-001`

## 6. 性能与资源使用

### PX-PERF-001：Token 与延迟必须按调用、供应商用量和可见阶段分账

- 状态：active
- 证据等级：direct
- 作用域：`lib/prefetch-policy.mjs`、`lib/usage-receipt-metrics.mjs`、`components/lineage-studio.tsx`、`evals/EVAL_PLAN.md`、`tests/prefetch-policy.test.mjs`、`tests/token-economy-live-compare.test.mjs`
- 触发条件：调整预生成强度、比较模型或策略、测量 Token、报告 TTFT/首屏/进入下一层延迟
- 标签：`performance`、`token-accounting`、`latency`、`prefetch`
- 最后验证：2026-07-28

#### 问题与识别信号

预生成会把用户之后的等待移到后台，却不改变模型开始响应的速度；共同的首次 create 又会同时出现在所有档位。若把 issued call、provider usage、TTFT、完整可用 JSON 和缓存命中混成一个数字，就会把“多花后台 Token 换取下一次即时进入”误报成模型提速，或把取消/丢弃的已发请求从预算中消失。

#### 当前项目的正确做法

1. 把所有档位共享的 create 单列：端到端总量包含它，档位间增量节省率不重复归因给它。
2. 请求一旦真正发出，每个终态恰好记录一个幂等 receipt：`success`、`error`、`aborted` 和因版本守卫丢弃的 `discarded` 都消耗 issued-call 预算；在调度等待期取消且尚未发出的工作不记调用。
3. receipt 区分 foreground/background、action、model、duration 与 frontier；重复 receipt ID 只能计一次，恢复后继续参与预算，避免刷新重花。
4. Token 只汇总供应商返回的有限数值 `usage`；缺失保持 `null/unknown`，不得用字符数或字节数冒充 Token。
5. provider TTFT 只表示流式上游首次增量；结构化场景的 usable-result latency 结束于完整 JSON 装配和校验；prepared/cache hit 则是已有结果的本地展示延迟。三者必须分别报告。
6. 预生成策略本身对 provider TTFT 的改善按 `0 ms` 处理，除非另有直接流式测量证明模型或传输层改变。

#### 最短安全路径

- 诊断捷径：先画出 `shared create → profile-issued work → provider usage → usable result → prepared hit` 的分账边界，再比较档位。
- 快速验证：运行 `tests/prefetch-policy.test.mjs`、`tests/token-economy-live-compare.test.mjs` 与 `npm run harness:token-economy`。
- 完整验证：在冻结问题集上保留逐调用原始记录，分别汇总调用数、官方 Token、TTFT、完整可用结果和 prepared hit；产品失败与基础设施失败不得混为一类。

#### 避免与失败方法

- 不要把后台准备完成后的本地切换称为“首字延迟降低”。
- 不要从平均响应字符数推算 Token 后宣称节省。
- 不要只统计 accepted 结果；已经发出但失败、取消或被版本守卫丢弃的请求同样消耗预算。
- 不要把所有档位共同支付的 create 当成某一档位的调度收益。

#### 正确性条件与适用边界

- 当 provider 不返回 usage 时，只能报告 issued-call 差异和 Token `unknown`，不能给出 Token 节省率。
- prepared hit 只有在后台结果已完成且仍匹配当前 canonical identity 时成立；用户过早点击仍是前台等待。
- 当前冻结基线证明 TTFT、完整可用结果和 prepared hit 的数量级明显不同；具体模型延迟与费用仍受上游波动影响，必须以同一数据集、同一时间窗的原始记录为准。

#### 可复用资产与证据

- 预算与去重：`lib/prefetch-policy.mjs`
- 用量汇总：`lib/usage-receipt-metrics.mjs`
- 终态 receipt：`components/lineage-studio.tsx`
- 测量契约：`evals/EVAL_PLAN.md`
- 冻结基线：`evals/runs/2026-07-28-live-token-latency-baseline.md`

#### 关联

- 项目工程章节：`EL-PERFORMANCE-001`
- 全局工程经验：`GX-MLSYSTEM-COSTLATENCY-001`

## 7. 测试、发布与故障恢复

标准门禁见 `PX-TEST-001`，发布能力边界见 `PX-OPS-001`。

## 8. 构建、生成器与工具约束

Windows 与 Sites 约束见 `PX-TOOL-001`。

## 9. 待验证经验

### PX-ARCH-004：未知 provider 的降级语义存在规格冲突

- 状态：conflicting
- 证据等级：direct
- 作用域：`lib/model-port.ts`、`docs/lineage-mvp.md`
- 触发条件：修改 provider resolver 或配置错误处理
- 标签：`configuration`、`fail-closed`、`spec-conflict`
- 最后验证：2026-07-22

规格写明“只有缺少所选 provider 密钥才自动进入 demo”，但当前代码对未知 `LINEAGE_MODEL_PROVIDER` 也进入 demo。生产配置拼写错误会被伪装为可用演示。修复前必须先明确产品决策；安全倾向是未知 provider fail closed，并增加 400/启动错误测试。

### PX-ARCH-005：协议多个事实源在 v2 前需要收敛

- 状态：candidate
- 证据等级：inferred
- 作用域：`lib/lineage-contracts.ts`、`schemas/**`、`components/lineage-studio.tsx`
- 触发条件：协议频繁变化、增加第二客户端或出现前后端解析差异
- 标签：`schema`、`codegen`、`drift`
- 最后验证：2026-07-22

当前规则同时存在于 TypeScript 类型、运行时解析器、独立 JSON Schema、模型提示和客户端重复类型/操作逻辑。正常 API 优先返回服务端已验证文档，尚未复现漂移故障；但 v2 前应选择 canonical Schema，生成类型与校验器，并只保留一份操作应用语义。

### PX-ARCH-006：网页模型中转必须保留产品自有提问入口

- 状态：candidate
- 证据等级：direct
- 作用域：`specs/conversation-source-and-credentials.md`、`tests/web-relay-policy.test.mjs`
- 触发条件：把网页端 AI 作为生成后端、复用浏览器扩展或降低 API 成本
- 标签：`browser-extension`、`generation-gateway`、`provider-policy`、`correlation`
- 最后验证：2026-07-26

Personal Hub 的浏览器扩展已经验证了版本化页面适配器、流式完成判断、结构化消息块、指纹去重、回环鉴权和服务端重验，相关 19 个测试通过；但它是“读取已有对话并提交采集批次”的单向采集器，没有输入框写入、发送、任务与回答关联或结果回送接口。

本产品不能让用户改为先在网页 AI 中提问。未来中转仍应从本产品的提问框创建 `jobId`，通过可替换 `GenerationGateway` 提交有界上下文，再按同一 job 取回回答并进入现有结构化装配。必须具备一次发送、明确的 user/assistant 关联、流式完成、超时恢复和幂等回收；不能按“网页最后一条回答”猜测归属。

当前自动向 ChatGPT 网页发送并提取输出受提供方条款约束，因此状态为 `blocked_by_provider_terms`，只保留接口与安全边界，不实现 DOM 自动化。将来只有官方授权能力或明确允许的网页提供方才能实现对应 adapter。当前 4 个策略测试只证明架构约束存在，不证明双向中转已可用。

## 10. 已废弃经验

暂无。

<div align="center">
  <p><strong>VISUALIZED EXP</strong></p>
  <h1>把复杂问题，展开成可以继续走下去的知识空间</h1>
  <p>
    一款本地优先的 AI 可视化解释工具。<br />
    看清概念关系，沿节点逐层探索，随时选中内容继续追问。
  </p>

  <p>
    <a href="https://github.com/lusblead/Visual-Exp/actions/workflows/ci.yml"><img src="https://github.com/lusblead/Visual-Exp/actions/workflows/ci.yml/badge.svg?branch=main" alt="CI" /></a>
    <img src="https://img.shields.io/badge/version-0.2.0-6C63FF" alt="Version 0.2.0" />
    <img src="https://img.shields.io/badge/Node.js-%E2%89%A522.13.0-339933?logo=nodedotjs&amp;logoColor=white" alt="Node.js 22.13.0 or newer" />
    <img src="https://img.shields.io/badge/platform-Windows-0078D4?logo=windows11&amp;logoColor=white" alt="Windows" />
    <a href="LICENSE"><img src="https://img.shields.io/github/license/lusblead/Visual-Exp?color=6C63FF" alt="MIT License" /></a>
  </p>

  <p>
    <a href="#quick-start"><strong>快速开始</strong></a>
    ·
    <a href="#first-use"><strong>首次配置</strong></a>
    ·
    <a href="#user-guide"><strong>使用指南</strong></a>
    ·
    <a href="https://github.com/lusblead/Visual-Exp/issues"><strong>反馈问题</strong></a>
  </p>
</div>

---

## 不再被一篇长回答困住

普通 AI 回答把所有信息一次性铺在你面前。Visualized Exp 先呈现当前层最重要的概念和关系，再由你决定下一步往哪里走。

<table>
  <tr>
    <td align="center" width="33%">
      <strong>01 · 提出问题</strong><br />
      <sub>输入想真正弄懂的复杂主题</sub>
    </td>
    <td align="center" width="33%">
      <strong>02 · 看清结构</strong><br />
      <sub>先获得概念总览与当前层解释</sub>
    </td>
    <td align="center" width="33%">
      <strong>03 · 自由深入</strong><br />
      <sub>进入节点、解释术语或选区追问</sub>
    </td>
  </tr>
</table>

## ✨ 你可以这样探索

<table>
  <tr>
    <td width="50%" valign="top">
      <strong>🧭 递归语义缩放</strong><br /><br />
      每次只聚焦当前层。点击感兴趣的节点进入下一层，不必在一张无限扩张的知识图里迷路。
    </td>
    <td width="50%" valign="top">
      <strong>🕸️ 可缩放概念总览</strong><br /><br />
      先看核心概念和它们的联系，再阅读正文；需要时可以打开大图查看关系。
    </td>
  </tr>
  <tr>
    <td width="50%" valign="top">
      <strong>💬 选中内容继续追问</strong><br /><br />
      选中一句话，直接“向 AI 提问”，或让系统围绕这段内容继续“深入”。
    </td>
    <td width="50%" valign="top">
      <strong>🔎 语境化术语解释</strong><br /><br />
      单击正文中标出的术语查看说明，双击则进入更完整的深入解释。
    </td>
  </tr>
  <tr>
    <td width="50%" valign="top">
      <strong>🌐 按需联网</strong><br /><br />
      主问题和每轮选区对话分别控制是否搜索；配置搜索服务不会自动把所有问题送去联网。
    </td>
    <td width="50%" valign="top">
      <strong>💾 本地知识记录</strong><br /><br />
      自动保存探索会话，随时恢复之前的内容，并可导出 Markdown 或 JSON。
    </td>
  </tr>
</table>

<a id="quick-start"></a>

## 🚀 快速开始

> [!IMPORTANT]
> 完整的一键本地体验目前面向 Windows，因为 API Key 会通过 Windows 凭据管理器保存在当前电脑上。

### 环境要求

| Node.js | Java | Maven | .NET SDK |
| :---: | :---: | :---: | :---: |
| 22.13.0+ | 17+ | 3.6.3+ | 10.0+ |

### 安装并启动

```powershell
git clone https://github.com/lusblead/Visual-Exp.git
cd Visual-Exp
npm install
npm run dev:local
```

启动完成后，打开 [http://localhost:3000](http://localhost:3000)。按 `Ctrl+C` 可以停止本次启动的所有本地服务。

<details>
<summary><strong>没有 API Key？先打开演示模式</strong></summary>

```powershell
npm install
$env:EXPLANATION_MODEL_PROVIDER = "demo"
npm run dev
```

演示模式不会调用真实模型，也不会启动完整本地后端，因此不包含持久化知识记录和选区 AI 对话。

</details>

<a id="first-use"></a>

## ⚙️ 首次配置

打开页面后，点击问题输入框右侧的设置按钮。

### 1. 连接默认 AI 服务

在“AI 服务”中填写 DeepSeek API Key，然后点击“保存到本机”。这个服务负责生成可视化解释和深入说明，也会作为选区 AI 对话的默认模型。

> [!NOTE]
> 保存模型或搜索配置时会执行一次最小验证请求，可能产生少量供应商用量。

### 2. 可选：更换选区对话模型

如果希望“向 AI 提问”使用其他模型，可在“模型覆盖（可选）”中添加并启用配置。模型覆盖只影响之后新建的选区 AI 对话，不会替换默认的可视化解释服务。

| 模型预设 | 支持方式 |
| --- | --- |
| OpenAI、DeepSeek、Kimi、GLM、Gemini、通义千问、OpenRouter | OpenAI Chat Completions 兼容接口 |
| Anthropic | Anthropic Messages 接口 |
| 自主设置 | 自定义地址、模型 ID 与认证方式 |

### 3. 可选：连接联网搜索

在“搜索服务”中配置 **Tavily** 或 **Brave Search**，并将它设为当前搜索服务。

- 主问题：开启“允许下一次主问题联网”。
- 选区对话：发送前为本轮选择“关闭”“自动”或“强制”。

仅保存搜索服务不会自动联网；是否联网仍由对应入口的开关决定。

<a id="user-guide"></a>

## 🧩 30 秒使用指南

| 目标 | 操作 |
| --- | --- |
| 创建解释 | 在顶部输入问题，按回车或点击 `↑` |
| 进入下一层 | 点击正文区块或区块右侧的 `→` |
| 前进或返回 | 使用页面左上角的 `‹` 和 `›` |
| 查看术语说明 | 单击正文中带标记的术语 |
| 深入理解术语 | 双击带标记的术语 |
| 追问一句话 | 选中正文，点击“向 AI 提问” |
| 深入选中内容 | 选中正文，点击“深入” |
| 恢复知识记录 | 打开右上角的知识记录面板并选择会话 |
| 导出当前内容 | 在知识记录面板选择 Markdown 或 JSON |

### 选择适合你的预生成方式

| 模式 | 适合场景 | 模型用量 |
| --- | --- | :---: |
| **省流** | 只在点击后生成下一层 | 较少 |
| **平衡** | 提前准备少量可能访问的内容 | 适中 |
| **深入** | 准备更多下一层内容，减少后续等待 | 较多 |

## 🔐 数据与 API Key

- 完整本地模式会把知识记录保存在当前电脑上。
- 默认 DeepSeek Key 保存在 Windows 凭据管理器中，不需要写入项目文件。
- 模型和搜索服务的 Key 保存后不会在页面中回显。
- 不要把 API Key 写入代码、提交到 Git，或添加到任何以 `NEXT_PUBLIC_` 开头的变量中。

<details>
<summary><strong>端口被占用</strong></summary>

可以为网页和后端指定其他端口：

```powershell
$env:PORT = "3001"
$env:BACKEND_PORT = "18080"
npm run dev:local
```

然后访问 [http://localhost:3001](http://localhost:3001)。

</details>

<details>
<summary><strong><code>npm run dev:local</code> 启动失败</strong></summary>

先确认依赖都可以从终端执行：

```powershell
node --version
java -version
mvn -version
dotnet --version
```

如果某条命令不存在，请安装对应依赖并重新打开终端。首次启动还需要能够访问 npm、Maven 和 NuGet 的依赖下载服务。

</details>

<details>
<summary><strong>页面可以打开，但无法生成真实解释</strong></summary>

- 确认不是以 `demo` 模式启动。
- 打开设置，确认 DeepSeek Key 已验证并保存。
- 如果刚替换 Key，请重新提交问题。

</details>

<details>
<summary><strong>已经配置搜索服务，但回答没有联网</strong></summary>

请同时确认：

- Tavily 或 Brave Search 已验证并设为当前服务；
- 主问题的“允许下一次主问题联网”已开启，或选区对话本轮选择了“自动”或“强制”。

</details>

## 🤝 参与项目

| | |
| --- | --- |
| 🧾 [查看版本记录](CHANGELOG.md) | 🛠️ [阅读贡献指南](CONTRIBUTING.md) |
| 🐞 [提交问题](https://github.com/lusblead/Visual-Exp/issues) | 🔒 [私下报告安全问题](SECURITY.md) |

Visualized Exp 当前定位为本地优先、单用户应用，暂不提供可直接公开运营的多用户 SaaS 部署方案。

---

<div align="center">
  <p>如果 Visualized Exp 对你有帮助，欢迎点一个 Star 或分享你的使用反馈。</p>
  <p><sub>Local-first · Single-user · MIT License</sub></p>
</div>

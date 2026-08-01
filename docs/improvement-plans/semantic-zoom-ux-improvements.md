# 语义缩放 UX 改进设计方案

> **目标读者**：执行开发的 AI / 开发者
> **范围**：4 项改动，互不依赖，可独立实施
> **原则**：每一项改动都给出精确的文件路径、当前代码位置、改动步骤、以及完整的新代码

---

## 目录

1. [改动一：修复频繁切换挡位导致报错](#1-改动一修复频繁切换挡位导致报错)
2. [改动二：联网开关移至搜索服务配置区](#2-改动二联网开关移至搜索服务配置区)
3. [改动三：开头增加 Mermaid 概念图](#3-改动三开头增加-mermaid-概念图)
4. [改动四：模型设置界面重新设计 + 新增 Kimi/GLM 供应商](#4-改动四模型设置界面重新设计--新增-kimiglm-供应商)

---

## 1. 改动一：修复频繁切换挡位导致报错

### 问题分析

**文件**：`components/lineage-studio.tsx`

**当前代码位置**：第 1185-1192 行

```typescript
function changePrefetchProfile(profile: PregenerationProfile) {
  if (profile === prefetchProfile) return;
  scenePrefetchAbort.current?.abort();
  termPrefetchAbort.current?.abort();
  setPrefetchProfile(profile);
  setBackgroundRestart((restart) => restart + 1);
  setTermPrefetchRestart((restart) => restart + 1);
}
```

**根因**：
- `changePrefetchProfile` 被调用时立即 abort 所有进行中的后台请求，并通过 `setBackgroundRestart` 和 `setTermPrefetchRestart` 触发新的 useEffect 重新执行预取逻辑
- 如果用户在短时间内多次切换挡位（例如快速点击不同的预取策略按钮），会发生以下竞态：
  1. 第一次切换：abort 旧请求 → 设置新 profile → 触发 effect
  2. 第二次切换（effect 尚未执行）：再次 abort → 设置另一个 profile → 又触发 effect
  3. 多个 effect 可能交错执行，旧 effect 中的异步请求可能在新状态设置后才返回，导致 `visualDocumentRef.current` 版本检查失败，产生 `discarded` 错误
- 此外，频繁 abort + 重建 AbortController 可能在某些边界情况下导致未捕获的 abort 错误冒泡到 UI

### 修复方案

引入 **防抖（debounce）** 机制，确保在用户连续点击时只执行最后一次切换。

#### 步骤 1：添加 debounce ref

在 `components/lineage-studio.tsx` 中，找到所有 `useRef` 声明区域（约第 172-205 行），在 `pendingQuestion` 之后添加：

```typescript
const prefetchProfileDebounce = useRef<ReturnType<typeof setTimeout> | null>(null);
```

#### 步骤 2：替换 `changePrefetchProfile` 函数

将第 1185-1192 行的 `changePrefetchProfile` 函数替换为：

```typescript
function changePrefetchProfile(profile: PregenerationProfile) {
  if (profile === prefetchProfile) return;

  // 清除上一次未执行的防抖定时器
  if (prefetchProfileDebounce.current !== null) {
    clearTimeout(prefetchProfileDebounce.current);
  }

  // 立即 abort 进行中的请求，避免浪费资源
  scenePrefetchAbort.current?.abort();
  termPrefetchAbort.current?.abort();

  // 设置新的 profile（立即更新 UI 反馈）
  setPrefetchProfile(profile);

  // 防抖：等待 300ms 无新切换后再触发后台重启
  prefetchProfileDebounce.current = setTimeout(() => {
    prefetchProfileDebounce.current = null;
    setBackgroundRestart((restart) => restart + 1);
    setTermPrefetchRestart((restart) => restart + 1);
  }, 300);
}
```

#### 步骤 3：在 cleanup effect 中清理定时器

找到 cleanup effect（约第 428-437 行），在返回的清理函数中添加定时器清理：

```typescript
useEffect(
  () => () => {
    documentAbort.current?.abort();
    scenePrefetchAbort.current?.abort();
    abortAllTermJobs();
    termPrefetchAbort.current?.abort();
    abortAllDeepJobs();
    // 新增：清理挡位切换防抖定时器
    if (prefetchProfileDebounce.current !== null) {
      clearTimeout(prefetchProfileDebounce.current);
      prefetchProfileDebounce.current = null;
    }
  },
  [abortAllDeepJobs, abortAllTermJobs],
);
```

#### 步骤 4（可选但推荐）：增加切换中的视觉反馈

在 `knowledge-session-controls.tsx` 中，如果当前有防抖等待中的切换，给按钮一个短暂的 loading 或 disabled 状态。但考虑到 `prefetchProfileDebounce` 是 `lineage-studio.tsx` 内部的 ref，最简单的做法是：

在 `KnowledgeSessionControls` 的 props 中新增一个可选属性：

```typescript
profileChanging?: boolean;
```

在 `lineage-studio.tsx` 中新增一个 state：

```typescript
const [profileChanging, setProfileChanging] = useState(false);
```

在 `changePrefetchProfile` 的防抖逻辑中：

```typescript
setProfileChanging(true);
// ... 在 setTimeout 回调中
setProfileChanging(false);
```

然后将 `profileChanging` 传给 `KnowledgeSessionControls`，在对应按钮上显示短暂的过渡状态。

### 涉及文件清单

| 文件 | 改动类型 |
|------|----------|
| `components/lineage-studio.tsx` | 主要改动：添加防抖 ref、替换函数、清理定时器 |
| `components/knowledge-session-controls.tsx` | 可选：添加 `profileChanging` prop 用于视觉反馈 |

---

## 2. 改动二：联网开关移至搜索服务配置区

### 问题分析

**当前状态**：
- 联网搜索开关（`question-search-toggle`）位于 `QuestionComposer` 组件中（`components/lineage-header.tsx` 第 47-61 行），在主输入框旁边
- 搜索服务配置（Tavily / Brave Search 的 API Key）位于 `ProviderSettingsPanel` 组件中（`components/provider-settings-panel.tsx`），在 `ModelSettingsDialog` 弹窗的"搜索服务"标签页内
- 两者在 UI 上完全分离，用户可能开启了联网开关但没有配置搜索服务，导致联网功能不可用

**用户需求**：
- 联网开关应该和搜索服务配置放在一起
- 没有使用搜索服务的人不应该被联网开关影响
- 联网能力取决于是否配置了搜索服务

### 设计思路

**核心逻辑**：
- 联网的总开关从 `QuestionComposer` 移除
- 联网开关移到 `ModelSettingsDialog` → `ProviderSettingsPanel` 的"搜索服务"标签页中
- 联网开关只有在至少配置了一个搜索服务时才可用
- `createExplanation` 中 `searchMode` 的默认值取决于全局联网开关状态
- 选中文本后的 AI 对话（`SelectionChatPanel`）中每轮的联网选项保持不变（那是逐轮的局部选择）

**全局联网状态**：新增一个简单的状态管理——可以通过 React context 或者直接在 `lineage-studio.tsx` 中维护并通过 props 传递。

### 实施方案

#### 步骤 1：从 `QuestionComposer` 中移除联网按钮

**文件**：`components/lineage-header.tsx`

移除以下内容：
- Props 中的 `searchEnabled`、`modelConfigured`、`onSearchEnabledChange`
- JSX 中的 `question-search-toggle` 按钮（第 47-61 行）

修改后的 `QuestionComposer` 签名：

```typescript
export function QuestionComposer({
  question,
  started,
  busy,
  modelConfigured,
  modelStatusBusy,
  onQuestionChange,
  onCreate,
  onOpenModelSettings,
}: {
  question: string;
  started: boolean;
  busy: boolean;
  modelConfigured: boolean;
  modelStatusBusy: boolean;
  onQuestionChange: (value: string) => void;
  onCreate: () => void;
  onOpenModelSettings: () => void;
})
```

修改后的 JSX（移除联网按钮，保留其他按钮不变）：

```tsx
<header className={`question-shell ${started ? "is-docked" : "is-centered"}`}>
  <form className="question-composer" onSubmit={handleSubmit}>
    <label className="sr-only" htmlFor="visual-question">
      请输入你的问题
    </label>
    <input
      id="visual-question"
      value={question}
      onChange={(event) => onQuestionChange(event.target.value)}
      maxLength={1200}
      placeholder="请输入你的问题"
      autoComplete="off"
      autoFocus
    />
    <button
      type="button"
      className="question-settings"
      onClick={onOpenModelSettings}
      aria-label="模型与 API Key 设置"
      title="DeepSeek V4 Pro"
    >
      <svg aria-hidden="true" viewBox="0 0 24 24">
        <path d="M4 7h10M18 7h2M4 17h2M10 17h10M14 4v6M7 14v6" />
      </svg>
      <span
        className={`question-model-dot ${modelConfigured ? "is-configured" : ""} ${
          modelStatusBusy ? "is-loading" : ""
        }`}
        aria-hidden="true"
      />
    </button>
    <button
      type="submit"
      className="question-submit"
      disabled={busy || !question.trim()}
      aria-label={busy ? "正在生成视觉解释" : "生成视觉解释"}
    >
      <span aria-hidden="true">{busy ? "·" : "↑"}</span>
    </button>
  </form>
</header>
```

同时在 `components/lineage-header.tsx` 中移除 `import type { FormEvent } from "react";` 中不需要的内容（保留 FormEvent）。

#### 步骤 2：在 `ProviderSettingsPanel` 的搜索服务标签页中添加联网总开关

**文件**：`components/provider-settings-panel.tsx`

新增 props：

```typescript
export function ProviderSettingsPanel({
  defaultChatAvailable,
  webSearchEnabled,
  onWebSearchEnabledChange,
  hasSearchProvider,
}: {
  defaultChatAvailable: boolean;
  webSearchEnabled: boolean;
  onWebSearchEnabledChange: (enabled: boolean) => void;
  hasSearchProvider: boolean;
})
```

在"搜索服务"标签页（`draft.kind === "search"` 时）的已配置列表上方，添加联网总开关区域。

找到 `<section className="provider-profile-section">` 中的 `<div className="provider-section-title">` 下方的 `<h4>` 区域，在搜索服务标签下插入：

```tsx
{/* 仅在搜索服务标签页显示联网总开关 */}
{draft.kind === "search" ? (
  <div className="web-search-global-toggle">
    <div className="web-search-global-info">
      <span className="web-search-global-label">全局联网搜索</span>
      <p className="web-search-global-desc">
        {hasSearchProvider
          ? "开启后，新建主问题时会默认启用联网搜索。每轮 AI 对话仍可单独控制联网。"
          : "需要先配置至少一个搜索服务，才能开启联网搜索。"}
      </p>
    </div>
    <button
      type="button"
      className={`web-search-global-switch ${webSearchEnabled ? "is-on" : ""}`}
      role="switch"
      aria-checked={webSearchEnabled}
      aria-label={webSearchEnabled ? "关闭全局联网搜索" : "开启全局联网搜索"}
      onClick={() => onWebSearchEnabledChange(!webSearchEnabled)}
      disabled={!hasSearchProvider || Boolean(action)}
    >
      <span className="web-search-global-track">
        <span className="web-search-global-thumb" />
      </span>
    </button>
  </div>
) : null}
```

#### 步骤 3：在 `ModelSettingsDialog` 中传递联网状态 props

**文件**：`components/model-settings-dialog.tsx`

新增 props：

```typescript
export function ModelSettingsDialog({
  open,
  status,
  busy,
  error,
  onClose,
  onSave,
  onDelete,
  webSearchEnabled,
  onWebSearchEnabledChange,
  hasSearchProvider,
}: {
  open: boolean;
  status: ModelSettingsStatus | null;
  busy: boolean;
  error: string | null;
  onClose: () => void;
  onSave: (apiKey: string) => Promise<boolean>;
  onDelete: () => Promise<void>;
  webSearchEnabled: boolean;
  onWebSearchEnabledChange: (enabled: boolean) => void;
  hasSearchProvider: boolean;
})
```

在渲染 `ProviderSettingsPanel` 处（第 171-176 行），传递新增的 props：

```tsx
{open ? (
  <ProviderSettingsPanel
    defaultChatAvailable={Boolean(
      status?.configured && status.companionAvailable,
    )}
    webSearchEnabled={webSearchEnabled}
    onWebSearchEnabledChange={onWebSearchEnabledChange}
    hasSearchProvider={hasSearchProvider}
  />
) : null}
```

#### 步骤 4：在 `LineageStudio` 中管理全局联网状态

**文件**：`components/lineage-studio.tsx`

4a. 将现有的 `createSearchEnabled` state 重新定义为"全局联网搜索开关"，其默认值改为 `false`（第 131 行不变）。

4b. 新增一个派生状态来判断是否配置了搜索服务。考虑到 `ProviderSettingsPanel` 在 dialog 内部加载 providers 列表，我们需要在 `LineageStudio` 层面也获取一次搜索服务列表。

在 `lineage-studio.tsx` 顶部添加 import：

```typescript
import { listProviders, type ProviderSummary } from "../lib/provider-settings";
```

新增 state（约在第 131 行附近）：

```typescript
const [searchProviders, setSearchProviders] = useState<ProviderSummary[]>([]);
```

新增 effect 来加载搜索服务列表（在 `refreshModelStatus` 附近或 `useEffect` 中）：

```typescript
const hasSearchProvider = searchProviders.some(
  (p) => p.kind === "search" && p.configured
);
```

在 `openModelSettings` 函数中，同时刷新搜索服务列表：

```typescript
function openModelSettings() {
  setModelSettingsError(null);
  setModelSettingsOpen(true);
  void refreshModelStatus();
  // 同时加载搜索服务列表
  void listProviders().then(setSearchProviders).catch(() => {});
}
```

4c. `createExplanation` 函数中（第 1245 行），搜索模式逻辑改为：如果全局联网开关开启 **且** 有搜索服务，则使用 `"on"`，否则使用 `"off"`。

找到第 1252-1253 行：

```typescript
const requestedSearchMode =
  searchModeOverride ?? (createSearchEnabled ? "on" : "off");
```

改为：

```typescript
const requestedSearchMode =
  searchModeOverride ?? (createSearchEnabled && hasSearchProvider ? "on" : "off");
```

4d. 将新增 props 传递给 `ModelSettingsDialog`。找到第 2251-2263 行的 `<ModelSettingsDialog>` 渲染：

```tsx
<ModelSettingsDialog
  open={modelSettingsOpen}
  status={modelStatus}
  busy={modelStatusBusy}
  error={modelSettingsError}
  onClose={() => {
    setModelSettingsOpen(false);
    setModelSettingsError(null);
    pendingQuestion.current = null;
  }}
  onSave={saveModelCredential}
  onDelete={deleteModelCredential}
  webSearchEnabled={createSearchEnabled}
  onWebSearchEnabledChange={setCreateSearchEnabled}
  hasSearchProvider={hasSearchProvider}
/>
```

4e. 更新 `QuestionComposer` 的调用，移除已删除的 props。找到第 2156-2167 行：

```tsx
<QuestionComposer
  question={question}
  started={started}
  busy={isCreating || !hydrationReady}
  modelConfigured={Boolean(modelStatus?.configured)}
  modelStatusBusy={modelStatusBusy}
  onQuestionChange={setQuestion}
  onCreate={() => void createExplanation()}
  onOpenModelSettings={openModelSettings}
/>
```

（移除了 `searchEnabled={createSearchEnabled}` 和 `onSearchEnabledChange={setCreateSearchEnabled}`）

#### 步骤 5：添加 CSS 样式

**文件**：`app/styles/workspace.css`

在文件末尾添加联网总开关的样式：

```css
/* ---- 全局联网搜索开关 ---- */

.web-search-global-toggle {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  padding: 14px 16px;
  margin-bottom: 14px;
  border: 1px solid var(--line);
  border-radius: 14px;
  background: rgba(255, 255, 255, 0.65);
}

.web-search-global-label {
  font-size: 13px;
  font-weight: 650;
  color: var(--ink);
}

.web-search-global-desc {
  margin: 4px 0 0;
  max-width: 42ch;
  color: var(--ink-faint);
  font-size: 11px;
  line-height: 1.55;
}

.web-search-global-switch {
  flex: 0 0 auto;
  padding: 0;
  border: 0;
  background: none;
  cursor: pointer;
}

.web-search-global-switch:disabled {
  opacity: 0.38;
  cursor: not-allowed;
}

.web-search-global-track {
  display: block;
  width: 44px;
  height: 24px;
  border-radius: 999px;
  background: var(--ink-faint);
  transition: background 200ms ease;
  position: relative;
}

.web-search-global-switch.is-on .web-search-global-track {
  background: #2c9b62;
}

.web-search-global-thumb {
  position: absolute;
  top: 3px;
  left: 3px;
  width: 18px;
  height: 18px;
  border-radius: 50%;
  background: white;
  box-shadow: 0 1px 4px rgba(0,0,0,0.14);
  transition: transform 200ms cubic-bezier(0.22, 0.8, 0.22, 1);
}

.web-search-global-switch.is-on .web-search-global-thumb {
  transform: translateX(20px);
}
```

#### 步骤 6：清理 workspace.css 中不再需要的联网按钮样式

**文件**：`app/styles/workspace.css`

可以保留 `.question-search-toggle` 和 `.question-search-indicator` 的样式（不影响功能），或标记为废弃但暂不删除以避免 CSS 断裂。

### 涉及文件清单

| 文件 | 改动类型 |
|------|----------|
| `components/lineage-header.tsx` | 移除联网按钮及其 props |
| `components/provider-settings-panel.tsx` | 新增全局联网开关 UI + props |
| `components/model-settings-dialog.tsx` | 透传联网开关 props |
| `components/lineage-studio.tsx` | 管理全局联网状态、加载搜索服务列表 |
| `app/styles/workspace.css` | 新增开关样式 |

---

## 3. 改动三：开头增加 Mermaid 概念图

### 需求说明

在用户尚未开始探索（`started === false`，即 idle 状态）时，在问题输入框下方展示一个 Mermaid 流程图，直观讲解：
- 用户输入问题 → 生成根节点
- 根节点展开为多个子节点
- 子节点之间的关系（顺序、对比、因果等）
- 点击子节点可以继续深入
- 名词解释、深入理解、AI 对话等功能的位置

这个图用来替代纯文字说明，让新用户一眼就能理解整个工具的运作方式。

### 实施方案

#### 步骤 1：安装 Mermaid

在项目根目录运行：

```bash
npm install mermaid
```

> **注意**：Mermaid 在 v10+ 版本对 ESM/CJS 兼容性做了一些调整。如果项目使用 Next.js，推荐安装 `mermaid@10` 以确保 SSR 兼容。

#### 步骤 2：创建 Mermaid 概念图组件

**新建文件**：`components/concept-diagram.tsx`

```typescript
"use client";

import { useEffect, useRef, useState } from "react";

// Mermaid 图表定义
const CONCEPT_MERMAID = `
graph TD
  Q["🔍 你输入的问题"]
  Q --> ROOT["📋 根节点<br/>AI 将问题拆解为<br/>核心概念"]

  ROOT --> CH1["🧩 子节点 A"]
  ROOT --> CH2["🧩 子节点 B"]
  ROOT --> CH3["🧩 子节点 C"]

  CH1 --> CH1A["📖 深入层 A-1"]
  CH2 --> CH2A["📖 深入层 B-1"]
  CH3 --> CH3A["📖 深入层 C-1"]

  CH1A --> CH1A1["🔬 更深层..."]
  CH2A --> CH2A1["🔬 更深层..."]

  CH1 -.->|"顺序 / 因果 / 对比"| CH2
  CH2 -.->|"组成 / 支撑"| CH3

  subgraph LEGEND["图例"]
    L1["🟢 节点 = 一个知识单元"]
    L2["🔵 点击节点 = 进入下一层"]
    L3["🟡 选中文字 = 名词解释 / AI 追问"]
    L4["🟣 深入理解 = 展开某个概念"]
  end

  style Q fill:#e8f0fe,stroke:#4a7cd8,stroke-width:2px,color:#1a3a6b
  style ROOT fill:#e6f7ed,stroke:#2c9b62,stroke-width:2px,color:#0d3d22
  style CH1 fill:#fff8e6,stroke:#e6a817,stroke-width:2px,color:#5c3d0a
  style CH2 fill:#fff8e6,stroke:#e6a817,stroke-width:2px,color:#5c3d0a
  style CH3 fill:#fff8e6,stroke:#e6a817,stroke-width:2px,color:#5c3d0a
  style CH1A fill:#f3e8ff,stroke:#7c3aed,stroke-width:2px,color:#2d0a5c
  style CH2A fill:#f3e8ff,stroke:#7c3aed,stroke-width:2px,color:#2d0a5c
  style CH3A fill:#f3e8ff,stroke:#7c3aed,stroke-width:2px,color:#2d0a5c
  style CH1A1 fill:#fce4ec,stroke:#c62828,stroke-width:1px,color:#4a0a0a
  style CH2A1 fill:#fce4ec,stroke:#c62828,stroke-width:1px,color:#4a0a0a
  style LEGEND fill:#f5f5f5,stroke:#9e9e9e,stroke-width:1px,color:#424242
  style L1 fill:#f5f5f5,stroke:none,color:#424242
  style L2 fill:#f5f5f5,stroke:none,color:#424242
  style L3 fill:#f5f5f5,stroke:none,color:#424242
  style L4 fill:#f5f5f5,stroke:none,color:#424242
`;

export function ConceptDiagram() {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [error, setError] = useState<string | null>(null);
  const renderedRef = useRef(false);

  useEffect(() => {
    if (renderedRef.current) return;
    const container = containerRef.current;
    if (!container) return;

    let cancelled = false;

    import("mermaid").then(
      (mermaid) => {
        if (cancelled) return;
        mermaid.default.initialize({
          startOnLoad: false,
          theme: "base",
          themeVariables: {
            primaryColor: "#e6f7ed",
            primaryTextColor: "#1a2e1f",
            primaryBorderColor: "#2c9b62",
            lineColor: "#8c9e97",
            secondaryColor: "#f5f5f5",
            tertiaryColor: "#fff8e6",
            fontSize: "13px",
            fontFamily: "system-ui, -apple-system, sans-serif",
          },
          flowchart: {
            useMaxWidth: true,
            htmlLabels: true,
            curve: "basis",
            padding: 20,
            nodeSpacing: 50,
            rankSpacing: 60,
          },
        });

        // 使用随机 ID 避免重复渲染问题
        const id = `mermaid-concept-${Math.random().toString(36).slice(2, 10)}`;
        mermaid.default
          .render(id, CONCEPT_MERMAID)
          .then(({ svg }) => {
            if (cancelled) return;
            container.innerHTML = svg;
            renderedRef.current = true;
          })
          .catch((err: unknown) => {
            if (cancelled) return;
            setError(err instanceof Error ? err.message : "图表渲染失败");
          });
      },
      (err) => {
        if (!cancelled) {
          setError(
            err instanceof Error
              ? `图表库加载失败：${err.message}`
              : "图表库加载失败"
          );
        }
      }
    );

    return () => {
      cancelled = true;
    };
  }, []);

  if (error) {
    return (
      <div className="concept-diagram-error" role="alert">
        <p>概念图暂时不可用</p>
        <small>{error}</small>
      </div>
    );
  }

  return (
    <div className="concept-diagram" aria-label="语义缩放概念图">
      <div className="concept-diagram-heading">
        <h2>探索流程一览</h2>
        <p>
          AI 将你的问题分解为层层递进的知识节点。
          点击任意节点进入下一层，选中文字获取名词解释或追问 AI。
        </p>
      </div>
      <div ref={containerRef} className="concept-diagram-svg" />
    </div>
  );
}
```

#### 步骤 3：在 `LineageStudio` 中嵌入概念图

**文件**：`components/lineage-studio.tsx`

在文件顶部添加 import：

```typescript
import { ConceptDiagram } from "./concept-diagram";
```

找到 idle 状态的渲染区域。当前在 `{!started && error ? (...)}` 之前没有展示内容。在 `return` 的 JSX 中，`QuestionComposer` 之后、`{started ? (...)}` 之前，添加概念图。

具体来说，在 `<QuestionComposer ... />` 之后，添加：

```tsx
{!started && !isCreating ? (
  <ConceptDiagram />
) : null}
```

完整上下文（约第 2156-2190 行之间）：

```tsx
<QuestionComposer
  question={question}
  started={started}
  busy={isCreating || !hydrationReady}
  modelConfigured={Boolean(modelStatus?.configured)}
  modelStatusBusy={modelStatusBusy}
  onQuestionChange={setQuestion}
  onCreate={() => void createExplanation()}
  onOpenModelSettings={openModelSettings}
/>

{/* 新增：idle 状态下的概念图 */}
{!started && !isCreating ? (
  <ConceptDiagram />
) : null}

<HistoryControls ... />
```

#### 步骤 4：添加概念图 CSS 样式

**文件**：`app/styles/workspace.css`

在文件末尾添加：

```css
/* ---- 概念图（idle 状态） ---- */

.concept-diagram {
  width: min(860px, calc(100vw - 40px));
  margin: 140px auto 40px;
  padding: 28px 32px;
  border: 1px solid var(--line);
  border-radius: 22px;
  background: rgba(255, 255, 255, 0.62);
  backdrop-filter: blur(14px);
  animation: concept-fade-in 500ms cubic-bezier(0.22, 0.8, 0.22, 1) both;
}

@keyframes concept-fade-in {
  from {
    opacity: 0;
    transform: translateY(14px);
  }
}

.concept-diagram-heading {
  text-align: center;
  margin-bottom: 24px;
}

.concept-diagram-heading h2 {
  margin: 0;
  font-size: 20px;
  letter-spacing: -0.025em;
  color: var(--ink);
}

.concept-diagram-heading p {
  margin: 6px 0 0;
  max-width: 54ch;
  margin-left: auto;
  margin-right: auto;
  color: var(--ink-soft);
  font-size: 13px;
  line-height: 1.6;
}

.concept-diagram-svg {
  overflow-x: auto;
  display: flex;
  justify-content: center;
}

.concept-diagram-svg svg {
  max-width: 100%;
  height: auto;
}

.concept-diagram-error {
  width: min(460px, calc(100vw - 40px));
  margin: 100px auto 0;
  padding: 20px 24px;
  border: 1px solid color-mix(in srgb, var(--danger) 30%, var(--line));
  border-radius: 16px;
  background: rgba(169, 67, 67, 0.05);
  text-align: center;
}

.concept-diagram-error p {
  margin: 0;
  color: var(--danger);
  font-size: 13px;
  font-weight: 650;
}

.concept-diagram-error small {
  display: block;
  margin-top: 6px;
  color: var(--ink-faint);
  font-size: 11px;
}

/* idle 状态布局微调 */
.visual-app.is-idle .question-shell.is-centered {
  top: 18%;
}

.visual-app.is-idle .concept-diagram {
  margin-top: calc(18% + 100px);
}
```

### 涉及文件清单

| 文件 | 改动类型 |
|------|----------|
| `components/concept-diagram.tsx` | **新建**：概念图组件 |
| `components/lineage-studio.tsx` | 导入并嵌入概念图组件 |
| `app/styles/workspace.css` | 新增概念图相关样式 |
| `package.json` | 新增 `mermaid` 依赖 |

---

## 4. 改动四：模型设置界面重新设计 + 新增 Kimi/GLM 供应商

### 需求说明

1. **布局调整**：
   - "已配置的模型覆盖"列表应缩小宽度，靠左放置
   - "添加模型覆盖"编辑区应占更大空间，足够一目了然
   - 整体使用方角（`border-radius: 0` 或极小值如 `4px`）替代现有的大量圆角（`21px`、`16px`、`14px` 等），显得干净利落

2. **新增供应商**：
   - **Kimi**（月之暗面 Moonshot AI）：Chat Completions 兼容，`https://api.moonshot.cn/v1`，默认模型 `moonshot-v1-auto`，认证方式 Bearer
   - **GLM**（智谱 AI）：Chat Completions 兼容，`https://open.bigmodel.cn/api/paas/v4`，默认模型 `glm-4.6`，认证方式 Bearer

### 实施方案

#### 步骤 1：在 Provider 类型定义中新增 Kimi 和 GLM

**文件**：`lib/provider-settings.ts`

1a. 扩展 `ModelProviderId` 类型（第 2-10 行）：

```typescript
export type ModelProviderId =
  | "openai"
  | "anthropic"
  | "deepseek"
  | "gemini"
  | "qwen"
  | "kimi"       // 新增
  | "glm"        // 新增
  | "openrouter"
  | "custom_openai_compatible";
```

1b. 在 `PROVIDER_PRESETS` 数组中，在 `qwen` 之后、`openrouter` 之前，添加两个新的预设：

```typescript
{
  id: "kimi",
  kind: "model",
  label: "Kimi",
  description: "月之暗面 Moonshot AI · Chat Completions + Bearer",
  baseUrl: "https://api.moonshot.cn/v1",
  defaultModel: "moonshot-v1-auto",
  apiFormat: "openai_chat_completions",
  endpointMode: "base_url",
  authType: "bearer",
  authHeader: null,
  modelSuggestions: [
    "moonshot-v1-auto",
    "moonshot-v1-8k",
    "moonshot-v1-32k",
    "moonshot-v1-128k",
  ],
},
{
  id: "glm",
  kind: "model",
  label: "GLM",
  description: "智谱 AI · Chat Completions + Bearer",
  baseUrl: "https://open.bigmodel.cn/api/paas/v4",
  defaultModel: "glm-4.6",
  apiFormat: "openai_chat_completions",
  endpointMode: "base_url",
  authType: "bearer",
  authHeader: null,
  modelSuggestions: [
    "glm-4.6",
    "glm-4.5",
    "glm-4-plus",
    "glm-4-flash",
    "glm-4-air",
  ],
},
```

1c. 在 `parseProviderSummary` 函数中的 provider 枚举验证里，添加 `"kimi"` 和 `"glm"`。找到第 480-491 行的 `readEnum` 调用：

```typescript
const provider = readEnum(value.provider, [
  "openai",
  "anthropic",
  "deepseek",
  "gemini",
  "qwen",
  "kimi",      // 新增
  "glm",       // 新增
  "openrouter",
  "custom_openai_compatible",
  "tavily",
  "brave",
] as const);
```

#### 步骤 2：调整 ProviderSettingsPanel 布局

**文件**：`components/provider-settings-panel.tsx`

当前布局通过 `provider-settings-grid` 使用 `grid-template-columns: minmax(250px, 0.86fr) minmax(0, 1.14fr)`。需要调整为左侧更窄、右侧更大的比例。

**不需要修改 TSX 结构**，只需要通过 CSS 调整。但有一些细节：

- 将"已配置的模型覆盖"区域的最大高度限制放宽，或使其完整展示
- 编辑区的高度应该更大

#### 步骤 3：CSS 全面改造——方角风格

**文件**：`app/styles/workspace.css`

这是本次改动中工作量最大的部分。需要系统地替换模型设置对话框中所有圆角为方角。

将以下 CSS 规则分组修改：

**3a. Dialog 容器**（约第 467-477 行）：

```css
.model-settings-dialog {
  width: min(900px, calc(100vw - 32px));
  max-height: calc(100dvh - 32px);
  padding: 36px;
  overflow: auto;
  border: 0;
  border-radius: 0;           /* 方角 */
  color: var(--ink);
  background: #fcfdfc;
  box-shadow: 0 34px 110px rgba(18, 24, 20, 0.24);
}
```

**3b. 关闭按钮**（约第 484-498 行）：

```css
.settings-close {
  position: absolute;
  top: 12px;
  right: 12px;
  width: 44px;
  height: 44px;
  border-radius: 0;           /* 方角 */
  background: transparent;
  color: var(--ink-soft);
  font-size: 20px;
}
```

**3c. model-identity 区域**：保持不变（无特殊圆角需要改）。

**3d. 设置说明 scope 边框**（约第 554-563 行）：

```css
.settings-model-scope {
  padding: 11px 13px;
  margin: 22px 0 0;
  border-left: 3px solid color-mix(in srgb, var(--accent) 54%, var(--line));
  border-radius: 0;           /* 方角 */
  color: var(--ink-soft);
  background: var(--accent-soft);
  font-size: 12px;
  line-height: 1.6;
}
```

**3e. API Key 输入区**（约第 576-581 行）：

```css
.credential-input {
  display: flex;
  min-width: 0;
  padding: 5px;
  border-radius: 0;           /* 方角 */
  background: var(--canvas-deep);
}
```

**3f. API Key 输入按钮**（约第 598-609 行）：

```css
.credential-input button {
  min-width: 52px;
  padding: 0 10px;
  border-radius: 0;           /* 方角 */
  background: transparent;
  color: var(--ink-soft);
  font-size: 12px;
}
```

**3g. 操作按钮**（约第 626-648 行）：

```css
.settings-actions button {
  min-height: 44px;
  padding: 0 17px;
  border-radius: 0;           /* 方角 */
}

.credential-save {
  background: var(--ink);
  color: white;
}
```

**3h. Provider 设置网格布局**（约第 745-759 行）——**核心布局改动**：

```css
.provider-settings-grid {
  display: grid;
  /* 左侧已配置列表更窄，右侧编辑区更大 */
  grid-template-columns: minmax(220px, 0.65fr) minmax(0, 1.35fr);
  gap: 16px;
  margin-top: 18px;
}

.provider-profile-section,
.provider-editor {
  min-width: 0;
  padding: 20px;
  border: 1px solid var(--line);
  border-radius: 0;           /* 方角 */
  background: rgba(255, 255, 255, 0.5);
}
```

**3i. Provider 列表项**（约第 840-852 行）：

```css
.provider-profile-list li {
  position: relative;
  padding: 14px;
  overflow: hidden;
  border: 1px solid var(--line);
  border-radius: 0;           /* 方角 */
  background: rgba(255, 255, 255, 0.72);
}
```

**3j. Provider 编辑区输入框**（约第 1040-1053 行）：

```css
.provider-editor input:not([type="checkbox"]),
.provider-editor select {
  width: 100%;
  min-width: 0;
  height: 42px;
  padding: 0 11px;
  border: 1px solid transparent;
  border-radius: 0;           /* 方角 */
  outline: 0;
  color: var(--ink);
  background: var(--canvas-deep);
  font: inherit;
  font-size: 12px;
}
```

**3k. Provider 预设选择按钮**（约第 1012-1033 行）：

```css
.provider-preset-picker button {
  min-height: 31px;
  padding: 0 10px;
  border: 1px solid transparent;
  border-radius: 0;           /* 方角 */
  color: var(--ink-soft);
  background: var(--canvas-deep);
  font-size: 10px;
  font-weight: 650;
}
```

**3l. Provider 种类标签**（约第 720-743 行）：

```css
.provider-kind-tabs {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 4px;
  padding: 4px;
  margin-top: 22px;
  border-radius: 0;           /* 方角 */
  background: var(--canvas-deep);
}

.provider-kind-tabs button {
  min-height: 40px;
  border-radius: 0;           /* 方角 */
  color: var(--ink-soft);
  background: transparent;
  font-size: 13px;
  font-weight: 650;
}
```

**3m. 统计小标签**（约第 703-718 行）：

```css
.provider-settings-counts span {
  min-width: 62px;
  padding: 9px 10px;
  border: 1px solid var(--line);
  border-radius: 0;           /* 方角 */
  color: var(--ink-faint);
  background: rgba(255, 255, 255, 0.58);
  font-size: 11px;
  text-align: center;
}
```

**3n. Key 输入区**（约第 1061-1065 行）：

```css
.provider-key-input {
  display: flex;
  min-width: 0;
  border-radius: 0;           /* 方角 */
  background: var(--canvas-deep);
}
```

**3o. 高级设置面板**（约第 1095-1101 行）：

```css
.provider-advanced {
  overflow: hidden;
  border: 1px solid var(--line);
  border-radius: 0;           /* 方角 */
  background: color-mix(in srgb, var(--canvas) 72%, white);
}
```

**3p. 保存按钮**（约第 1208-1220 行）：

```css
.provider-save {
  min-height: 44px;
  margin-top: 2px;
  border-radius: 0;           /* 方角 */
  color: white;
  background: var(--ink);
  font-size: 12px;
  font-weight: 700;
}
```

**3q. 各种小元素**：

```css
/* 反馈消息 */
.provider-feedback {
  padding: 10px 12px;
  margin-top: 14px;
  border-radius: 0;           /* 方角 */
  color: #187848;
  background: rgba(44, 155, 98, 0.09);
  font-size: 11px;
  line-height: 1.5;
}

/* 认证预览 */
.provider-auth-preview,
.provider-search-explanation,
.provider-model-verification {
  padding: 9px 11px;
  margin: 0;
  border-radius: 0;           /* 方角 */
  color: var(--ink-soft);
  background: var(--canvas-deep);
  font-size: 10px;
  line-height: 1.5;
}

/* 验证说明 */
.provider-verification-note {
  padding: 9px 11px;
  margin: 0;
  border-left: 3px solid color-mix(in srgb, var(--accent) 54%, var(--line));
  border-radius: 0;           /* 方角 */
  color: var(--ink-soft);
  background: var(--accent-soft);
  font-size: 10px;
  line-height: 1.5;
}

/* 搜索说明 */
.provider-search-explanation {
  border-left: 3px solid color-mix(in srgb, var(--accent) 40%, var(--line));
  border-radius: 0;           /* 方角 */
}

/* 固定 URL 显示 */
.provider-fixed-url {
  padding: 10px 12px;
  border-radius: 0;           /* 方角 */
  color: var(--ink-faint);
  background: var(--canvas-deep);
  font-size: 10px;
  line-height: 1.45;
}

/* 空状态 */
.provider-empty > span {
  display: grid;
  width: 34px;
  height: 34px;
  margin-bottom: 5px;
  place-items: center;
  border: 1px dashed color-mix(in srgb, var(--accent) 45%, var(--line));
  border-radius: 0;           /* 方角，或保留圆形如果你觉得合适 */
  color: var(--accent);
  font-size: 18px;
}

/* 列表 profile-actions 按钮 */
.provider-profile-actions button {
  min-height: 28px;
  padding: 0 7px;
  border-radius: 0;           /* 方角 */
  color: var(--ink-soft);
  background: transparent;
  font-size: 10px;
}

/* section title 按钮 */
.provider-section-title > button {
  flex: 0 0 auto;
  padding: 5px 8px;
  border-radius: 0;           /* 方角 */
  color: var(--ink-soft);
  background: transparent;
  font-size: 11px;
}
```

#### 步骤 4：增强编辑区——在当前选中预设下显示更多信息

为了让"设置模型的位置足够大，足够一目了然"，在 `provider-settings-panel.tsx` 中不需要大改结构，但在编辑区预填信息时应该更清晰。

**文件**：`components/provider-settings-panel.tsx`

在 provider-editor form 内部，供应商预设选择器下面，增加一条当前预设的摘要信息（已有 `small` 展示 description，可增强）。无需代码改动，CSS 层面增大编辑区字体和间距即可。

在 CSS 中额外添加（`app/styles/workspace.css` 末尾）：

```css
/* 编辑区增强 */

.provider-editor {
  min-height: 420px;            /* 确保编辑区有足够高度 */
}

.provider-editor h4 {
  font-size: 16px;              /* 比默认 14px 更大 */
  font-weight: 700;
}

.provider-preset-fieldset legend {
  font-size: 13px;              /* 更大 */
  font-weight: 700;
  letter-spacing: 0.02em;
}

.provider-preset-picker {
  gap: 8px;                     /* 按钮间距更大 */
}

.provider-preset-picker button {
  min-height: 36px;             /* 更高 */
  padding: 0 14px;              /* 更宽 */
  font-size: 12px;              /* 更大 */
}

.provider-editor input:not([type="checkbox"]),
.provider-editor select {
  height: 46px;                 /* 更高 */
  font-size: 13px;              /* 更大 */
}

.provider-editor > label,
.provider-form-row > label,
.provider-advanced-body > label {
  font-size: 13px;
  gap: 8px;
}
```

### 涉及文件清单

| 文件 | 改动类型 |
|------|----------|
| `lib/provider-settings.ts` | 新增 `kimi`、`glm` 到类型定义、预设数组、解析验证 |
| `components/provider-settings-panel.tsx` | 无需结构改动（布局调整通过 CSS 完成） |
| `app/styles/workspace.css` | **大量 CSS 改动**：方角化所有圆角、网格比例调整、编辑区增强 |

---

## 实施顺序建议

推荐按以下顺序实施，每完成一项验证一项：

1. **改动三（Mermaid 概念图）** — 风险最低，纯新增功能，不影响现有流程
2. **改动四（模型设置 UI + 新供应商）** — 视觉改动为主，供应商数据改动在 lib 层
3. **改动二（联网开关迁移）** — 涉及多个组件通信，需要仔细验证状态流转
4. **改动一（挡位切换防抖）** — 修复 bug，需要模拟快速点击场景验证

---

## 测试验证要点

### 改动一
- [ ] 快速连续点击挡位切换按钮 5 次，确认不报错
- [ ] 等待 300ms 后确认最终生效的是最后一次选择的挡位
- [ ] 正常单次切换挡位功能不受影响

### 改动二
- [ ] 主输入框中不再显示联网按钮
- [ ] 模型设置弹窗 → 搜索服务标签页中显示联网总开关
- [ ] 未配置搜索服务时，开关为 disabled 状态
- [ ] 配置搜索服务后，开关可正常切换
- [ ] 开启联网 + 有搜索服务时，创建主问题会传递 `searchMode: "on"`
- [ ] AI 对话面板中的逐轮联网选项不受影响

### 改动三
- [ ] idle 状态下，问题输入框下方显示 Mermaid 概念图
- [ ] 创建问题后，概念图消失
- [ ] 图表的 SVG 在不同屏幕尺寸下正常缩放
- [ ] 如果 Mermaid 加载失败，显示友好的错误提示而不是白屏

### 改动四
- [ ] 供应商预设列表中出现 Kimi 和 GLM
- [ ] 选择 Kimi 后，自动填充 `api.moonshot.cn` 和 `moonshot-v1-auto`
- [ ] 选择 GLM 后，自动填充 `open.bigmodel.cn` 和 `glm-4.6`
- [ ] 保存 Kimi/GLM 配置后，验证和激活功能正常
- [ ] 整个模型设置弹窗使用方角风格
- [ ] 已配置列表宽度收窄，编辑区宽度增大
- [ ] 编辑区输入框和按钮更大更清晰

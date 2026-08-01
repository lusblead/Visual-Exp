# 语义缩放解释空间 MVP 规格

## 1. 产品目标

MVP 验证：面对复杂问题时，用户能否通过“先看高层结构、再进入局部、随时返回整体”的 AI 可视化回答，比阅读长文本更快建立整体理解。

产品不是 AI PPT、思维导图或白板生成器。核心体验是：

> AI 把回答组织成一个可以进入的空间。标题是信息容器，缩放对应理解层级变化，而不是单纯把文字变大或变小。

## 2. 为什么上一版过于固化

上一版把协议固定为四个 generation，并要求所有问题选择演化、因果、观点或系统镜头。这会产生三个问题：

1. 数据模型提前决定了页面必须长成四列；
2. 很多问题被迫适配“起源—形成—分化—汇合”，内容关系失真；
3. 展开操作只在原谱系增加一个节点，用户没有真正进入新的信息层。

v2 删除固定阶段和固定镜头，改为不固定层数的递归场景树；协议仍设置深度和节点数量安全上限。

## 3. 核心交互

```text
用户提出问题
  ↓
AI 生成根节点和 3–6 个一级入口
  ↓
当前画面只显示高抽象度结构
  ↓ 点击某个节点
若该节点尚未生成子层，AI 只为它生成 3–5 个直接子节点
  ↓
界面进入该节点场景
  ↓
用户通过面包屑、结构地图或快捷键返回
```

用户深入一个分支时，其他分支不被重写。已经生成的节点、当前路径和手动选择的视觉形式持续存在。

## 4. 文档协议

`VisualDocument` 是唯一事实来源：

```ts
interface VisualDocument {
  protocol: "visual-explanation-document/2";
  id: string;
  question: string;
  title: string;
  thesis: string;
  rootId: string;
  nodes: VisualNode[];
  relations: VisualRelation[];
  version: number;
}
```

每个节点既是一段内容，也是进入下一层的入口：

```ts
interface VisualNode {
  id: string;
  parentId: string | null;
  title: string;
  eyebrow: string;
  summary: string;
  detail: string;
  kind: "topic" | "stage" | "concept" | "process" | "system" |
        "argument" | "example" | "evidence" | "question";
  view: "grid" | "sequence" | "timeline" | "compare" | "cluster";
  depth: number;
  childIds: string[];
  expandable: boolean;
  expansionState: "outline" | "expanded" | "terminal";
  emphasis: "primary" | "secondary" | "detail";
  confidence: "high" | "medium" | "low";
  sourceStatus: "source_backed" | "model_knowledge" | "needs_source";
  evidence: VisualEvidence[];
}
```

`parentId` 是父子关系的事实来源。服务器每次应用操作后重新构建 `childIds`，避免模型同时维护两份容易冲突的关系。

协议不包含：

- x / y 坐标；
- 宽高、颜色、字体或阴影；
- DOM、CSS 或组件名称；
- 固定列数、固定阶段数或固定模板 ID。

## 5. 表现形式

每个节点的 `view` 描述它的直接子节点适合怎样呈现：

- `grid`：并列主题或结构概览；
- `sequence`：过程、调用链或步骤；
- `timeline`：历史、阶段或演进；
- `compare`：方案、观点或权衡；
- `cluster`：围绕重点组织的系统结构。

表现形式是同一份语义内容的投影。用户可以在当前场景手动切换，而不修改节点内容和探索路径。

## 6. AI 操作边界

创建调用返回完整的第一层文档。展开调用只返回增量操作：

- `add_node`：添加选中节点的直接子节点；
- `add_relation`：添加同一场景内的子节点关系；
- `update_node`：更新当前节点的摘要、说明或推荐表现形式。

服务端验证：

- 版本必须匹配；
- 新节点只能位于选中节点下一层；
- 每次展开生成 3–5 个直接子节点；
- 关系只能连接同一父节点的直接子节点；
- 不能覆盖其他现有节点；
- 不能生成坐标或样式；
- 没有检索工具时不能伪造来源。

## 7. MVP 已实现的结果

- 高层首页；
- 点击进入新场景；
- 懒生成下一层；
- 可递归的多层数据模型；
- 结构地图和面包屑；
- 返回上层、回到全局、撤销生成；
- 五种确定性视觉投影；
- DeepSeek、OpenAI 和离线演示适配器；
- 严格协议校验与来源安全。

## 8. 当前非目标

- 不做自由像素画布或专业排版编辑器；
- 不做多人实时协作；
- 不让模型直接操作 DOM、CSS 或坐标；
- 不能覆盖其他现有节点；
- 不把模型知识伪装成经过检索验证的事实；
- 不在 MVP 中实现动画编辑器、PPT 导出或任意文件知识库。

## 9. 下一阶段

下一阶段应增加“对当前场景下指令”的增量修改能力，例如：

- 把本层改成时间线；
- 合并两个重复节点；
- 给某个结论增加例子；
- 保留内容，只改变讲解对象；
- 用户手动固定节点后，AI 不再覆盖。

这些能力仍应通过语义操作完成，而不是把模型权限扩大到像素层。

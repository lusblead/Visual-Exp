import { detail, type BlueprintItem } from "./demo-blueprint-types";

export const DETAIL_BLUEPRINTS: Record<string, BlueprintItem[]> = {
  purpose: [
    detail("problem", "问题", "真正要解决的任务", "用户当前付出的认知或操作成本是什么。", "question", "grid"),
    detail("audience", "对象", "谁需要这个结果", "不同用户的背景和目标会改变表达方式。", "example", "grid"),
    detail("success", "标准", "怎样才算成功", "用可观察结果而不是功能数量判断价值。", "evidence", "compare"),
    detail("boundary", "边界", "明确不做什么", "主动排除会让系统失焦的相邻问题。", "argument", "compare"),
  ],
  mechanism: [
    detail("input", "输入", "接收意图与上下文", "确认问题、对象和当前已经掌握的信息。", "process", "grid"),
    detail("model", "建模", "形成语义结构", "把线性文本转换成层级、关系和可继续展开的节点。", "concept", "cluster"),
    detail("projection", "表达", "选择合适的视觉投影", "根据关系选择网格、路径、时间线、对比或聚类。", "process", "compare"),
    detail("feedback", "反馈", "依据探索继续重构", "用户进入、返回或追问后，只更新相关场景。", "process", "timeline"),
  ],
  components: [
    detail("conversation", "交互", "意图与焦点控制", "记录用户正在看哪里、选择了什么以及想继续了解什么。", "system", "grid"),
    detail("semantic", "语义", "可递归的场景文档", "内容、层级和关系独立于任何具体像素布局。", "system", "cluster"),
    detail("model", "生成", "受约束的模型操作", "模型增量添加节点或关系，而不是重写整个页面。", "system", "sequence"),
    detail("renderer", "渲染", "确定性的表现形式", "同一份语义内容可以投影成不同视觉结构。", "system", "compare"),
    detail("governance", "治理", "版本、来源与恢复", "保证改动可验证、可撤销，并明确知识来源状态。", "system", "grid"),
  ],
  tradeoffs: [
    detail("freedom", "自由度", "表达能力", "越自由越能适应内容，但也越难保持一致和可测试。", "argument", "compare"),
    detail("stability", "稳定性", "结构可靠性", "确定性布局和协议约束减少跳动、冲突和不可恢复修改。", "argument", "compare"),
    detail("density", "认知", "信息密度", "一屏内容必须足够概括，同时让用户知道还能继续深入。", "argument", "grid"),
    detail("latency", "体验", "生成延迟", "深层内容按需生成，避免第一次回答铺满整个知识空间。", "argument", "sequence"),
  ],
  roadmap: [
    detail("poc", "阶段 0", "技术闭环", "验证递归协议、增量展开和场景切换能够稳定工作。", "stage", "grid"),
    detail("mvp", "阶段 1", "理解效率", "比较视觉化回答与普通长文本在理解速度和定位能力上的差异。", "stage", "grid"),
    detail("guide", "阶段 2", "AI 讲解", "让 AI 主动控制焦点、顺序和表达深度。", "stage", "grid"),
    detail("engine", "阶段 3", "视觉表达引擎", "扩展视觉语法、主题和可交互表达形式。", "stage", "grid"),
  ],
};

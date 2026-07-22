# AI 动画流程 JSON v3 设计说明

## 设计目标

v3 同时服务两类消费者：

- 代码型 AI/游戏引擎读取 `graph`、`resources`、`parallelCompositions` 和 `executionModel`，直接实现运行逻辑。
- 人或大模型先读 `readableFlowSummaries` 和 `reconstructionGuide`，快速理解整体意图。

规范文件位于 `schemas/ai-animation-flow-v3.schema.json`，界面“导出 AI JSON”现在输出 `animation-flow-ai-v3.json`。

## 顶层结构

| 字段 | 用途 |
|---|---|
| `metadata` | 生成器、时间、语言和格式意图。 |
| `units` / `coordinateSystem` | 明确秒、像素、Alpha 和编辑器/Spine 坐标系，防止 AI 猜单位。 |
| `resourcePackaging` | 声明 JSON 与外部 Spine 资源的交付关系。 |
| `resources` | 去重后的骨架包、Spine 版本、文件名、页顺序和可用性。 |
| `canvas` | 视口、网格、渲染模式、流程模式、分组、颜色、排序和节点归属。 |
| `graph.nodes` | 所有节点的稳定 ID、原画布 ID、位置、类型和完整语义参数。 |
| `graph.edges` | 精确端口、并行层号、条件原文、贝塞尔控制点和颜色。 |
| `parallelCompositions` | 并行层、Z 序、位置继承、起点与递归执行树。 |
| `gameProtocol` | 面向 Unity/Godot/Cocos 的实体、状态、Transition、Event、Binding 与 RuntimeRule 投影。 |
| `executionModel` | 跨引擎必须保持一致的轨道、混合、条件、隐藏和栅栏规则。 |
| `readableFlowSummaries` | 从入口展开的可读路径；循环会明确标记。规范化图始终是权威数据。 |
| `reconstructionGuide` | 另一个 AI 应按顺序完成的实现步骤和还原边界。 |
| `validation` | 导出时发现的悬空边、资源缺失、轨道动画名错误等诊断。 |

## 轨道的关键表达

每条 `trackSequence` 都包含：

- `trackIndex`、`enabled`、`alpha`、`mixBlend`、`loopSequence`；
- 每个 clip 的动画名、原始时长、绝对开始时间；
- `mixToNextSeconds` 与下一 clip 的绝对开始时间；
- 扣除混合重叠后的 `durationPerSequenceSeconds`。

执行器必须让一条 UI 轨道对应同索引 Spine track。禁止把同轨 A→B 混合实现成两条临时轨道交叉改 Alpha，因为那会改变多轨叠加、附件和约束结果。

## 并行的关键表达

`parallelCompositions` 明确约定：

1. 所有层同时开始。
2. 层内节点顺序执行。
3. 遇到子并行时递归执行。
4. 层号越小越靠上绘制。
5. 子树偏移累加祖先容器偏移。
6. 隐藏只跳过绘制，不暂停执行。
7. 每个并发引用必须创建独立可变 Runtime 实例。
8. 全部层完成后才释放栅栏。

## 95% 与 100% 还原条件

只用 JSON 可以近乎完整地重建流程、参数和画布，但无法凭空恢复纹理像素、骨架二进制和 Runtime 物理差异。要达到 100%，交付包必须包含：

- `resources` 列出的原始 skeleton、atlas、全部纹理页；
- 对应的 Spine Runtime 版本；
- 条件表达式使用的变量定义和求值约定；
- 标注中引用的截图或挂载图片文件。

当这些伴随资源齐全时，v3 已提供足够的轨道、混合、并行、循环、速度、皮肤、PMA、位置和流程数据来追求逐帧一致。

## 游戏逻辑层与信息缺口

根据“AI 游戏重建协议”的建议，v3 现在额外生成 `gameProtocol`：

- `entities`：按 Spine 资源形成实体原型，并关联可能的动画状态节点；
- `states`：把画布 Spine 节点投影为可生成代码的状态；
- `transitions`：明确来源、目标、触发时机、条件、优先级、Fallback 与条件失败策略；
- `events`：导出 Spine 时间线事件，并为外部游戏事件保留明确入口；
- `bindings`：给出 Unity、Godot、Cocos 的概念映射；
- `runtimeRules`：规定无可用分支、并发实例隔离、原条件保留等行为。

当前编辑器没有“对象实例数量”“游戏世界坐标”“点击/服务器事件”的独立输入界面。导出器不会根据备注偷偷猜这些值，而是输出 `not-authored`、空定义和 Validation 警告。这样下一个 AI 能区分“作者明确设置的数据”和“仍需向作者询问的数据”。

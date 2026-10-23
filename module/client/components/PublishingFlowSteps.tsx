/**
 * 统一发布流程条：稿件编辑页与媒体库共用同一组件、同一套阶段规则。
 * 单标题投放没有独立标题配置阶段，只显示 3 步；多标题与批量投放显示 4 步；
 * 未选择稿件时按标准 4 步初始展示（仅表示流程入口，不代表已创建稿件）。
 */
export type FlowStageMode =
  | "single"
  | "per_media"
  | "multi"
  | "batch"
  | "default";

export const FLOW_STAGES_FULL = [
  "编辑稿件",
  "选择媒体",
  "配置标题",
  "预检发布",
] as const;

export const FLOW_STAGES_SINGLE = ["编辑稿件", "选择媒体", "预检发布"] as const;

/** 统一的阶段规则：所有页面共用，禁止各自维护步骤数组。 */
export function flowStagesForMode(mode: FlowStageMode): string[] {
  return mode === "single" ? [...FLOW_STAGES_SINGLE] : [...FLOW_STAGES_FULL];
}

/** 编辑器组织模式与网关 titleMode 的映射（multi/batch 的标题均需按媒体配置）。 */
export function titleModeForFlowMode(
  mode: FlowStageMode,
): "single" | "per_media" {
  return mode === "per_media" || mode === "multi" || mode === "batch"
    ? "per_media"
    : "single";
}

export default function PublishingFlowSteps({
  stages,
  doneCount = 0,
  activeIndex = 0,
}: {
  stages: string[];
  /** 已完成阶段数量（显示 ✓ 与完成色）。 */
  doneCount?: number;
  /** 当前阶段下标（高亮边框与品牌色）。 */
  activeIndex?: number;
}) {
  return (
    <div className="steps" aria-label="发布流程">
      {stages.map((text, index) => (
        <div
          key={text}
          className={
            "step " +
            (index < doneCount ? "done" : index === activeIndex ? "active" : "")
          }
        >
          <b>{index < doneCount ? "✓" : index + 1}</b>
          {text}
        </div>
      ))}
    </div>
  );
}

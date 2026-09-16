import { z } from "zod";

export const monitoringQuestionCategories = [
  "industry",
  "competitor_comparison",
  "reputation",
  "product_scenario",
] as const;
export const monitoringQuestionCategorySchema = z.enum(
  monitoringQuestionCategories,
);
export type MonitoringQuestionCategory = z.infer<
  typeof monitoringQuestionCategorySchema
>;

/** Keys use the same trimmed, single-line text as monitoring questions. */
export const questionCategoriesSchema = z
  .record(z.string().min(1).max(4_000), monitoringQuestionCategorySchema)
  .superRefine((value, context) => {
    if (Object.keys(value).length > 50) {
      context.addIssue({
        code: "custom",
        message: "最多可以设置 50 个问题的类型",
      });
    }
  });

export function normalizeQuestionCategories(
  questions: readonly string[],
  categories: Readonly<Record<string, MonitoringQuestionCategory>> = {},
): Record<string, MonitoringQuestionCategory> {
  const allowed = new Set(questions.map((question) => question.trim()));
  const normalized: Record<string, MonitoringQuestionCategory> =
    Object.create(null);
  for (const [rawQuestion, category] of Object.entries(categories).sort(
    ([left], [right]) => (left < right ? -1 : left > right ? 1 : 0),
  )) {
    const question = rawQuestion.trim();
    if (!allowed.has(question)) throw new Error("问题类型必须对应当前问题列表");
    if (normalized[question] && normalized[question] !== category) {
      throw new Error("同一个问题不能设置不同类型");
    }
    normalized[question] = category;
  }
  return normalized;
}

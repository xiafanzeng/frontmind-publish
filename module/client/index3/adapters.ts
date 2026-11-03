import type { ArticleStatus, PublicationBatchStatus } from "../types";

/** Real gateway statuses mapped to the index3 reference badge vocabulary. */

export function batchBadge(status: PublicationBatchStatus): { label: string; tone: string } {
  switch (status) {
    case "queued":
      return { label: "排队中", tone: "info" };
    case "processing":
      return { label: "发布中", tone: "info" };
    case "success":
      return { label: "全部成功", tone: "success" };
    case "failed":
      return { label: "全部失败", tone: "danger" };
    case "partial_success":
      return { label: "部分失败", tone: "warning" };
    case "action_required":
      return { label: "需处理", tone: "warning" };
  }
}

export function articleBadge(status: ArticleStatus): { label: string; tone: string } {
  switch (status) {
    case "draft":
      return { label: "编辑中", tone: "" };
    case "importing":
      return { label: "导入中", tone: "info" };
    case "import_failed":
      return { label: "导入失败", tone: "danger" };
    case "frozen":
      return { label: "待投放", tone: "warning" };
  }
}

export function articleUpdatedHint(status: ArticleStatus): string {
  return status === "frozen" ? "已冻结，可继续投放" : "继续编辑后保存新版本";
}

export const problemStatuses: PublicationBatchStatus[] = ["failed", "partial_success", "action_required"];

export function moneyBreakdown(batch: {
  totalTenThousandths: string;
  consumedTenThousandths: string;
  frozenTenThousandths: string;
  releasedTenThousandths: string;
}) {
  return [
    { label: "实扣", value: batch.consumedTenThousandths },
    { label: "预占", value: batch.frozenTenThousandths },
    { label: "退回", value: batch.releasedTenThousandths },
  ];
}

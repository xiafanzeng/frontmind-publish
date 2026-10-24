import { AlertTriangle, ShieldAlert } from "lucide-react";
import type { ReactNode } from "react";
import {
  formatPublishingMoney,
  type PublicationBatch,
  type PublicationBatchSummary,
  type PublicationItem,
} from "../types";

export function PublishingAttentionNotice({
  count,
  frozenTenThousandths,
  title = "发布结果待核实",
  children,
}: {
  count: number;
  frozenTenThousandths: string;
  title?: string;
  children?: ReactNode;
}) {
  if (count < 1) return null;
  return (
    <div className="publishing-notice is-warning publishing-attention-notice" role="alert">
      <AlertTriangle size={22} aria-hidden="true" />
      <div>
        <strong>{title}</strong>
        <p>{count} 项待管理员核对 · 相关批次冻结 {formatPublishingMoney(frozenTenThousandths)}</p>
        <p>系统未自动重发。管理员核对供应商订单后，将更新结果或退回已确认未成单的预占金额。</p>
        {children}
      </div>
    </div>
  );
}

export function PublicationBatchAttention({
  batches,
}: {
  batches: Array<PublicationBatchSummary | PublicationBatch>;
}) {
  let count = 0;
  let frozen = 0n;
  let blockedReleased = 0n;
  let blockedCount = 0;
  for (const batch of batches) {
    frozen += BigInt(batch.frozenTenThousandths);
    if ("items" in batch) {
      count += batch.items.filter(item => item.status === "submission_unknown" || item.status === "action_required").length;
      for (const item of batch.items) {
        if (item.status === "auth_blocked" && item.fundStatus === "released") {
          blockedCount += 1;
          blockedReleased += BigInt(item.priceTenThousandths);
        }
      }
    } else {
      count += batch.unknownCount;
    }
  }
  return (
    <>
      <PublishingAttentionNotice count={count} frozenTenThousandths={frozen.toString()} />
      {blockedCount ? (
        <div className="publishing-notice is-warning publishing-attention-notice" role="alert">
          <ShieldAlert size={22} aria-hidden="true" />
          <div>
            <strong>发布凭证失效或认证检查受阻，预占已退回</strong>
            <p>{blockedCount} 项发布前已阻断，{formatPublishingMoney(blockedReleased.toString())} 已退回可用余额。系统未自动重发，请等待管理员恢复凭据后再处理。</p>
          </div>
        </div>
      ) : null}
    </>
  );
}

/** Customer copy never exposes raw provider exceptions or credentials. */
export function publicationItemResultText(item: Pick<PublicationItem, "status" | "fundStatus" | "resultMessage">) {
  if (item.status === "submission_unknown") return "发布结果待核实，待管理员核对；系统未自动重发。";
  if (item.status === "auth_blocked") return item.fundStatus === "released"
    ? "发布凭证失效或认证检查受阻，预占已退回可用余额；系统未自动重发。"
    : "发布认证检查受阻，待管理员处理；系统未自动重发。";
  if (item.status === "action_required") return item.fundStatus === "released"
    ? "发布前检查未通过或已确认未成单，预占已退回可用余额；系统未自动重发。"
    : "待管理员核对，预占暂时冻结；系统未自动重发。";
  if (item.resultMessage && /[\u3400-\u9fff]/u.test(item.resultMessage)) return item.resultMessage;
  if (item.status === "failed") return item.fundStatus === "released"
    ? "发布未完成，预占已退回可用余额。" : "发布未完成，请查看资金状态。";
  if (item.status === "success") return "发布成功";
  if (item.status === "processing") return "媒体正在处理，请等待发布结果。";
  if (item.status === "submitting") return "正在提交发布请求。";
  return "等待服务端提交。";
}

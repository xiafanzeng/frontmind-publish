import { RepositoryError } from "@frontmind/module-contracts/errors";

export type PublisherReconciliationScan = {
  observedAt: string; pagesFetched: number; reportedLastPage?: number;
  complete: boolean; ordersSeen: number; since: string;
};

/** An empty list is not a provider cancellation receipt. This transition is
 * explicitly authorized by an administrator with independent supplier evidence. */
export function assertPublisherNoOrderResolution(item: {
  status: string; fundsStatus: string; externalOrderId?: string | null; attemptCount: number;
}, expectedAttemptNumber: number, bound: boolean) {
  if (item.status !== "submission_unknown" || item.fundsStatus !== "frozen"
    || item.externalOrderId || bound || item.attemptCount !== expectedAttemptNumber) {
    throw new RepositoryError("CONFLICT", "发布记录已变化或已存在订单，请重新核对后处理");
  }
}

export function publisherReconciliationScan(value: unknown): PublisherReconciliationScan | undefined {
  if (!value || typeof value !== "object") return undefined;
  const v = value as Record<string, unknown>;
  const date = (x: unknown): x is string => typeof x === "string" && Number.isFinite(Date.parse(x));
  const count = (x: unknown): x is number => typeof x === "number" && Number.isSafeInteger(x) && x >= 0;
  if (!date(v.observedAt) || !date(v.since) || !count(v.pagesFetched) || !count(v.ordersSeen)
    || typeof v.complete !== "boolean" || (v.reportedLastPage !== undefined && !count(v.reportedLastPage))) return undefined;
  return { observedAt: v.observedAt, since: v.since, pagesFetched: v.pagesFetched,
    ordersSeen: v.ordersSeen, complete: v.complete,
    ...(v.reportedLastPage === undefined ? {} : { reportedLastPage: v.reportedLastPage as number }) };
}

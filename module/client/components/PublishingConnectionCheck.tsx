import { useEffect, useRef, useState } from "react";
import type { PublisherGateway } from "../gateway";
import { publishingDateTime } from "../types";

export function PublishingConnectionCheck({ gateway }: { gateway: Pick<PublisherGateway, "requestConnectionCheck" | "getConnectionCheck"> }) {
  const [checkId, setCheckId] = useState<string>();
  const [status, setStatus] = useState<"idle" | "pending" | "healthy" | "failed">("idle");
  const [checkedAt, setCheckedAt] = useState<string>();
  const [pollSequence, setPollSequence] = useState(0);
  const scope = useRef(0);
  const deadline = useRef(0);
  useEffect(() => {
    scope.current += 1;
    setCheckId(undefined);
    setStatus("idle");
    setCheckedAt(undefined);
    return () => { scope.current += 1; };
  }, [gateway]);
  useEffect(() => {
    if (!checkId || !gateway.getConnectionCheck) return;
    const controller = new AbortController();
    const current = scope.current;
    let alive = true;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const result = await gateway.getConnectionCheck!(checkId, controller.signal);
        if (!alive || scope.current !== current) return;
        if (result.status === "pending" && Date.now() < deadline.current) {
          timer = setTimeout(() => void poll(), 1_500);
          return;
        }
        setStatus(result.status === "pending" ? "failed" : result.status);
        setCheckedAt(result.checkedAt);
      } catch {
        if (alive && scope.current === current) setStatus("failed");
      }
    };
    void poll();
    return () => { alive = false; controller.abort(); clearTimeout(timer); };
  }, [checkId, gateway, pollSequence]);

  if (!gateway.requestConnectionCheck || !gateway.getConnectionCheck) return null;
  const request = async () => {
    if (status === "pending") return;
    const current = ++scope.current;
    setStatus("pending");
    setCheckedAt(undefined);
    setCheckId(undefined);
    deadline.current = Date.now() + 5 * 60_000;
    try {
      const result = await gateway.requestConnectionCheck!();
      if (scope.current === current) {
        setCheckId(result.checkId);
        setPollSequence(sequence => sequence + 1);
      }
    } catch {
      if (scope.current === current) setStatus("failed");
    }
  };
  return (
    <div className="publishing-connection-check">
      <button className="publishing-button publishing-button-secondary" type="button" disabled={status === "pending"} onClick={() => void request()}>
        {status === "pending" ? "正在检查发布连接…" : "检查发布连接"}
      </button>
      {status !== "idle" ? <p role={status === "failed" ? "alert" : "status"}>
        {status === "pending" ? "正在由发布服务检查连接，不会提交稿件或扣款。"
          : status === "healthy" ? "发布连接检查成功，当前凭据可用。"
            : "本次连接检查未通过，请稍后重试或联系管理员。"}
        {checkedAt ? ` 检查于 ${publishingDateTime(checkedAt)}` : ""}
      </p> : null}
    </div>
  );
}

/** Presentation-only fallback for older gateways and host errors. The original
 * error stays untouched for the server/host diagnostic and business-code paths. */
export function mediaReadError(error: unknown, fallback = "媒体资料暂时无法读取，请重试。"): string {
  const message = (error instanceof Error ? error.message : typeof error === "string" ? error : "").trim();
  if (!message) return fallback;
  // Never put database statements, identifiers, parameters, traces or credentials
  // in the library, cart or an operation dialog, even inside a Chinese prefix.
  if (/failed\s+query|sqlstate|\b(?:select|insert|delete|update)\b[\s\S]*\b(?:from|into|where|set)\b|\b(?:publisher_[a-z_]+|params\s*:|stack\s*:)|\bat\s+\S+\s*\([^)]*:\d+|PUBLISHER_[A-Z_]+/i.test(message)) return fallback;
  if (/timeout|timed?\s*out|ETIMEDOUT/i.test(message)) return "读取超时，请重试。";
  if (/failed to fetch|network\s*error|ECONN\w+|ENOTFOUND/i.test(message)) return "连接暂时不可用，请稍后重试。";
  // Preserve concise user-facing business reasons, including current permissions
  // and version conflicts. Untranslated driver errors use the context fallback.
  return message.length <= 300 && /[\u3400-\u9fff]/.test(message) ? message : fallback;
}

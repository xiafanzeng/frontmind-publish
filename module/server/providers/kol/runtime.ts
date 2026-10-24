/** Server-only environment adapter for module-owned provider routes. */
import { KolClient } from "./client.js";
import { KolProviderError } from "./errors.js";
import { MockKolClient } from "./mock.js";
import type { KolClientOptions, KolProviderPort, KolPublicationMode } from "./types.js";

type RuntimeEnv = Readonly<Record<string, string | undefined>>;
const LOGIN_FIELDS = ["API_KEY", "MOBILE", "PASSWORD", "IDENTITY", "CAPTCHA", "CAPTCHA_TOKEN"] as const;

function invalid(message: string): never {
  throw new KolProviderError("invalid_configuration", message, { operation: "configure_runtime" });
}

function flag(env: RuntimeEnv, key: string, fallback = false) {
  const value = env[key]?.trim().toLowerCase();
  if (!value) return fallback;
  if (value === "true" || value === "1") return true;
  if (value === "false" || value === "0") return false;
  return invalid(`Invalid boolean setting: ${key}`);
}

function integer(env: RuntimeEnv, key: string, fallback: number) {
  const text = env[key]?.trim();
  if (!text) return fallback;
  const value = Number(text);
  if (!Number.isSafeInteger(value) || value < 1) invalid(`Invalid positive integer setting: ${key}`);
  return value;
}

function secret(value: string | undefined) {
  const trimmed = value?.trim();
  return trimmed && !/^replace(?:[-_]|$)/iu.test(trimmed) ? trimmed : undefined;
}

function configuration(env: RuntimeEnv) {
  const enabled = flag(env, "PUBLISHER_FEATURE_ENABLED") && flag(env, "PUBLISHER_PROVIDER_ENABLED", true);
  const rawMode = env.PUBLISHER_MODE?.trim().toLowerCase() ?? (env.NODE_ENV === "production" ? "live" : "mock");
  if (!["mock", "test", "live"].includes(rawMode)) invalid("PUBLISHER_MODE must be mock, test or live");
  if (env.NODE_ENV === "production" && rawMode === "mock") invalid("Mock publishing is forbidden in production");
  const mode = rawMode as KolPublicationMode;
  const accessToken = secret(env.PUBLISHER_KOL_ACCESS_TOKEN);
  const login = LOGIN_FIELDS.map(field => secret(env[`PUBLISHER_KOL_${field}`] ?? env[`KOL_${field}`]));
  const hasLogin = login.every(Boolean);
  const baseUrl = env.PUBLISHER_KOL_BASE_URL?.trim() ?? env.KOL_BASE_URL?.trim();
  let validOrigin = false;
  if (baseUrl) {
    try { const url = new URL(baseUrl); validOrigin = url.protocol === "https:" && !url.username && !url.password; }
    catch { /* Report a configuration error without including the input value. */ }
  }
  return { enabled, mode, accessToken, login, hasLogin, baseUrl, validOrigin,
    realEnabled: flag(env, "PUBLISHER_REAL_ENABLED"), publishEnabled: flag(env, "PUBLISHER_PUBLISH_ENABLED") };
}

/** Only public capability booleans; never serialize configuration or credentials. */
export function getKolRuntimeStatus(env: RuntimeEnv = process.env) {
  const value = configuration(env);
  return {
    enabled: value.enabled,
    mode: value.mode,
    configured: value.enabled && (value.mode === "mock" || (value.validOrigin && Boolean(value.accessToken || value.hasLogin))),
    realPublicationEnabled: value.enabled && value.mode !== "mock" && value.realEnabled && value.publishEnabled,
  };
}

/** Short-lived API clients use a supplied token; only the worker may log in. */
export function createKolRuntimeClient(
  env: RuntimeEnv = process.env,
  transport: Pick<KolClientOptions, "fetch" | "sleep" | "now"> = {},
): KolProviderPort {
  const value = configuration(env);
  if (!value.enabled) invalid("Media provider is disabled in this runtime");
  if (value.mode === "mock") return new MockKolClient();
  if (!value.validOrigin || !value.baseUrl) invalid("Media provider HTTPS endpoint is not configured");
  if (!value.accessToken) invalid("API 缺少预发 token；请使用“检查发布连接”交由发布 Worker 登录和验证，或联系管理员配置有效 token");
  const encoding = env.PUBLISHER_CREATE_ORDER_ENCODING?.trim().toLowerCase()
    ?? env.KOL_CREATE_ORDER_ENCODING?.trim().toLowerCase() ?? "form";
  if (encoding !== "form" && encoding !== "json" && encoding !== "unknown") invalid("Invalid order encoding configuration");
  return new KolClient({
    baseUrl: value.baseUrl, mode: value.mode, accessToken: value.accessToken,
    realEnabled: value.realEnabled, publishEnabled: value.publishEnabled,
    createOrderEncoding: encoding,
    testResourceId: env.PUBLISHER_TEST_RESOURCE_ID ? integer(env, "PUBLISHER_TEST_RESOURCE_ID", 1)
      : env.KOL_TEST_RESOURCE_ID ? integer(env, "KOL_TEST_RESOURCE_ID", 1) : undefined,
    timeoutMs: integer(env, "PUBLISHER_REQUEST_TIMEOUT_MS", 20_000),
    maxGetAttempts: integer(env, "PUBLISHER_GET_MAX_ATTEMPTS", 5),
    getRetryBaseMs: integer(env, "PUBLISHER_GET_RETRY_BASE_MS", 1_000),
    ...transport,
  });
}

/** Read one catalog page without returning private provider payloads or placing orders. */
export async function checkKolRuntimeConnection(
  env: RuntimeEnv = process.env,
  transport: Pick<KolClientOptions, "fetch" | "sleep" | "now"> = {},
) {
  const value = configuration(env);
  if (value.mode === "mock") invalid("A live connection check cannot use mock mode");
  const page = await createKolRuntimeClient(env, transport).listResources(1);
  return { connectionOk: true as const, pageItemCount: page.resources.length, pagination: page.pagination };
}

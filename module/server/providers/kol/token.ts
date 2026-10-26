import { KolProviderError } from "./errors.js";

interface TokenValue {
  value: string;
  expiresAt?: number;
  obtainedAt: number;
}

export class KolTokenCache {
  private current?: TokenValue;
  private inFlight?: Promise<TokenValue>;
  private blocked = false;

  constructor(
    private readonly authenticate: (signal?: AbortSignal) => Promise<string>,
    private readonly options: {
      refreshSkewMs: number;
      /** Effective supplier session lifetime; the JWT exp claim is longer. */
      maxTokenAgeMs: number;
      now: () => Date;
    },
  ) {}

  async getToken(
    input: {
      forceRefresh?: boolean;
      rejectedToken?: string;
      signal?: AbortSignal;
    } = {},
  ): Promise<string> {
    if (this.blocked && !input.forceRefresh) {
      throw new KolProviderError(
        "authentication_blocked",
        "KOL authentication is blocked until a deliberate safe refresh succeeds",
        { operation: "authenticate" },
      );
    }
    // A concurrent safe read may already have refreshed the rejected token.
    // Reuse that newer credential even if this request is on its retry.
    if (
      this.usable(this.current) &&
      (!input.forceRefresh ||
        (input.rejectedToken !== undefined &&
          this.current.value !== input.rejectedToken))
    )
      return this.current.value;
    this.inFlight ??= this.authenticate(input.signal)
      .then((value) => ({
        value,
        expiresAt: jwtExpiry(value),
        obtainedAt: this.options.now().valueOf(),
      }))
      .finally(() => {
        this.inFlight = undefined;
      });
    try {
      const token = await this.inFlight;
      this.current = token;
      this.blocked = false;
      return token.value;
    } catch (error) {
      this.blocked = true;
      throw error;
    }
  }

  invalidate(rejectedToken: string): void {
    if (this.current?.value === rejectedToken) this.current = undefined;
  }

  block(): void {
    this.current = undefined;
    this.blocked = true;
  }

  private usable(value: TokenValue | undefined): value is TokenValue {
    if (!value) return false;
    // The supplier invalidates sessions after about maxTokenAgeMs even though
    // the JWT exp claim is far in the future; refresh before either limit.
    const effectiveExpiry = Math.min(
      value.expiresAt ?? Number.POSITIVE_INFINITY,
      value.obtainedAt + this.options.maxTokenAgeMs,
    );
    return effectiveExpiry - this.options.refreshSkewMs >
      this.options.now().valueOf();
  }
}

function jwtExpiry(token: string): number | undefined {
  const payload = token.split(".")[1];
  if (!payload) return undefined;
  try {
    const decoded = JSON.parse(
      Buffer.from(payload, "base64url").toString("utf8"),
    ) as { exp?: unknown };
    return typeof decoded.exp === "number" && Number.isFinite(decoded.exp)
      ? decoded.exp * 1_000
      : undefined;
  } catch {
    return undefined;
  }
}

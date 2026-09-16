const PRICE_PATTERN = /^(?:0|[1-9]\d*)(?:\.(\d{1,4}))?$/u;
const MAX_SIGNED_BIGINT = 9_223_372_036_854_775_807n;

/** Parse a provider decimal CNY price exactly into integer 1/10,000 CNY. */
export function publisherPriceToTenThousandths(value: string): bigint {
  const normalized = value.trim();
  const match = PRICE_PATTERN.exec(normalized);
  if (!match) {
    throw new TypeError(
      "Publisher price must be a non-negative decimal with at most four places",
    );
  }
  const [whole = "0", fraction = ""] = normalized.split(".");
  const amount = BigInt(whole) * 10_000n + BigInt(fraction.padEnd(4, "0"));
  if (amount > MAX_SIGNED_BIGINT) {
    throw new RangeError("Publisher price exceeds the database money range");
  }
  return amount;
}

export function publisherMoneyFromApiString(value: string): bigint {
  if (!/^-?(?:0|[1-9]\d*)$/u.test(value)) {
    throw new TypeError("Money amount must be a base-10 integer string");
  }
  const amount = BigInt(value);
  if (amount < -MAX_SIGNED_BIGINT || amount > MAX_SIGNED_BIGINT) {
    throw new RangeError("Money amount exceeds the database range");
  }
  return amount;
}

export function publisherMoneyToApiString(value: bigint): string {
  return value.toString(10);
}

export function formatPublisherCny(value: bigint): string {
  const negative = value < 0n;
  const absolute = negative ? -value : value;
  const whole = absolute / 10_000n;
  const fraction = (absolute % 10_000n).toString().padStart(4, "0");
  return `${negative ? "-" : ""}${whole}.${fraction}`;
}

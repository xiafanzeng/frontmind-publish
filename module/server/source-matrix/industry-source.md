# Public industry source integration

This is the public industry-analysis lane, separate from imported observations, project monitoring, the recommendation planner and purchasable media. Supplier contract: https://doc.molizhishu.com/docs/api/source-ranking (input documentation snapshot dated 2026-11-06).

## Server configuration

Configure the following **server-only** key through the existing trusted host environment mechanism:

```text
FRONTMIND_SOURCE_MATRIX_MOLIZHISHU_API_TOKEN=<main-account API token configured by the operator>
```

The module reads `core.environment`; setting an arbitrary browser variable or merely placing a key in a local file does not configure the host. The operator must verify the deployed host actually injects this key. No real token is present in this source package. The upstream origin is fixed to `https://business-api.molizhishu.com`; redirects are not followed. There is no client-controlled upstream URL and no new dependency, database table or migration.

The token must be the provider's main-account API token, not a website session token. The upstream account needs valid industry-source rights. The module does not purchase, renew, claim trials or infer remaining quota. Missing configuration fails explicitly and never enables an offline sample fallback.

## Authenticated module routes

The host mounts `createModuleHttpApi(core)` at `/api/modules/publish`. The new router is mounted at `/source-ranking`:

| Route | Query contract |
| --- | --- |
| `GET /filters` | No business query parameters |
| `GET /media-ranking` | Explicit common filter, pageSize, requestId, optional snapshotToken/cursor |
| `GET /contents` | Same pagination contract plus optional exact media, sourceType, sortBy/sortOrder |
| `GET /distributions` | Explicit common filter only |

The local proxy intentionally requires explicit `periodType`, `scopeType`, `modelCode` for data queries and a caller-generated `requestId` for charged list operations. This prevents accidental implicit all-history queries or unidentified retries. The authorized project/owner/account/actor is obtained from `core.context`, never URL parameters. It is used for local access/deduplication only and is not sent to the supplier.

Common, query, result and error contracts are in `module/contracts/industry-source.ts`. Integer identifiers, counts and expiry timestamps normalize to decimal strings before crossing the module boundary. The provider response is decoded before JavaScript number rounding can lose int64 precision. Responses expose allowlisted analysis fields only, with `source: molizhishu-public-industry` and `fetchedAt`; they do not expose server settings or raw upstream errors.

## Query and quota semantics

- Start with filters. The default is the month of actual `maxDate`; null maxDate stops data queries. Existing valid URL selections remain explicit and validated.
- List first pages and subsequent pages are distinct operations. Each gets a fresh UUID requestId; a network/timeout retry reuses the exact original query and ID. No automatic paid fan-out or whole-dataset crawling.
- Media and content cursors are independent. The returned nextCursor null ends the sequence. Filter/page-size changes start a new compatible sequence. No `page`/`offset` passthrough.
- Upstream replay expires: it is not perpetual exactly-once delivery. A 409 needs a fresh first-page operation; old accumulated pages are not combined with new ones. A client reload/process restart may lose local cache; upstream rules still govern any replay.
- HTTP 200 can contain a business/authentication failure. Consumers must use the typed envelope, not transport status alone. Provider errors are mapped to fixed safe user messages; credential-bearing diagnostics are not forwarded.
- 403 requires access/rights resolution; 429 stops fresh charged list operations until an explicit user recovery attempt. Successfully reloading free filters is not evidence of available list quota. Network/500 recovery retains the original operation. No claim is made about remaining monthly quota.

## Observation identity and statistics

Media code/name is not catalog identity. Content `linkId` is the stable deduplication key, while `sequence` is traversal position. Content citationRatio is already percentage text. Type and age distributions use their own sums and do not inherit content-only filters. Time buckets are relative to provider time, not the selected execution date. Source caching means a successful refresh does not guarantee real-time statistics.

The legacy imported `/source-distribution` endpoint and `IndustryDistribution` component remain available for their original consumers; the live industry panel uses the four new endpoints. No industry observation is silently converted into purchasable media, a quote, an order or a planner evidence record.

## Verification boundary

Source and regression-test files were authored without executing the application, typecheck, tests, build or supplier API. ZCode must run repository-required checks against the final merged revision, verify host injection and authorization, then perform minimal real requests with a valid account. Validate quota/error cases through test fixtures where an actual request would be unnecessary or destructive. Browser layout, focus, navigation and remount behavior remain runtime acceptance items.

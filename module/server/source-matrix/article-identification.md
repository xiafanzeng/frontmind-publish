# Four-field article identification: server integration

This is source-only delivery. No dependency install, server launch, typecheck, test, build, model call or deployment was performed. Configuration presence means the adapter is available, not that connectivity or extraction accuracy has been verified.

## Runtime configuration

The module does not load `.env` files. The authenticated host constructs `ModuleHttpCore.environment`; the administrator must place settings in the actual host service environment and pass them through that object, then reload the service. A standalone environment file that is not read and injected by that host does not enable the feature.

The existing precedence remains: `core.sourceMatrixDecisions` → authenticated actor's encrypted saved connection → environment adapter. Identification uses the same chosen connection. A selected host without `identify` reports `not_configured`; it does not silently fall through to another provider. An invalid saved connection is surfaced as an error; it does not fall through either.

For the user-selected AiCore service, configure the existing server-only keys:

```text
FRONTMIND_SOURCE_MATRIX_LLM_BASE_URL=https://api.xty.app/v1/chat/completions
FRONTMIND_SOURCE_MATRIX_LLM_MODEL=gpt-4o
FRONTMIND_SOURCE_MATRIX_ALLOWED_LLM_BASE_URLS=https://api.xty.app/v1
```

Set `FRONTMIND_SOURCE_MATRIX_LLM_API_KEY` through the host's secure secret injection. The source package contains no real credential and no credential file. `gpt-4o` is a configuration example selected for subsequent acceptance; ZCode must confirm that this account can invoke that exact model. Do not infer model availability from this document.

`https://api.xty.app/v1` is also accepted as the configured base and normalizes to `/v1/chat/completions`. The explicit complete endpoint works as shown above. Add this origin/base to the existing comma-separated allowlist rather than replacing unrelated required entries. Custom destinations must be HTTPS with no credentials, query, fragment, nonstandard port or local/IP host; redirects are refused. No browser request can supply a destination.

Protocol is the existing environment gateway's OpenAI-compatible Chat Completions: POST JSON with `model`, `messages`, `response_format:{type:"json_object"}` and a bounded output limit; Bearer authentication. Successful identification requires a completed response with `finish_reason:"stop"` and strict JSON content. User-level provider adapters retain their existing native protocol (OpenAI Responses, Claude Messages or compatible Chat Completions), adding strict identification parsing and limits. This does not add a new ordinary-user credential page or change the provider choices.

The previous defaults remain unchanged: absent base/model uses the existing BigModel chat endpoint / `glm-4.6`; absent key leaves the environment adapter disabled. A custom identification endpoint that is not allowlisted, or an invalid model identifier, leaves identification unavailable. Existing matrix/budget calls keep their existing flow; the only normalization they gain is a terminal `/v1` base to `/v1/chat/completions`.

## Host seam and revision ownership

`SourceMatrixDecisionAdapter.identify?(input)` receives `{article:{title,body}, industries:[{id,name,path?}], catalogSearch?:{total,matched,complete}, signal}` and returns unknown data shaped as `{fields:{product,industry,audience,questions}}`. Industries may be a bounded relevant subset of the full directory; no suitable candidate means unknown, not permission to guess another category. It must perform a real read-only extraction. The module validates its output against the complete current catalog like all provider output. `signal` is aborted at 45 seconds; the route also discards late output if a host ignores it.

Hosts implementing identification should set `identificationRevision` to an opaque server configuration revision, identical across equivalent workers and changed whenever the host model/credential/configuration changes. Do not use credentials themselves as the revision. If omitted, the module uses a conservative per-process adapter-instance revision: replacing the instance or identify function invalidates old contexts, and routing to a different worker may require a context refresh. In-place hidden host configuration changes cannot be detected without the supplied revision. This optional seam is new module code; the private host's implementation is outside the supplied repository and must be integrated there if the host override is active.

Personal connections use their stored revision. Environment revisions are keyed fingerprints that notice endpoint/model/key/allowlist changes without returning the credential. Authenticated account, actor, business actor, owner and project determine `scopeKey`. None of these come from the browser request.

## API and data boundary

Both endpoints are registered in `createSourceMatrixRouter`, after its existing same-origin mutation and private/no-store middleware, under the host's normal `/api/modules/publish` mount.

- GET `/matrix/identify/context?article_version_id=<UUID>&draft_id=<optional UUID>` authorizes and reads the exact frozen version, shared canonical industry catalog and chosen connection. It returns the shared `IdentificationContextResponse` with `ready` or `not_configured`, secret-free context including catalog version, and unknown metadata fields. No full body is returned.
- POST `/matrix/identify` accepts only `article_version_id`, optional `draft_id`, `content_digest` and `connection_revision`, matching the shared `IdentifyArticleRequest`. It rereads authorized content and checks the digest and model revision before calling AI. It returns the shared `IdentifyArticleResponse`: `complete`, `partial` or `unidentified` with per-field provenance.
- Errors use the existing sanitized `{status,message}` convention. Missing selection/invalid shape: 400; unauthorized scope: 403; missing binding: 404; stale content/scope/model or mismatched draft: 409; oversized article: 413; empty article/refusal/invalid result: 422; throttled: 429; unavailable model/configuration/timeout: 503.

`BindingStore.loadIdentificationArticle` checks owner/project on both version and parent article, and checks an optional draft's version before loading the frozen row. It reads **all `publisher_article_versions.plain_text`**; it never reads working-copy body, list summaries, sample datasets or media planner task text. There are no database writes, new drafts, frozen versions, planner tasks or publication mutations.

Schema limitation: the frozen table has no title snapshot or trusted brand/industry/audience/questions metadata columns. `title` is the authorized associated article's real current `working_name`, not asserted to be an immutable title snapshot. Title, full frozen plain text and stored content hash enter a SHA-256 digest, so changes invalidate recognition state. All context metadata fields remain unknown; the model may extract supported text or provide marked suggestions. No nonexistent metadata is invented. The text model is not claimed to inspect image contents or HTML formatting.

Only the four shared fields are returned. Harmless additional JSON keys are discarded; known fields still pass shape, length and source validation independently. A valid field is preserved when another field is invalid or unknown. Brand/product must occur in the authorized title/body after conservative Unicode, whitespace and case normalization; unsupported brands remain unknown. Exact, relevant quotes can support article facts. Paraphrased or unsupported quotes are never displayed as verbatim evidence: otherwise usable audience/questions/industry remain marked inferred suggestions with safe reason codes. Inferred fields never become article facts. Industry accepts a canonical ID or one unambiguous exact name/full path from the complete current directory. Duplicate names, missing categories or an unavailable catalog leave only industry unknown. Questions may be a short array but are returned as editable newline-separated text. Missing, invalid and unmappable fields receive distinct bounded reason codes; raw provider errors are not displayed.

After the model returns, the route rechecks authorized scope, draft/version binding, actual content, connection revision and industry existence/name. Changed scope, content or connection discards the result; a removed/renamed industry is cleared without discarding valid unrelated fields. The browser must still reject a late result for a different active article and protect manual edits/clearing.

## Explicit limits and subsequent acceptance

Full body limit is 60,000 JavaScript string characters (UTF-16 code units), with a 2,000-character title safety cap. Oversized input is rejected before AI; no body truncation or partial-coverage success occurs. The shared directory supports up to 5,000 real entries and 20 hierarchy levels, retaining upstream decimal-string scope IDs. Identification scans the complete directory for literal names, character-bigram overlap and ancestor mentions, then sends at most 64 candidates within a 24,000-character serialized candidate budget. Boundary ties are omitted rather than resolved by original directory order. No first-500 truncation is used; final validation and name uniqueness check the whole directory. This conservative lexical retrieval may miss synonyms; that produces unknown industry and a manual selection path, not a fabricated match. Identification has a 45-second model deadline and 128 KiB upstream response cap. Incomplete/truncated/refused output is rejected; no automatic retry loop is introduced.

Both page tabs use this recognition. Empty historical saved values no longer protect blank fields; explicit manual clears and saved nonempty values remain protected. Task industry restoration is independent of the arrival order of the directory and the remaining fields. Canonical selection does not imply a recommendation dataset exists: generation validates the separate local mapping and reports `data_unavailable` without substituting a different industry. Recognition does not infer region, deadline, materials, brand sample or platform settings.

The added test sources cover output provenance, unknown/illegal industries, partial preservation, actual text/digest ownership, timeout, compatible transport, refusal/incomplete/oversized responses, authentication and binding failures, model changes, cross-origin/request-key rejection, late scope changes, no planner write, and error sanitization. They are **not executed**. ZCode should run module typechecks/tests/build after final merge; verify missing/incomplete config in the actual host; then use authorized test articles with the securely injected key to validate actual AiCore invocation, selected model availability, the four-field UI and late-response/manual-edit protection. Do not claim production availability before that acceptance.

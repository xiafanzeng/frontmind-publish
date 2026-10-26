# Publisher publication quantities v1

This module extension keeps the existing frozen-article draft, title configuration, provider worker and wallet settlement flow. It does not manufacture article versions, provider identities or prices.

## Trusted shared catalogue adapter

`publisher-source-matrix-catalog.ts` reads the same shared active catalogue as the customer media list. Its callers must already be authenticated publish customer routes. The catalogue currently has one customer price in CNY at scale 4; that known amount is preserved even when quote terms are incomplete. An amount with more than two meaningful decimals is not rounded into the planner's two-decimal contract. Platform/name/domain matches are not account identity proof.

Confirmed terms may arrive through the trusted catalogue import as `rawPayload.publisher_quote_v1` or `publisher_offers_v1`. Each offer declares `offer_id`, exact `publication_spec`, and `pricing` (`kind`, `amount`, `currency`, timezone-aware `quoted_at`/`valid_until`, explicit `mandatory_fees`). Optional declared limits and `allowed_purposes` are retained. Missing mandatory fees are unknown, never an empty list. No expiry or supplier identifier is inferred from the last sync timestamp or a filename.

The current provider takes a concrete resource number, not an arbitrary offer/spec override. Executable per-copy offers therefore additionally require `provider_execution: independent_unit_orders`, the exact `provider_resource_id` equal to that resource's external identifier, and the same current customer unit price. Multiple or ambiguous offers are not resolved by choosing the cheapest. Known packages can remain priced planning drafts; unsupported package execution is explicitly blocked instead of sending several unrelated unit orders.

The adapter supports shared quotes only. Offers with owner/user/tenant/project identifiers or private/account/tenant visibility are excluded; private negotiated quotations require a separately scoped trusted adapter. Explicit research mappings are forwarded only for `mapping_scope: shared_catalog`. Media semantic capability fields are whitelisted, and verified/unsupported image capability is read from the existing capability table. Unknown capability remains unknown.

## Draft and quantity identity

`mediaSnapshot.publication` is validated by `shared/publication-selection.ts`. It stores schema version, actual article and frozen version, resource, offer, specification, purpose, quantity, quantity meaning, exact unit/line amounts, quote fingerprint and originating task/plan/version. Local API output extensions preserve these fields without changing shared vendor contracts.

Only an explicit trusted `repeat_existing_article` intent permits a quantity above one, and the quote must explicitly allow repeats. A plan for three new articles remains pending real manuscript binding. Distinct real articles use the existing separate-draft/batch selection path; no placeholder article is created. One draft still supports one confirmed specification/offer per media; a second specification for the same media is reported as a conflict, never silently merged.

This planner version caps a single suggested item at 100 publications. This is an application limit, not a claim about the supplier's capacity; actual offer minimum/maximum quantities and specification limits must also pass.

Apply preview returns the **merged cart's known total**, including preserved manual rows; the plan's budget total is separate. Unknown legacy prices are counted as pending. Identical items are a no-op. An unlocked item from the same task and identical article/offer/spec/purpose may be explicitly revised to a new quantity; the new quantity replaces rather than accumulates. Manual rows, locked rows and other-origin or differing identities are preserved. Confirmation rejects partial/conflicting plans. Draft row locking and expected revision guard concurrent writes; all items are revalidated before the first write. Generic media refresh preserves the publication identity and cannot silently accept a changed quote. Changing the frozen article invalidates the old binding.

The cart transaction also locks the authenticated source-matrix task first and rechecks its complete business state and exact plan id/version. A concurrent budget update or cancellation cannot slip between the HTTP precheck and the cart write. A changed plan returns `plan_changed` before touching the draft.

## Migration and provider execution

Apply `module/schema/publication-quantity-v1.sql` once before multi-copy submission. It replaces only the provider-item `(batch_id,media_resource_id)` uniqueness rule with a normal lookup index. Existing records are unchanged; each real item retains its UUID and unique submission key. Draft uniqueness is unchanged. The preflight reports `QUANTITY_MIGRATION_REQUIRED` while the old unique index exists. Do not restore the old unique index after repeated-media rows exist without an explicit data migration.

Preflight, final submission and both worker submission guards re-read the same trusted offer, amount, fees, validity, constraints and frozen version. A quote change requires recombination and confirmation. Each repeat creates one real publisher item/job and one settlement allocation. `(unit price + per-unit fees)` is allocated to every copy; item-level fees are allocated once to copy zero. BigInt arithmetic makes the allocation sum exactly equal to the line total. The worker verifies copy index and allocation instead of incorrectly comparing a fee-inclusive copy charge to the bare catalogue unit price. Provider-reported-price mismatch audit is retained.

Existing draft submission idempotency returns the original batch for a replay. Each copy's submission key binds the batch, draft item, resource, copy index and full publication identity; worker retries reuse that real item. No quantity is passed to a provider endpoint that lacks quantity semantics, and no article ID is fabricated.

## Pending verification

Regression source covers exact allocations, missing fees, quote validity, duplicate offer ambiguity, unsupported package execution, explicit repeated-article intent, cart identity/conflicts, quantity revision and the worker fee guard. No tests, dependency installation, Skill generation, application startup, build, API call or deployment were executed in this Pro round. ZCode must apply the migration in the intended environment, execute the tests and validate real trusted terms, actual AI recommendations, multi-copy cart/title/preflight persistence and provider development-mode execution without real paid publication.

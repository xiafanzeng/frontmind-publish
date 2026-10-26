# Source matrix input contract

`validate_request(payload: dict, stage: str) -> list[dict]` accepts `matrix`, `budget`, or `both`. `validate_budget(budget: dict) -> list[dict]` checks the budget object. Both return an empty list for valid inputs; every error has `code`, `path`, and `message`. Paths use dot notation and list indices, e.g. `task.questions[0].text`. No input is mutated, no defaults become facts, and unknown fields are ignored by validation rather than interpreted.

`parse_money(value: str | int, currency: str) -> int` takes major currency units and returns exact minor units. Invalid input raises `ValueError`. Boolean, float, negative, exponent notation, NaN, Infinity, whitespace and excessive decimal places are rejected. Integer `800` means 800 major units, not 800 minor units. Supported precision is explicit: CNY/USD/EUR 2 decimal places; JPY 0. Unsupported currencies fail; no exchange conversion occurs. Output amounts at public boundaries must be decimal strings in major units; internal accounting uses these integer minor units.

## Task and stages

`task.industry` is a nonempty string. `task.questions` is a nonempty list of objects with nonempty string `question_id` and `text`. `priority` may be supplied explicitly; omission means equal priority and must never be inferred from list order. Its priority vocabulary is adapter-owned. Missing industry/questions produces field-path errors. `task_id` and `brand_id` may be absent in research mode. Website adapters must bind `tenant_id` on the server; the model must never choose it.

Optional `product`, `audience`, `regions`, `manuscript`, `requirements`, and `selected_items` remain supplied data. Missing regions do not imply nationwide; nationwide must be explicit. Missing manuscript implies `needs_manuscript_check`. Missing attributes remain limitations. Locked selected items must be retained downstream. No article quantity means no claim of complete task cost.

A budget is optional in `matrix` and `both`; missing budget permits matrix completion and downstream status `needs_budget`. The standalone `budget` stage requires a budget. A supplied budget is validated in every stage, but never influences matrix suitability or order. Budget stage downstream processing also requires a matrix snapshot, exact publication items, and current offers; this validator does not establish their accounting completeness.

## Budget

`budget` is an object with required `currency` and `total_cap`. Optional amounts are `exploration_cap`, `unit_price_min`, and `unit_price_max`. All amounts follow `parse_money`; all are nonnegative. Exploration cap cannot exceed total cap. Optional minimum price cannot exceed maximum price. `exploration_enabled`, if present, must be boolean.

Exploration is authorized downstream only when `exploration_enabled is True` AND an explicit positive `exploration_cap` exists. Missing, false, or zero allowances never authorize exploration. Enabled exploration with a missing cap is valid input for a nonexploration plan plus a request to supply the cap. Validation does not mutate the budget or enable exploration. Exploration spending is included in total spending: both caps apply independently. Currency-specific amount objects are unsupported; one budget uses a single explicit currency.

## Evidence and directory data

`citations` distinguish detail and aggregate via `data_kind`; preserve evidence/question/platform/model/answer-record/URL/source/domain/account/time/scope/source-type/version fields. Supplier claims are not observed citations. Aggregates retain their original units and scope and cannot be summed with detail. Missing evidence fields cannot be invented.

`industry_recommendations` preserve identity, applicability, basis, maintenance date and version. Recommendations are not citation facts. `catalog` preserves resource identity separately from offer identity, supplier, channel/account, publication status/forms/rules, pricing basis, quote dates, currency and mandatory fees. Name-only candidates do not become purchasable resources. Those downstream schemas and evidence/identity rules are validated by their dedicated stages; this module only validates the core task and budget boundary.

## Staged planner API / CLI (single decisions envelope)

`run(request: dict, decisions: dict | None, stage: str, previous_matrix: dict | None, as_of: str) -> dict` in `scripts/planner.py`. `as_of` is an explicit timezone-aware ISO timestamp. Stages: `matrix`, `budget`, `both`. `request` combines this core task/budget contract with `citations: list[dict]`, `scope: dict`, `identity_config: dict`, `industry_recommendations: list[dict]`, `catalog: list[dict]` and optional trusted `selected_items: list[dict]`. Top-level `tenant_id/task_id/brand_id` are adapter-owned snapshot bindings. Examples are entirely fictional.

The only AI decisions envelope is:

```json
{
  "matrix_decisions": {"items": [], "fit_order": []},
  "budget_plans": [{
    "strategy": "A meaningful strategy label",
    "reason_summary": "Why these explicit publications support this task",
    "items": [{"article_id":"a1","version":"v1","resource_id":"r1","offer_id":"o1","publication_spec":"text","quantity":1,"purpose":"standard"}]
  }]
}
```

Matrix decisions follow matrix-rules.md strictly; trusted status/identity/price fields cannot be submitted there. Each plan requires `strategy`, `reason_summary`, and `items`; optional explanatory `coverage`, `gaps`, `tradeoffs`, `unconfirmed_items` pass through as AI statements, never computed facts. No AI cost or readiness fields are accepted. Exact duplicate publication combinations (ignoring order and display metadata) merge into the first strategy. More than three distinct combinations returns `invalid_decisions`; scripts never invent combinations to reach three, optimize, call models, fetch URLs, or write shopping carts. Each returned plan is verified independently, including exploration authorization regardless of strategy name. `execution_recommended` requires both `ready_to_publish` and verified first-stage semantic decisions for every publication resource; see `semantic_ready` and `semantic_pending`. Undecided resources and retained locks keep their known prices and preflight states but cannot become execution recommendations.

```sh
python3 scripts/planner.py --input examples/request.json --decisions examples/decisions.json --stage both --as-of 2026-10-11T00:00:00Z --output /tmp/planner-result.json
python3 scripts/planner.py --input examples/request.json --decisions examples/decisions.json --stage matrix --as-of 2026-10-11T00:00:00Z --output /tmp/matrix.json
python3 scripts/planner.py --input examples/request.json --decisions examples/decisions.json --stage budget --matrix /tmp/matrix.json --as-of 2026-10-11T00:00:00Z --output /tmp/budget-result.json
```

`--decisions` is optional: missing semantic decisions returns `needs_ai_decisions` with candidates, no invented ranking. `matrix` does no budget verification; `both` permits no budget and returns `needs_budget` once the matrix is ready. `budget` requires budget and `--matrix` containing the complete prior planner output. It can omit `matrix_decisions` from the envelope; if supplied they must equal the snapshot's original decisions. `budget_plans` is always an explicit AI submission, not implicitly carried forward from a snapshot.

Budget-stage request must resend the full original trusted task, citations, evidence scope, identity config, industry recommendations, semantic catalog attributes and top-level binding IDs. Use the original `scope.input_snapshot` as an adapter baseline, then apply authorized budget/quote/selection updates. Omission is **not** a partial update or permission to inherit old facts: if it changes the semantic version/binding it returns `stale_matrix`. Current catalog is mandatory in practice when original catalog was nonempty; unchanged semantic facts with changed offers/prices/quote dates/offer specs/purpose allowances preserve version. Task/evidence/media semantic changes require a new matrix. Snapshot metadata is `snapshot={binding:{tenant_id,task_id,brand_id},matrix_decisions:{items,fit_order},generated_at:ISO}`; the trusted adapter may additionally supply `expires_at:ISO`, checked inclusively (expired only after it). No arbitrary TTL is inferred. There is no cryptographic snapshot signature; website adapters must store/provide authentic snapshots and tenant bindings.

Budget reuse rebuilds candidates and hard constraints from current trusted request, verifies the semantic version and binding, then reapplies the same semantic decisions/order. Snapshot candidate statuses are never trusted overrides. Current selected/locked items come from request and are retained by verify_plan; the planner never relaxes constraints to fit caps. Current pricing and preflight outcomes remain independent. A changed preflight changes the semantic snapshot and requires regeneration.

Output includes shared `plan_id`, `plan_version`, `matrix_version`, `matrix`, `source_analysis`, `budget_plans`, `selected_items`, `scope.input_snapshot`, `snapshot`, `errors`, and `report`. `report` is a direct deep-copied view of the same status/version/scope/evidence/matrix/plans/limitations/errors, with no independent numbers or invented chart data. Top-level `complete` means assembly finished; check each plan's `budget_feasible` and `ready_to_publish` for feasibility/readiness. Business failures (`stale_matrix`, `invalid_decisions`, `needs_matrix`, individual `no_feasible_plan`/`estimate`) are structured JSON. Core/nested structure errors return `invalid_input`; CLI exits 2, prints errors to stderr and preserves existing output. Valid business results exit 0 and replace the target atomically. Invalid JSON/stage, unreadable input and write errors also exit nonzero. API does not mutate inputs; a fixed `as_of` makes repeated calls deterministic.

Review corrections: AI budget publication choices accept exactly `article_id`, `version`, `resource_id`, `offer_id`, `publication_spec`, `quantity`, `purpose`. Any extra item key (including `locked`, monetary values, status/readiness and display metadata) returns `untrusted_item_field` with no verified plans. Lock state and retained trusted metadata come exclusively from request selections. Matrix nested type errors, including reason lists, roles and reference object fields, are input errors: CLI exits nonzero without replacing old output.

On budget snapshot reuse, `catalog[index]` attribute references are rebound through the old `scope.input_snapshot`: original resource_id and its entire nonprice attribute row must equal a current catalog row. Multiple equivalent offers may use the first current matching row because their semantic facts are identical. Catalog reordering/insertion of equivalent offers changes only reference coordinates; reasons, roles, evidence references and fit_order remain unchanged. No name-based match or inferred attribute equivalence occurs. New snapshot decisions contain current coordinates paired with current scope.input_snapshot. For subsequent reuse, omit matrix_decisions or submit that snapshot's stored decisions.


## Final review output additions

`plan_id = "plan-" + deterministic digest(tenant_id/task_id/brand_id)` identifies the planning task, not an individual strategy. Research input without task_id additionally includes its nonprice task fields in the identity. `plan_version` is a deterministic revision digest of the trusted request, validated matrix decisions, verified budget plans, status and matrix_version; price, budget or choice changes are distinguishable while fixed inputs repeat exactly. There is no random revision, cart idempotency key, synchronization or signature promise. Both fields appear identically in report. `matrix_version` remains insensitive to budget and pricing; domain and conflicting publication-date projections are canonically ordered across Python processes/hash seeds.

`warnings=[{code,path,message}]` includes nonblocking `exploration_cap_required` when exploration is enabled without a sublimit. Nonexploration plans remain valid. Report copies warnings and `minimum_known_cost` directly.

`minimum_known_cost={status,scope,currency,total_cost,total_cost_minor,funding_gap,funding_gap_minor,reason,items}` is a narrow proof, not optimization. `confirmed_for_declared_publications` is possible only with one catalog candidate, one unique complete unit-price offer, one explicit verified combination, declared manuscript IDs/versions, validated semantic relevance and no unresolved non-budget constraints. It proves only the listed quantities/publications (`scope=unique_candidate_offer_and_declared_publications`), not that they cover the entire task. Funding gap is max(0, cost-total_cap); exploration constraints remain independently visible in plan errors. Multiple candidates/offers/combinations, packages, ranges, missing declarations or incomplete fees produce `unproven`, null amounts and a reason. The minimum among three submitted plans is never treated as the global minimum.

Aggregate inputs and `{type:"aggregate",aggregate_id,usage:"industry_context"}` references follow evidence-rules.md and matrix-rules.md. They carry original scope/provenance independently of detail evidence IDs.

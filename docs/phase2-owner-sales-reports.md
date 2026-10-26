# Phase 2 Owner Sales Reports — Tech Lead Review

Status: implemented locally; stop for Tech Lead review before commit, deploy, or Railway changes.

## Architecture audit

- `Transaction.paymentStatus = SUCCESS` and `paidAt` are the completed-payment source of truth. A conflicting non-null `providerStatus` is rejected, while null is retained as a compatibility case for older records created before provider status was stored. `providerChargeId` is unique, and reconciliation returns early after success, so duplicated Opn webhooks do not create a second completed sale.
- One transaction represents one product from one slot, so one qualifying transaction equals one unit. There is no multi-quantity order field.
- Revenue comes from immutable `Transaction.amount`, never the current `Product.price`.
- New transactions snapshot the product name in `Transaction.productNameSnapshot`. The migration backfills existing rows with the best information available—the currently related product name—and report reads retain that relation as a fallback.
- Opn's authoritative `livemode` response is persisted as `providerLiveMode`. LIVE reports require it to be `true` and reject `chrg_test_` IDs. DEMO_TEST reports require it to be `false` and require a `chrg_test_` ID. The two modes are never combined.
- Existing employee sales/restock delivery remains in `line-notification.provider.ts`, uses `LINE_CHANNEL_ACCESS_TOKEN`, sends the same two sale cards or one restock card, and retains its existing durable attempted-at claims.
- The only existing machine ID is attached to kiosk workflow sessions. Transactions do not carry an authoritative machine ID, so the owner cards intentionally omit one. This is appropriate for the single-cabinet pilot; multi-machine reporting will require transaction-level machine identity.
- The deployed backend and PostgreSQL run on Railway, but the repository had no scheduled-job manifest. The minimal approach is two isolated Railway Cron services that use the same source and database without changing the web service.
- Scheduled jobs opt in with `--scheduled` and resolve their data source only from `OWNER_REPORT_SCHEDULED_DATA_MODE`. Existing manual LIVE and `--demo` commands ignore that variable, so a Cron setting cannot silently change an operator's manual command.

## Calculation and card design

All reporting periods use Asia/Bangkok calendar boundaries and start-inclusive/end-exclusive UTC queries. Daily covers the previous local day. Weekly covers the complete previous Monday through Sunday. A fixed UTC+07:00 conversion is valid for Thailand, which does not observe daylight-saving time.

Daily aggregation includes 06:00–10:00, 10:00–14:00, 14:00–18:00, 18:00–22:00, and an explicit 22:00–06:00 overnight band. Band revenue must reconcile to total revenue. Top products are ranked by units, then revenue, then name, then product ID. Equal time periods retain the displayed chronological order.

Weekly aggregation includes Monday through Sunday, average daily revenue over seven calendar days, best weekday, the same complete time bands, best product, and a data-derived observation. Fewer than three sales or fewer than two active days produces a neutral insufficient-data statement. Zero-sales periods have zero KPIs and no fabricated ranking or peak.

The daily Flex bubble uses the approved green theme and horizontal text bars. The weekly bubble uses the approved dark-blue theme and a seven-column weekday chart. Manual DEMO cards retain the prominent orange warning. Scheduled DEMO_TEST cards retain the test-value labels but remove that prominent banner and instead show the small footer `ข้อมูลจากระบบทดสอบ`. No employee notification builder was changed.

## Delivery safety and migration

The narrow migration adds:

- `Transaction.productNameSnapshot` for future historical labels.
- `Transaction.providerLiveMode` to distinguish real settlement from Opn Test Mode.
- A composite report query index on payment status and paid time.
- `SalesReportDelivery`, uniquely keyed by report type, data mode, and period start. It stores one UUID retry key and the exact serialized LINE payload for that delivery.

A report attempt persists its claim, UUID `X-Line-Retry-Key`, and exact serialized request body before calling LINE. `SENT` claims are never sent again; concurrent `SENDING` claims are skipped; transient failures and claims stale for 15 minutes reuse the stored key and byte-identical payload. A valid LINE 409 carrying `x-line-accepted-request-id` is recorded as previously accepted. Other 409s, invalid requests, authentication failures, and other non-transient errors move to `MANUAL_REVIEW` instead of retrying.

LINE retry keys are valid for 24 hours. An expiry sweep moves unresolved `SENDING` or `FAILED` rows to `MANUAL_REVIEW`; it never generates a new key or payload automatically. This prevents an uncertain old delivery from being rebroadcast as a new request. LINE acceptance still cannot guarantee recipient delivery.

Scheduled LIVE and DEMO_TEST jobs derive only the immediately previous day or previous complete week. Manual DEMO_TEST supports a strictly validated `--as-of=YYYY-MM-DD` so physical acceptance can select a completed Bangkok reporting period. Logs include report type, data mode, scheduled/manual state, ISO period, outcome, HTTP status, and LINE request IDs, but never a token or response body.

## Environment variables

- Existing employee account: `LINE_CHANNEL_ACCESS_TOKEN` (unchanged).
- New owner account: `LINE_OWNER_CHANNEL_ACCESS_TOKEN`.
- Shared database: `DATABASE_URL`.
- Scheduled selector: `OWNER_REPORT_SCHEDULED_DATA_MODE=LIVE|DEMO_TEST`. Missing, invalid, or differently cased values default visibly to LIVE and emit a warning.
- DEMO safety gate: `OWNER_REPORT_DEMO_ENABLED=true`. It remains required for manual DEMO commands and must also be set on a prototype Cron service whose scheduled selector is `DEMO_TEST`.

For scheduled execution, `OWNER_REPORT_SCHEDULED_DATA_MODE=DEMO_TEST` without the exact demo gate fails before a ledger claim or LINE call. Conversely, setting the demo gate on a scheduled job without the exact DEMO_TEST selector also fails. `--demo` and `--scheduled` are mutually exclusive. This makes partial or ambiguous DEMO configuration fail safely, while future production services can explicitly use LIVE.

Never put either token in Git, frontend variables, build output, or command arguments.

## Local preview and verification

From `backend/`, after applying the migration to the intended local database:

```text
npm run report:daily:preview
npm run report:weekly:preview
```

These commands calculate from the database and print the Flex JSON. Preview is the default and does not claim a delivery row or call LINE. Sending requires the explicit compiled `--send` scripts and should not be used during automated testing.

For a controlled Opn Test Mode demonstration, set `OWNER_REPORT_DEMO_ENABLED=true` only in the manual execution environment, then use:

```text
npm run report:daily:demo:preview -- --as-of=2026-10-23
npm run report:weekly:demo:preview -- --as-of=2026-10-26
npm run report:daily:demo:send -- --as-of=2026-10-23
npm run report:weekly:demo:send -- --as-of=2026-10-26
```

The date is optional and represents the Bangkok calendar date on which the normal job would run. Demo previews require `--demo` through the package script and the environment gate, but cannot send because the preview scripts omit `--send`. Demo cards retain the green Daily and blue Weekly themes while prominently showing `DEMO / TEST MODE` and `ข้อมูลทดสอบ — ไม่ใช่รายได้จริง`; totals are labeled as test transaction value.

To preview the same mode and presentation used by a scheduled prototype job, set both scheduled variables in that one shell and run:

```text
npm run report:daily:scheduled:preview
npm run report:weekly:scheduled:preview
```

Scheduled previews use the real previous Bangkok day/week and cannot accept `--as-of`. They create no delivery claim and make no LINE call. With DEMO_TEST selected, the card keeps test-value labels, removes the orange manual-demo banner, and displays only the discreet `ข้อมูลจากระบบทดสอบ` footer.

## Railway setup for Tech Lead approval

Do not change the existing web service. After review and deployment of the database migration, create two separate Railway Cron services from the same repository and deployment revision:

- Daily: cron `0 1 * * *`; root directory `/backend`; build command `npm ci && npm run build`; start command `npm run report:daily:scheduled:send`.
- Weekly: cron `0 1 * * 1`; root directory `/backend`; build command `npm ci && npm run build`; start command `npm run report:weekly:scheduled:send`.

Railway cron is UTC: 01:00 UTC is 08:00 Asia/Bangkok. Give both services the production `DATABASE_URL` and the SmartVendingOwner `LINE_OWNER_CHANNEL_ACCESS_TOKEN`. For the prototype, set `OWNER_REPORT_SCHEDULED_DATA_MODE=DEMO_TEST` and `OWNER_REPORT_DEMO_ENABLED=true` independently on both Cron services. Future production services set `OWNER_REPORT_SCHEDULED_DATA_MODE=LIVE` and leave the demo gate unset or false. Do not replace `LINE_CHANNEL_ACCESS_TOKEN`, and do not expose a public trigger endpoint. Configure failure alerts. A manual rerun retries only the same derived current period and remains protected by the delivery ledger.

Do not add `--demo` or `--as-of` to scheduled start commands. Do not use the older manual send scripts as Cron start commands. Build and preview commands cannot broadcast because only the send scripts include explicit `--send`. Configure the Cron restart policy as `NEVER`; allow the next controlled invocation to reclaim a transient failure using its stored LINE retry key and payload. Railway skips an occurrence while a previous Cron run is still active, and the job explicitly disconnects Prisma so it can exit.

Run `npm run migrate:deploy` once through the existing controlled web-service predeploy/release process before enabling either Cron service. Do not put migration or seed commands in a recurring job. The migration is wrapped in one PostgreSQL `BEGIN`/`COMMIT` transaction and is additive.

## Deployment and physical acceptance plan

1. Tech Lead reviews the migration, test evidence, diff, demo labeling, and retry-key behavior.
2. Restore a recent production backup to a disposable PostgreSQL database and run `npm run migrate:deploy` there. Verify row counts, transaction history, new columns, enum values, ledger indexes, and application startup.
3. Back up production PostgreSQL immediately before deployment; record the backup identifier, deployment revision, and current migration state.
4. Deploy the backend revision with employee and owner LINE variables separated; leave both Cron services disabled.
5. Run `npm run migrate:deploy` once and verify the new columns/table/indexes. A migration failure must stop deployment.
6. Confirm the existing employee OA still receives exactly two cards for one successful test vend and the existing restock card after one restock. Confirm the owner OA receives neither event.
7. Create real Opn Test Mode transactions through the kiosk and confirm them through Opn's test workflow. Do not synthesize successful database rows.
8. Run Daily and Weekly DEMO previews for approved `--as-of` dates. Inspect the labels, periods, totals, overnight reconciliation, zero-sales state, and weekly chart. Verify preview creates no ledger row and sends no LINE request.
9. Run each DEMO send once from a controlled manual environment. Verify the orange demo warning, `SENT` ledger state, retry key, payload snapshot, and request metadata. An immediate repeat must not broadcast again.
10. Verify LIVE previews exclude all test transactions and DEMO previews exclude all live transactions.
11. Exercise mocked/staging LINE timeout, same-key 409, invalid request, and authentication paths. Confirm only transient errors retry and expired uncertainty becomes `MANUAL_REVIEW`.
12. With both Cron services still disabled, set `OWNER_REPORT_SCHEDULED_DATA_MODE=DEMO_TEST` and `OWNER_REPORT_DEMO_ENABLED=true`, then run each scheduled preview. Confirm the Daily card covers the previous Bangkok day, the Weekly card covers the previous completed Monday–Sunday, the orange banner is absent, and `ข้อมูลจากระบบทดสอบ` is present in the footer.
13. Enable the Daily Cron, then Weekly Cron. Verify their next-run displays correspond to 01:00 UTC and monitor the first execution logs, selected `DEMO_TEST` mode, ledger row, and owner card.
14. Confirm an immediate rerun returns `ALREADY_SENT` or `BUSY` and does not create another LINE request. Confirm a service restart preserves the same ledger claim, retry key, and payload snapshot.

## Rollback procedure

1. Disable both Owner Cron services before changing mode or application revision.
2. To return to real settlement reporting, set `OWNER_REPORT_SCHEDULED_DATA_MODE=LIVE` on both services and remove or set `OWNER_REPORT_DEMO_ENABLED=false`. Preview both scheduled jobs and confirm their logged mode is LIVE before re-enabling them.
3. To roll back the code, keep the Cron services disabled and revert to the last compatible application revision. The existing ledger and transaction fields are additive and should remain in place; do not run a destructive down migration.
4. Restore the verified database backup only when a full database rollback is explicitly approved. Never delete DEMO_TEST ledger rows to force another send.

## Physical acceptance checklist

- Create purchases only through the real Opn Test Mode kiosk flow and wait for successful provider reconciliation.
- Confirm the scheduled Daily preview covers yesterday in Asia/Bangkok and includes only matching test charges.
- Confirm the scheduled Weekly preview covers the previous completed Monday–Sunday and reconciles its weekday and time-band totals.
- Confirm LIVE previews exclude those test charges and scheduled DEMO_TEST previews exclude any live charges.
- Confirm green Daily and blue Weekly styling, no orange DEMO banner, test-value wording, and the exact footer `ข้อมูลจากระบบทดสอบ`.
- Run at most one approved send per type/period. Verify LINE acceptance, `SENT` ledger state, one attempt, stored retry key, and payload snapshot before any retry decision.
- Confirm the employee Sale and Restock cards still use the employee OA and remain visually and behaviorally unchanged.
- Keep both Cron services disabled until all checks pass and the Tech Lead separately approves activation.

## Remaining limitations

- Existing transaction names were not historically snapshotted, so migration-time product names are the best available labels for old rows.
- Transactions lack cabinet identity; cards deliberately omit it until sales are authoritatively machine-scoped.
- LINE quota, recipient eligibility, network failure, and post-acceptance delivery are controlled by LINE and cannot be guaranteed by the application.
- A retry key prevents LINE from accepting the same request twice only within its 24-hour validity window. `MANUAL_REVIEW` rows require an operator to compare the ledger and LINE request records before any further action.
- No missed-period backfill policy is implemented.

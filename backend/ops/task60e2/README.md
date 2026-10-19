# Task 60-E.2 one-time prototype data migration

This operator-only workflow selectively copies the three products assigned to
physical slots 1–3, those three slots, and the four reviewed current employee
records. It never copies transactions, restock logs, kiosk sessions,
`faceEmbedding`, or Pi-local biometric templates.

The scripts are intentionally not referenced by `package.json`, Prisma seed,
deployment configuration, application startup, or migrations. Run them only
after Tech Lead approval from the repository root. The ignored `work/` directory
contains the temporary CSV payloads and must not be committed.

## Minimal runner

Run from the repository root in Windows PowerShell 5.1. `Prepare` performs only
read-only database checks and exports; it does not import. Supply the already
downloaded and SHA-256-verified backup file:

```powershell
.\backend\ops\task60e2\run-migration.ps1 -Mode Prepare -BackupPath 'C:\path\to\verified-backup.dump'
```

After Tech Lead approval of Prepare, run Import with the same backup. It
rechecks both databases and all prepared hashes, then requires the operator to
type exactly `IMPORT` before uploading the import inputs and executing the
existing transactional SQL. It never retries automatically.

```powershell
.\backend\ops\task60e2\run-migration.ps1 -Mode Import -BackupPath 'C:\path\to\verified-backup.dump'
```

The backup checksum confirms file integrity; it does not by itself prove that
the backup is restorable. The detailed manual commands below remain as an audit
reference for the operations performed by the runner.

## Required preconditions

1. Stop kiosk/admin writes for the maintenance window.
2. Confirm the checked-out revision matches the deployed schema.
3. Confirm the verified cloud pre-import backup exists on Windows, has a recorded
   checksum, and has an available restore procedure for the Railway plan.
4. Confirm the Pi's safe template-status endpoint reports a local template for
   each operational employee whose backend `faceRegistered` flag is true. Never
   copy or inspect template contents.
5. Confirm `railway status` names `smart-vending-cloud`, `production`, and
   `Postgres`. Have PostgreSQL client tools and Railway CLI 5.69.0 available. Do
   not place a database URL or password in command history or these files.

## Exact execution sequence (Windows PowerShell 5.1)

These commands copy SQL into the local PostgreSQL container. Export connections
are forced read-only. PostgreSQL writes UTF-8 CSV bytes inside Linux and
`docker cp` copies them unchanged; PowerShell never converts the CSV text.

```powershell
$ErrorActionPreference = 'Stop'
$repo = (Get-Location).Path
$ops = Join-Path $repo 'backend\ops\task60e2'
$work = Join-Path $ops 'work'
New-Item -ItemType Directory -Force -Path $work | Out-Null

$sourceSqlFiles = @(
  'source-preflight.sql',
  'export-products.sql',
  'export-slots.sql',
  'export-employees.sql'
)

docker exec smart-vending-postgres sh -lc 'set -eu; mkdir -p /tmp/task60e2'
if ($LASTEXITCODE -ne 0) { throw 'Could not create source staging directory.' }

foreach ($name in $sourceSqlFiles) {
  docker cp (Join-Path $ops $name) "smart-vending-postgres:/tmp/task60e2/$name"
  if ($LASTEXITCODE -ne 0) { throw "docker cp failed for $name." }
}

docker exec smart-vending-postgres sh -lc 'set -eu; export PGCLIENTENCODING=UTF8; export PGOPTIONS="-c default_transaction_read_only=on"; psql -X --set=ON_ERROR_STOP=on -U "$POSTGRES_USER" -d "$POSTGRES_DB" -f /tmp/task60e2/source-preflight.sql'
if ($LASTEXITCODE -ne 0) { throw 'SOURCE PREFLIGHT FAILED. Stop.' }
```

The preflight must report exactly `3` products, `3` slots, and `4` employees.
Any exception is a hard stop requiring Tech Lead review. Only then export:

```powershell
$exports = @(
  @{ Sql = 'export-products.sql'; Csv = 'products.csv' },
  @{ Sql = 'export-slots.sql'; Csv = 'slots.csv' },
  @{ Sql = 'export-employees.sql'; Csv = 'employees.csv' }
)

foreach ($item in $exports) {
  $command = 'set -eu; export PGCLIENTENCODING=UTF8; export PGOPTIONS="-c default_transaction_read_only=on"; rm -f /tmp/task60e2/' + $item.Csv + '.tmp; psql -X --set=ON_ERROR_STOP=on --quiet -U "$POSTGRES_USER" -d "$POSTGRES_DB" -f /tmp/task60e2/' + $item.Sql + ' > /tmp/task60e2/' + $item.Csv + '.tmp; mv /tmp/task60e2/' + $item.Csv + '.tmp /tmp/task60e2/' + $item.Csv
  docker exec smart-vending-postgres sh -lc $command
  if ($LASTEXITCODE -ne 0) { throw "SOURCE EXPORT FAILED for $($item.Csv). Stop." }

  docker cp ("smart-vending-postgres:/tmp/task60e2/" + $item.Csv) (Join-Path $work $item.Csv)
  if ($LASTEXITCODE -ne 0) { throw "docker cp failed for $($item.Csv). Stop." }
}

$csvFiles = @('products.csv', 'slots.csv', 'employees.csv')
foreach ($name in $csvFiles) {
  $file = Get-Item -LiteralPath (Join-Path $work $name)
  if ($file.Length -eq 0) { throw "$name is empty. Stop." }
  Get-FileHash -Algorithm SHA256 -LiteralPath $file.FullName
}
```

Do not use `Get-Content`, `Set-Content`, PowerShell output pipelines, or
PowerShell redirection for CSV data. Do not display or publish the employee CSV.

Confirm that the verified pre-import backup is available and restorable. Then
upload every SQL and CSV input to the absolute location referenced by
`target-import.sql` in the linked Railway PostgreSQL container:

```powershell
railway status
if ($LASTEXITCODE -ne 0) { throw 'Cannot confirm the linked Railway target.' }

railway ssh -- sh -lc 'set -eu; mkdir -p /tmp/task60e2'
if ($LASTEXITCODE -ne 0) { throw 'Could not create Railway staging directory.' }

$uploads = @(
  @{ Local = (Join-Path $ops 'target-preflight.sql'); Remote = '/tmp/task60e2/target-preflight.sql' },
  @{ Local = (Join-Path $ops 'target-import.sql'); Remote = '/tmp/task60e2/target-import.sql' },
  @{ Local = (Join-Path $ops 'post-import-verify.sql'); Remote = '/tmp/task60e2/post-import-verify.sql' },
  @{ Local = (Join-Path $work 'products.csv'); Remote = '/tmp/task60e2/products.csv' },
  @{ Local = (Join-Path $work 'slots.csv'); Remote = '/tmp/task60e2/slots.csv' },
  @{ Local = (Join-Path $work 'employees.csv'); Remote = '/tmp/task60e2/employees.csv' }
)

foreach ($item in $uploads) {
  railway service files upload $item.Local $item.Remote
  if ($LASTEXITCODE -ne 0) { throw "RAILWAY UPLOAD FAILED for $($item.Remote). Stop." }
}

railway ssh -- sh -lc 'set -eu; test -s /tmp/task60e2/target-preflight.sql; test -s /tmp/task60e2/target-import.sql; test -s /tmp/task60e2/post-import-verify.sql; test -s /tmp/task60e2/products.csv; test -s /tmp/task60e2/slots.csv; test -s /tmp/task60e2/employees.csv'
if ($LASTEXITCODE -ne 0) { throw 'Railway staging file missing or empty. Stop.' }

railway ssh -- sh -lc 'set -eu; export PGCLIENTENCODING=UTF8; psql -X --set=ON_ERROR_STOP=on -U "$POSTGRES_USER" -d "$POSTGRES_DB" -f /tmp/task60e2/target-preflight.sql'
if ($LASTEXITCODE -ne 0) { throw 'TARGET PREFLIGHT FAILED. Do not import.' }
```

The preflight must show zero rows in all six application tables. An exception,
missing or extra migration, non-empty table, or missing sequence is a hard stop.

Only after separately reconfirming the target backup and preflight, run:

```powershell
railway ssh -- sh -lc 'set -eu; export PGCLIENTENCODING=UTF8; psql -X --set=ON_ERROR_STOP=on -U "$POSTGRES_USER" -d "$POSTGRES_DB" -f /tmp/task60e2/target-import.sql'
if ($LASTEXITCODE -ne 0) { throw 'IMPORT FAILED AND MUST NOT BE TREATED AS SUCCESS. Stop.' }
Write-Host 'IMPORT SUCCEEDED; beginning read-only verification.'

railway ssh -- sh -lc 'set -eu; export PGCLIENTENCODING=UTF8; psql -X --set=ON_ERROR_STOP=on -U "$POSTGRES_USER" -d "$POSTGRES_DB" -f /tmp/task60e2/post-import-verify.sql'
if ($LASTEXITCODE -ne 0) { throw 'POST-IMPORT VERIFICATION FAILED. Stop writes and invoke the approved restore procedure.' }
Write-Host 'POST-IMPORT VERIFICATION SUCCEEDED.'
```

`ON_ERROR_STOP` makes psql exit nonzero for SQL, validation, or `\copy` errors;
`set -e` propagates that status through Railway SSH; PowerShell prints success
only after `$LASTEXITCODE` is zero. The import retains its transaction-scoped
advisory lock, table locks, staging validations, empty-target checks, foreign-key
protections, inserts without `ON CONFLICT`, `faceEmbedding = NULL`, and verified
identity and employee-code sequence updates.

Expected counts are `3` products, `3` slots, `4` employees, and zero transactions,
restocks, and sessions. Slot relationships must be 1→14, 2→13, and 3→10. Every
product must report an HTTPS image, and every employee must report an empty legacy
biometric column.

After database verification, run the already-approved read-only application and
Pi template-status checks. A database `faceRegistered` flag does not replace a
Pi-local template.

After acceptance, securely remove the three CSV files from the explicitly named
`backend/ops/task60e2/work/` directory. If post-commit verification fails, stop
application writes and restore the confirmed pre-import Railway volume backup;
do not attempt an ad hoc corrective seed or conflict update.

[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [ValidateSet('Prepare', 'Import')]
  [string]$Mode,

  [Parameter(Mandatory = $true)]
  [string]$BackupPath
)

Set-StrictMode -Version 2.0
$ErrorActionPreference = 'Stop'

$container = 'smart-vending-postgres'
$remoteDirectory = '/tmp/task60e2'
$workDirectory = Join-Path $PSScriptRoot 'work'
$manifestPath = Join-Path $workDirectory 'prepare-manifest.json'
$utf8Strict = New-Object System.Text.UTF8Encoding($false, $true)

function Invoke-Checked {
  param(
    [Parameter(Mandatory = $true)][string]$Program,
    [Parameter(Mandatory = $true)][string[]]$Arguments,
    [Parameter(Mandatory = $true)][string]$FailureMessage
  )

  & $Program @Arguments
  if ($LASTEXITCODE -ne 0) {
    throw $FailureMessage
  }
}

function Assert-File {
  param([Parameter(Mandatory = $true)][string]$Path)

  if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) {
    throw "Required file is missing: $Path"
  }
  if ((Get-Item -LiteralPath $Path).Length -eq 0) {
    throw "Required file is empty: $Path"
  }
}

function Get-CsvRows {
  param(
    [Parameter(Mandatory = $true)][string]$Path,
    [Parameter(Mandatory = $true)][string[]]$ExpectedHeader
  )

  Assert-File -Path $Path
  $bytes = [System.IO.File]::ReadAllBytes($Path)
  if ($bytes.Length -ge 3 -and $bytes[0] -eq 0xEF -and $bytes[1] -eq 0xBB -and $bytes[2] -eq 0xBF) {
    throw "UTF-8 BOM is not allowed: $Path"
  }
  $null = $utf8Strict.GetString($bytes)

  Add-Type -AssemblyName Microsoft.VisualBasic
  $parser = New-Object Microsoft.VisualBasic.FileIO.TextFieldParser -ArgumentList $Path, $utf8Strict, $false
  try {
    $parser.TextFieldType = [Microsoft.VisualBasic.FileIO.FieldType]::Delimited
    $parser.SetDelimiters(',')
    $parser.HasFieldsEnclosedInQuotes = $true
    $header = $parser.ReadFields()
    if (($header -join "`n") -ne ($ExpectedHeader -join "`n")) {
      throw "Unexpected CSV header: $Path"
    }

    $rows = @()
    while (-not $parser.EndOfData) {
      $row = $parser.ReadFields()
      if ($row.Count -ne $ExpectedHeader.Count) {
        throw "Unexpected CSV field count: $Path"
      }
      $rows += ,$row
    }
    return $rows
  }
  finally {
    $parser.Close()
  }
}

function Assert-PreparedCsvFiles {
  $productHeader = @('id', 'name', 'price', 'imageUrl', 'isActive', 'createdAt', 'updatedAt')
  $slotHeader = @('id', 'slotNumber', 'status', 'productId', 'createdAt', 'updatedAt')
  $employeeHeader = @('id', 'name', 'employeeCode', 'faceRegistered', 'isActive', 'offboardedAt', 'createdAt', 'updatedAt')

  $products = @(Get-CsvRows -Path (Join-Path $workDirectory 'products.csv') -ExpectedHeader $productHeader)
  $slots = @(Get-CsvRows -Path (Join-Path $workDirectory 'slots.csv') -ExpectedHeader $slotHeader)
  $employees = @(Get-CsvRows -Path (Join-Path $workDirectory 'employees.csv') -ExpectedHeader $employeeHeader)

  if ($products.Count -ne 3 -or $slots.Count -ne 3 -or $employees.Count -ne 4) {
    throw 'Prepared CSV row counts must be 3 products, 3 slots, and 4 employees.'
  }

  $expectedTemplateStatus = @{
    'EMP001' = $true
    'EMP002' = $true
    'EMP069' = $true
    'EMP070' = $false
  }
  foreach ($row in $employees) {
    $employeeCode = $row[2]
    if (-not $expectedTemplateStatus.ContainsKey($employeeCode)) {
      throw 'Employee set does not match the approved Pi template-status check.'
    }
    $databaseFlag = switch ($row[3].ToLowerInvariant()) {
      't' { $true }
      'true' { $true }
      'f' { $false }
      'false' { $false }
      default { throw 'An employee faceRegistered value is invalid.' }
    }
    if ($databaseFlag -ne $expectedTemplateStatus[$employeeCode]) {
      throw "faceRegistered does not match the known Pi template status for $employeeCode."
    }
  }

  Write-Host 'CSV validation PASS: 3 products, 3 slots, 4 employees; faceRegistered flags match the approved Pi status results.'
}

function Invoke-SourcePreflight {
  $sourceFiles = @('source-preflight.sql', 'export-products.sql', 'export-slots.sql', 'export-employees.sql')
  Invoke-Checked -Program 'docker' -Arguments @('exec', $container, 'sh', '-lc', "set -eu; mkdir -p $remoteDirectory") -FailureMessage 'Could not create the source staging directory.'
  foreach ($name in $sourceFiles) {
    Invoke-Checked -Program 'docker' -Arguments @('cp', (Join-Path $PSScriptRoot $name), "${container}:${remoteDirectory}/$name") -FailureMessage "Could not copy $name to the source container."
  }
  $command = "set -eu; export PGCLIENTENCODING=UTF8; export PGOPTIONS='-c default_transaction_read_only=on'; psql -X --set=ON_ERROR_STOP=on -U `"`$POSTGRES_USER`" -d `"`$POSTGRES_DB`" -f $remoteDirectory/source-preflight.sql"
  Invoke-Checked -Program 'docker' -Arguments @('exec', $container, 'sh', '-lc', $command) -FailureMessage 'SOURCE PREFLIGHT FAIL. Stop.'
}

function Invoke-TargetPreflight {
  Invoke-Checked -Program 'railway' -Arguments @('status') -FailureMessage 'Could not confirm the linked Railway target.'
  Invoke-Checked -Program 'railway' -Arguments @('ssh', '--', 'sh', '-lc', "set -eu; mkdir -p $remoteDirectory") -FailureMessage 'Could not create the Railway staging directory.'
  Invoke-Checked -Program 'railway' -Arguments @('service', 'files', 'upload', '--overwrite', (Join-Path $PSScriptRoot 'target-preflight.sql'), "$remoteDirectory/target-preflight.sql") -FailureMessage 'Could not upload target-preflight.sql.'
  $command = "set -eu; export PGCLIENTENCODING=UTF8; psql -X --set=ON_ERROR_STOP=on -U `"`$POSTGRES_USER`" -d `"`$POSTGRES_DB`" -f $remoteDirectory/target-preflight.sql"
  Invoke-Checked -Program 'railway' -Arguments @('ssh', '--', 'sh', '-lc', $command) -FailureMessage 'TARGET PREFLIGHT FAIL. Do not import.'
}

function Assert-Backup {
  $resolvedBackup = (Resolve-Path -LiteralPath $BackupPath).Path
  Assert-File -Path $resolvedBackup
  $backup = Get-Item -LiteralPath $resolvedBackup
  $hash = (Get-FileHash -Algorithm SHA256 -LiteralPath $resolvedBackup).Hash
  Write-Host "Backup SHA-256: $hash"
  Write-Warning 'A matching SHA-256 proves file integrity only; it does not prove the backup is restorable.'
  return @{ Name = $backup.Name; Length = $backup.Length; Sha256 = $hash }
}

function Invoke-Prepare {
  New-Item -ItemType Directory -Force -Path $workDirectory | Out-Null
  if (Test-Path -LiteralPath $manifestPath -PathType Leaf) {
    Remove-Item -LiteralPath $manifestPath -Force
  }
  $backup = Assert-Backup
  Invoke-SourcePreflight
  Invoke-TargetPreflight

  $exports = @(
    @{ Sql = 'export-products.sql'; Csv = 'products.csv' },
    @{ Sql = 'export-slots.sql'; Csv = 'slots.csv' },
    @{ Sql = 'export-employees.sql'; Csv = 'employees.csv' }
  )
  foreach ($item in $exports) {
    $command = "set -eu; export PGCLIENTENCODING=UTF8; export PGOPTIONS='-c default_transaction_read_only=on'; rm -f $remoteDirectory/$($item.Csv).tmp; psql -X --set=ON_ERROR_STOP=on --quiet -U `"`$POSTGRES_USER`" -d `"`$POSTGRES_DB`" -f $remoteDirectory/$($item.Sql) > $remoteDirectory/$($item.Csv).tmp; mv $remoteDirectory/$($item.Csv).tmp $remoteDirectory/$($item.Csv)"
    Invoke-Checked -Program 'docker' -Arguments @('exec', $container, 'sh', '-lc', $command) -FailureMessage "SOURCE EXPORT FAIL for $($item.Csv). Stop."
    Invoke-Checked -Program 'docker' -Arguments @('cp', "${container}:${remoteDirectory}/$($item.Csv)", (Join-Path $workDirectory $item.Csv)) -FailureMessage "Could not copy $($item.Csv) from the source container."
  }

  Assert-PreparedCsvFiles
  $csvHashes = @{}
  foreach ($name in @('products.csv', 'slots.csv', 'employees.csv')) {
    $csvHashes[$name] = (Get-FileHash -Algorithm SHA256 -LiteralPath (Join-Path $workDirectory $name)).Hash
  }
  $manifest = [ordered]@{
    preparedAtUtc = [DateTime]::UtcNow.ToString('o')
    backup = $backup
    csvSha256 = $csvHashes
    expectedCounts = @{ products = 3; slots = 3; employees = 4 }
  }
  [System.IO.File]::WriteAllText($manifestPath, ($manifest | ConvertTo-Json -Depth 4), (New-Object System.Text.UTF8Encoding($false)))
  Write-Host "PREPARE PASS. Manifest: $manifestPath"
  Write-Host 'No target import was executed.'
}

function Assert-PreparedManifest {
  Assert-File -Path $manifestPath
  $manifest = Get-Content -Raw -LiteralPath $manifestPath | ConvertFrom-Json
  $backup = Assert-Backup
  if ($backup.Name -ne $manifest.backup.Name -or $backup.Length -ne $manifest.backup.Length -or $backup.Sha256 -ne $manifest.backup.Sha256) {
    throw 'The backup does not match the file recorded during Prepare.'
  }
  Assert-PreparedCsvFiles
  foreach ($name in @('products.csv', 'slots.csv', 'employees.csv')) {
    $actual = (Get-FileHash -Algorithm SHA256 -LiteralPath (Join-Path $workDirectory $name)).Hash
    $expected = $manifest.csvSha256.PSObject.Properties[$name].Value
    if ($actual -ne $expected) {
      throw "Prepared file hash mismatch: $name"
    }
  }
}

function Invoke-Import {
  Assert-PreparedManifest
  Invoke-SourcePreflight
  Invoke-TargetPreflight

  $confirmation = Read-Host 'Type IMPORT to execute the one-time production import'
  if ($confirmation -cne 'IMPORT') {
    throw 'Import cancelled. Exact confirmation was not provided.'
  }

  $uploads = @(
    @{ Local = (Join-Path $PSScriptRoot 'target-import.sql'); Remote = "$remoteDirectory/target-import.sql" },
    @{ Local = (Join-Path $PSScriptRoot 'post-import-verify.sql'); Remote = "$remoteDirectory/post-import-verify.sql" },
    @{ Local = (Join-Path $workDirectory 'products.csv'); Remote = "$remoteDirectory/products.csv" },
    @{ Local = (Join-Path $workDirectory 'slots.csv'); Remote = "$remoteDirectory/slots.csv" },
    @{ Local = (Join-Path $workDirectory 'employees.csv'); Remote = "$remoteDirectory/employees.csv" }
  )
  foreach ($item in $uploads) {
    Invoke-Checked -Program 'railway' -Arguments @('service', 'files', 'upload', '--overwrite', $item.Local, $item.Remote) -FailureMessage "RAILWAY UPLOAD FAIL for $($item.Remote). Stop."
  }

  $importCommand = "set -eu; export PGCLIENTENCODING=UTF8; psql -X --set=ON_ERROR_STOP=on -U `"`$POSTGRES_USER`" -d `"`$POSTGRES_DB`" -f $remoteDirectory/target-import.sql"
  Invoke-Checked -Program 'railway' -Arguments @('ssh', '--', 'sh', '-lc', $importCommand) -FailureMessage 'IMPORT FAIL. It will not be retried automatically.'

  $verifyCommand = "set -eu; export PGCLIENTENCODING=UTF8; psql -X --set=ON_ERROR_STOP=on -U `"`$POSTGRES_USER`" -d `"`$POSTGRES_DB`" -f $remoteDirectory/post-import-verify.sql"
  Invoke-Checked -Program 'railway' -Arguments @('ssh', '--', 'sh', '-lc', $verifyCommand) -FailureMessage 'POST-IMPORT VERIFICATION FAIL. Stop writes and use the approved recovery procedure.'
  Write-Host 'IMPORT PASS. Post-import verification PASS.'
}

try {
  if ($Mode -eq 'Prepare') {
    Invoke-Prepare
  }
  else {
    Invoke-Import
  }
}
catch {
  [Console]::Error.WriteLine("${Mode} FAIL: $($_.Exception.Message)")
  exit 1
}

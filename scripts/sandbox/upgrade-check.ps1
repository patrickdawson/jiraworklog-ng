<#
.SYNOPSIS
  Read-only checks after installing the Tauri app (milestone 10 manual test).

.DESCRIPTION
  Run inside Windows Sandbox (scripts/sandbox/upgrade-test.wsb) after a test
  step of docs/tauri-migration.md, "Manual test: upgrade from Electron".
  It only reads files and the registry and prints PASS/FAIL per check.

  -Stage Electron   after installing the old Electron app (baseline)
  -Stage Tauri      after running the new installer
  -Autostart On|Off what the Electron app had before the upgrade

  Example:  powershell -ExecutionPolicy Bypass -File C:\jwl\scripts\upgrade-check.ps1 -Stage Tauri -Autostart On
#>
param(
  [ValidateSet("Electron", "Tauri")] [string] $Stage = "Tauri",
  [ValidateSet("On", "Off")] [string] $Autostart = "On"
)

$ErrorActionPreference = "Continue"
$fails = 0
function Check([string] $name, [bool] $ok, [string] $detail = "") {
  $tag = if ($ok) { "PASS" } else { "FAIL"; $script:fails++ }
  Write-Output ("{0}  {1}{2}" -f $tag, $name, $(if ($detail) { "  ($detail)" } else { "" }))
}
function RegValue([string] $key, [string] $name) {
  $p = Get-ItemProperty -Path $key -Name $name -ErrorAction SilentlyContinue
  if ($p) { return $p.$name } else { return $null }
}
function LinkTarget([string] $path) {
  if (-not (Test-Path $path)) { return $null }
  return (New-Object -ComObject WScript.Shell).CreateShortcut($path).TargetPath
}

$electronDir = Join-Path $env:LOCALAPPDATA "Programs\jiraworklog-ng"
$electronExe = Join-Path $electronDir "JiraWorklog.exe"
$tauriExe = Join-Path $env:LOCALAPPDATA "JiraWorklog\jiraworklog.exe"
$dataDir = Join-Path $env:APPDATA "jiraworklog-ng"
$run = "HKCU:\Software\Microsoft\Windows\CurrentVersion\Run"
$approved = "HKCU:\Software\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\Run"
$uninst = "HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall"
$electronGuid = "3783ec4d-f952-5b31-97fe-6e1b5df3490b"
$startLink = Join-Path $env:APPDATA "Microsoft\Windows\Start Menu\Programs\JiraWorklog.lnk"
$deskLink = Join-Path ([Environment]::GetFolderPath("Desktop")) "JiraWorklog.lnk"
$oldRun = RegValue $run "electron.app.JiraWorklog"
$newRun = RegValue $run "JiraWorklog"

Write-Output "== Stage $Stage, autostart before upgrade: $Autostart =="

if ($Stage -eq "Electron") {
  Check "Electron exe installed" (Test-Path $electronExe) $electronExe
  Check "Electron uninstall entry" (Test-Path "$uninst\$electronGuid")
  Check "Start menu link -> Electron" ((LinkTarget $startLink) -eq $electronExe) (LinkTarget $startLink)
  Check "Desktop link -> Electron" ((LinkTarget $deskLink) -eq $electronExe) (LinkTarget $deskLink)
  if ($Autostart -eq "On") {
    Check "Run electron.app.JiraWorklog set" ($null -ne $oldRun) "$oldRun"
  } else {
    Check "Run electron.app.JiraWorklog not set" ($null -eq $oldRun) "$oldRun"
  }
  Check "Database exists" (Test-Path (Join-Path $dataDir "jiraworklog.db"))
} else {
  Check "Electron folder gone" (-not (Test-Path $electronDir)) $electronDir
  Check "Electron uninstall entry gone" (-not (Test-Path "$uninst\$electronGuid"))
  Check "Electron install key gone" (-not (Test-Path "HKCU:\Software\$electronGuid"))
  Check "Tauri exe installed" (Test-Path $tauriExe) $tauriExe
  $u = Get-ItemProperty "$uninst\JiraWorklog" -ErrorAction SilentlyContinue
  Check "Tauri uninstall entry" ($null -ne $u) "$($u.DisplayName) $($u.DisplayVersion) $($u.Publisher)"
  Check "Start menu link -> Tauri" ((LinkTarget $startLink) -eq $tauriExe) (LinkTarget $startLink)
  Check "Desktop link -> Tauri" ((LinkTarget $deskLink) -eq $tauriExe) (LinkTarget $deskLink)
  Check "Run electron.app.JiraWorklog removed" ($null -eq $oldRun) "$oldRun"
  if ($Autostart -eq "On") {
    # tauri-plugin-autostart (auto-launch 0.6): unquoted path + one space, no args.
    Check "Run JiraWorklog = plugin format" ($newRun -ceq "$tauriExe ") "[$newRun]"
    $bytes = RegValue $approved "JiraWorklog"
    if ($null -ne $bytes) {
      Check "StartupApproved JiraWorklog enabled" (($bytes[0] -eq 2) -and (($bytes | Select-Object -Last 8 | Measure-Object -Sum).Sum -eq 0)) (($bytes | ForEach-Object { "{0:X2}" -f $_ }) -join " ")
    } else {
      Write-Output "INFO  no StartupApproved value for JiraWorklog (key missing is fine)"
    }
  } else {
    Check "Run JiraWorklog not set" ($null -eq $newRun) "[$newRun]"
  }
  Check "Database kept" (Test-Path (Join-Path $dataDir "jiraworklog.db"))
  $backups = @(Get-ChildItem $dataDir -Filter "jiraworklog.db.backup-electron-*" -ErrorAction SilentlyContinue)
  Check "Electron backup made" ($backups.Count -ge 1) (($backups | ForEach-Object Name) -join ", ")
  $log = Join-Path $dataDir "upgrade.log"
  if (Test-Path $log) { Write-Output "-- upgrade.log --"; Get-Content $log | Write-Output }
  else { Check "upgrade.log written" $false $log }
}

Write-Output "-- JiraWorklog processes (by path) --"
Get-CimInstance Win32_Process | Where-Object { $_.ExecutablePath -like "*JiraWorklog*" } |
  ForEach-Object { Write-Output ("{0}  {1}" -f $_.ProcessId, $_.ExecutablePath) }
Write-Output "== $fails failed =="

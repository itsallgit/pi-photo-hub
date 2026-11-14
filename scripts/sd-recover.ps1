<#
 sd-recover.ps1 - Reset the Pi login password and enable SSH by editing the
 SD card's boot partition from Windows. No Pi access needed.

 Usage:  powershell -File scripts\sd-recover.ps1 -Drive G
 Then put the SD card in the Pi and power on. It reboots once by itself (~2 min).
 The password is stored base64-encoded in a file that deletes itself after running.
#>
param([Parameter(Mandatory)][string]$Drive)

$root = "$($Drive.TrimEnd(':')):\"
if (-not (Test-Path "$root\cmdline.txt")) { throw "$root does not look like a Pi boot partition (no cmdline.txt)" }

$sec = Read-Host "New password for the Pi user" -AsSecureString
$pw  = [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($sec))
if (-not $pw) { throw "Empty password" }

$tpl = (Get-Content "$PSScriptRoot\sd-firstrun.sh.template" -Raw) `
  -replace '__PW_B64__', [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($pw))
# Linux needs LF line endings, no BOM
[IO.File]::WriteAllText("$root\firstrun.sh", ($tpl -replace "`r`n","`n"), (New-Object Text.UTF8Encoding $false))

$cmd = (Get-Content "$root\cmdline.txt" -Raw).Trim()
if ($cmd -notmatch 'systemd\.run=') {
  $cmd += ' systemd.run=/boot/firmware/firstrun.sh systemd.run_success_action=reboot systemd.unit=kernel-command-line.target'
  [IO.File]::WriteAllText("$root\cmdline.txt", $cmd + "`n", (New-Object Text.UTF8Encoding $false))
}
Write-Host "Done. Eject $root, put the card in the Pi, power on and wait ~2-3 min."
Write-Host "Then find the Pi's IP (Deco app client list, or scripts\find-pi.ps1) and: ssh <user>@<ip>"

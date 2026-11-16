# find-pi.ps1 - Find the Pi on the LAN when you don't know its IP.
# Sweeps this PC's subnet (/22 worth) for hosts with SSH (port 22) open. Read-only (TCP connects only).
# Works in the built-in Windows PowerShell 5.1 and in PowerShell 7 (backlog B14): it starts the
# connects asynchronously in batches instead of using ForEach-Object -Parallel (PowerShell 7 only).
#   powershell -File scripts\find-pi.ps1      or      pwsh -File scripts\find-pi.ps1
$mine = (Get-NetIPAddress -AddressFamily IPv4 | Where-Object { $_.PrefixOrigin -eq 'Dhcp' } | Select-Object -First 1).IPAddress
if (-not $mine) { Write-Host "No DHCP IPv4 address on this PC: is it on the network?"; exit 1 }
$pre = ($mine -split '\.')[0..1] -join '.'; $third = [int](($mine -split '\.')[2]); $start = $third - ($third % 4)
Write-Host "Sweeping $pre.$start.0 - $pre.$($start+3).255 for SSH..."
$hosts = foreach ($t in $start..($start + 3)) { foreach ($n in 1..254) { "$pre.$t.$n" } }
$found = @()
for ($i = 0; $i -lt $hosts.Count; $i += 254) {
  $batch = $hosts[$i..([Math]::Min($i + 253, $hosts.Count - 1))]
  $pending = foreach ($h in $batch) {
    $c = New-Object Net.Sockets.TcpClient
    try { [pscustomobject]@{ Host = $h; Client = $c; Async = $c.BeginConnect($h, 22, $null, $null) } } catch { $c.Close() }
  }
  Start-Sleep -Milliseconds 700
  foreach ($p in $pending) {
    if ($p.Async.IsCompleted -and $p.Client.Connected) { $found += $p.Host }
    $p.Client.Close()
  }
}
if ($found) { Write-Host "SSH open on: $($found -join ', ')  (Pi MACs in 'arp -a' start b8-27-eb / dc-a6-32 / d8-3a-dd / e4-5f-01 / 2c-cf-67)" }
else { Write-Host "Nothing found. Is the Pi powered, on the same network, and SSH enabled?" }

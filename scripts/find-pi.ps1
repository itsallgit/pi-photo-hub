# find-pi.ps1 - Find the Pi on the LAN when you don't know its IP.
# Sweeps this PC's subnet (/22 worth) for hosts with SSH (port 22) open.
$mine = (Get-NetIPAddress -AddressFamily IPv4 | Where-Object { $_.PrefixOrigin -eq 'Dhcp' } | Select-Object -First 1).IPAddress
$pre = ($mine -split '\.')[0..1] -join '.'; $third = [int](($mine -split '\.')[2]); $start = $third - ($third % 4)
Write-Host "Sweeping $pre.$start.0 - $pre.$($start+3).255 for SSH..."
$found = $start..($start+3) | ForEach-Object { $t=$_; 1..254 | ForEach-Object { "$pre.$t.$_" } } |
  ForEach-Object -ThrottleLimit 150 -Parallel {
    $c = New-Object Net.Sockets.TcpClient
    try { $a=$c.BeginConnect($_,22,$null,$null); if ($a.AsyncWaitHandle.WaitOne(300) -and $c.Connected) { $_ } } catch {}
    $c.Close()
  }
if ($found) { Write-Host "SSH open on: $($found -join ', ')  (Pi MACs in 'arp -a' start b8-27-eb / dc-a6-32 / d8-3a-dd / e4-5f-01 / 2c-cf-67)" }
else { Write-Host "Nothing found. Is the Pi powered, on the same network, and SSH enabled?" }

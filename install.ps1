# Houston Kart Sim installer for Windows: downloads the latest release and installs it for the current user.
$ErrorActionPreference = 'Stop'
$repo = '4d1t-Codezz/houston-kart-sim'
$url = "https://github.com/$repo/releases/latest/download/Houston-Kart-Sim-Setup.exe"
$out = Join-Path $env:TEMP 'Houston-Kart-Sim-Setup.exe'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
$ProgressPreference = 'SilentlyContinue'
Write-Host 'Downloading Houston Kart Sim...'
Invoke-WebRequest -Uri $url -OutFile $out -UseBasicParsing
Write-Host 'Installing...'
Start-Process -FilePath $out -ArgumentList '/S' -Wait
Remove-Item $out -ErrorAction SilentlyContinue
$exe = Join-Path $env:LOCALAPPDATA 'Programs\houston-kart-sim\Houston Kart Sim.exe'
if (Test-Path $exe) { Start-Process $exe }
Write-Host 'Done. Houston Kart Sim is in your Start menu and on your desktop.'

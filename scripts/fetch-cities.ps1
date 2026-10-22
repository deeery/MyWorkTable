# 从中国天气网拉取全量三级城市数据，生成 public/plugins/weather/cities.json
# 数据源：http://www.weather.com.cn/data/city3jdata/
#   省份   china.html
#   城市   provshi/{省码}.html      如 provshi/10119.html
#   区县   station/{市码}.html      如 station/1011901.html
# 完整区域代码 = 省码(5) + 市码(2) + 区码(2)，如 101190101
#
# 注意 1：接口返回 UTF-8 但未声明 charset，必须显式按 UTF-8 解码
# 注意 2：少数城市的 station 接口直接返回 9 位完整码（海南、荆州、通辽等），
#         而非 2 位序号，此时不能再拼接市码前缀——见 $dCode 的判定

$ErrorActionPreference = 'Stop'
$base = 'http://www.weather.com.cn/data/city3jdata'
$outFile = Join-Path (Split-Path $PSScriptRoot -Parent) 'public\plugins\weather\cities.json'

function Get-Json($url) {
  $wc = New-Object System.Net.WebClient
  $wc.Headers.Add('User-Agent', 'Mozilla/5.0')
  $txt = [System.Text.Encoding]::UTF8.GetString($wc.DownloadData($url))
  if ([string]::IsNullOrWhiteSpace($txt)) { return $null }
  return $txt | ConvertFrom-Json
}

function Props($obj) {
  if ($null -eq $obj) { return @() }
  return @($obj.PSObject.Properties)
}

$provinces = @()
$provinceList = Get-Json "$base/china.html"
$pi = 0
foreach ($pv in Props $provinceList) {
  $pi++
  $pCode = $pv.Name
  $pName = $pv.Value
  Write-Output "[$pi/34] $pName ($pCode)"

  $cities = @()
  $cityList = $null
  try { $cityList = Get-Json "$base/provshi/$pCode.html" } catch { }
  foreach ($cv in Props $cityList) {
    $cCode = "$pCode$($cv.Name)"
    $cName = $cv.Value

    $districts = @()
    $distList = $null
    try { $distList = Get-Json "$base/station/$cCode.html" } catch { }
    foreach ($dv in Props $distList) {
      $dKey = "$($dv.Name)"
      $dCode = if ($dKey -match '^\d{9}$') { $dKey } else { "$cCode$dKey" }
      $districts += [pscustomobject]@{ code = $dCode; name = $dv.Value }
    }
    # 无下级区县时，市本身即可查询
    if ($districts.Count -eq 0) {
      $districts += [pscustomobject]@{ code = "${cCode}00"; name = $cName }
    }
    $cities += [pscustomobject]@{ code = $cCode; name = $cName; districts = $districts }
  }
  $provinces += [pscustomobject]@{ code = $pCode; name = $pName; cities = $cities }
}

# 自检：所有市码必须 7 位、区县码必须 9 位，否则拒绝写出
$bad = @()
$cityCount = 0
$distCount = 0
foreach ($p in $provinces) {
  foreach ($c in $p.cities) {
    $cityCount++
    if ($c.code.Length -ne 7) { $bad += "city $($p.name)/$($c.name)=$($c.code)" }
    foreach ($d in $c.districts) {
      $distCount++
      if ($d.code.Length -ne 9) { $bad += "district $($p.name)/$($c.name)/$($d.name)=$($d.code)" }
    }
  }
}
if ($bad.Count -gt 0) {
  Write-Output "VALIDATION FAILED ($($bad.Count)):"
  $bad | Select-Object -First 20 | ForEach-Object { Write-Output "  $_" }
  throw "city code validation failed"
}

$out = [pscustomobject]@{ generatedAt = (Get-Date -Format 'yyyy-MM-dd'); provinces = $provinces }
$json = $out | ConvertTo-Json -Depth 8 -Compress
[System.IO.File]::WriteAllText($outFile, $json, (New-Object System.Text.UTF8Encoding($false)))

Write-Output "DONE provinces=$($provinces.Count) cities=$cityCount districts=$distCount bytes=$((Get-Item $outFile).Length)"

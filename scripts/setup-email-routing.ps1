<#
.SYNOPSIS
  Turn on Cloudflare Email Routing for the zone: DNS records, a verified
  destination address, and a forwarding rule. Idempotent — safe to re-run.

.DESCRIPTION
  This unblocks two things at once:
    1. hello@<zone> forwarding to your inbox
    2. the site's contact form — the Worker's `send_email` binding refuses to
       send until its destination address is a VERIFIED Email Routing address

  The one step no API can do for you is clicking the verification link
  Cloudflare emails to the destination. Run this, click the link, run it again.

.PARAMETER Destination
  Where mail is forwarded. Must match `destination_address` in wrangler.jsonc,
  or the contact form will keep failing.

.NOTES
  Token needs: Zone:Read, DNS:Edit, Email Routing Rules:Edit (zone) and
  Email Routing Addresses:Edit (account).
  The token is read into memory only — never echoed, never written to disk,
  never passed on a command line where it would land in your shell history.
#>
[CmdletBinding()]
param(
  [string]$Zone        = 'viberuler.dev',
  [string]$Destination = 'mamaev.sasha@gmail.com',
  [string]$LocalPart   = 'hello'
)

$ErrorActionPreference = 'Stop'
$API = 'https://api.cloudflare.com/client/v4'

# --- token: prompted, never printed -----------------------------------------
$secure = Read-Host -Prompt 'Cloudflare API token' -AsSecureString
$token  = [Runtime.InteropServices.Marshal]::PtrToStringBSTR(
            [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure))
if (-not $token) { throw 'No token entered.' }
$headers = @{ Authorization = "Bearer $token"; 'Content-Type' = 'application/json' }

function Invoke-CF {
  param([string]$Method, [string]$Path, $Body)
  # NOT $args — that is an automatic variable and splatting it here is a trap.
  $req = @{ Method = $Method; Uri = "$API$Path"; Headers = $headers }
  if ($null -ne $Body) { $req.Body = ($Body | ConvertTo-Json -Depth 8 -Compress) }
  try {
    return Invoke-RestMethod @req
  } catch {
    # Cloudflare puts the real reason in the body, not the status line.
    $detail = $_.ErrorDetails.Message
    if ($detail) {
      try   { $j = $detail | ConvertFrom-Json; $msg = ($j.errors | ForEach-Object { "$($_.code): $($_.message)" }) -join '; ' }
      catch { $msg = $detail }
    } else { $msg = $_.Exception.Message }
    return [pscustomobject]@{ success = $false; errorText = $msg }
  }
}

function Step($n, $text) { Write-Host "`n[$n] $text" -ForegroundColor Cyan }

# --- 0. who am I ------------------------------------------------------------
Step 0 'Verifying token'
$v = Invoke-CF GET '/user/tokens/verify'
if (-not $v.success) { throw "Token rejected: $($v.errorText)" }
Write-Host '    token OK' -ForegroundColor Green

# --- 1. zone ----------------------------------------------------------------
Step 1 "Looking up zone $Zone"
$z = Invoke-CF GET "/zones?name=$Zone"
if (-not $z.success -or -not $z.result) {
  throw "Zone not found (needs Zone:Read on this token): $($z.errorText)"
}
$zoneId    = $z.result[0].id
$accountId = $z.result[0].account.id
Write-Host "    zone $zoneId / account $accountId" -ForegroundColor Green

# --- 2. enable routing + create the MX/SPF records --------------------------
# POST /email/routing/dns is the one that also ADDS AND LOCKS the DNS records.
# POST /email/routing/enable only flips the flag and assumes DNS is already there.
Step 2 'Enabling Email Routing (adds + locks MX and SPF)'
$settings = Invoke-CF GET "/zones/$zoneId/email/routing"
if ($settings.success -and $settings.result.enabled) {
  Write-Host '    already enabled — skipping' -ForegroundColor DarkGray
} else {
  $en = Invoke-CF POST "/zones/$zoneId/email/routing/dns" @{ name = $Zone }
  if ($en.success) { Write-Host '    enabled, DNS written' -ForegroundColor Green }
  else             { Write-Host "    ! $($en.errorText)" -ForegroundColor Yellow }
}

# --- 3. destination address (this is what sends the verification email) ------
Step 3 "Registering destination $Destination"
$addrs   = Invoke-CF GET "/accounts/$accountId/email/routing/addresses"
$existing = $addrs.result | Where-Object { $_.email -eq $Destination }

if (-not $existing) {
  $created = Invoke-CF POST "/accounts/$accountId/email/routing/addresses" @{ email = $Destination }
  if ($created.success) { Write-Host '    created — verification email sent' -ForegroundColor Green }
  else                  { throw "Could not add destination: $($created.errorText)" }
  $verified = $false
} else {
  $verified = [bool]$existing.verified
  Write-Host "    already registered (verified: $verified)" -ForegroundColor DarkGray
}

if (-not $verified) {
  Write-Host "`n  ==> ACTION REQUIRED: open $Destination and click Cloudflare's" -ForegroundColor Yellow
  Write-Host '      verification link, then run this script again.' -ForegroundColor Yellow
  Write-Host '      The forwarding rule cannot be created until it is verified.' -ForegroundColor Yellow
  exit 0
}

# --- 4. the forwarding rule -------------------------------------------------
$address = "$LocalPart@$Zone"
Step 4 "Routing $address -> $Destination"
$rules = Invoke-CF GET "/zones/$zoneId/email/routing/rules"
$already = $rules.result | Where-Object {
  $_.matchers | Where-Object { $_.type -eq 'literal' -and $_.value -eq $address }
}
if ($already) {
  Write-Host '    rule already exists — skipping' -ForegroundColor DarkGray
} else {
  $rule = Invoke-CF POST "/zones/$zoneId/email/routing/rules" @{
    name     = "$address -> $Destination"
    enabled  = $true
    priority = 0
    matchers = @(@{ type = 'literal'; field = 'to'; value = $address })
    actions  = @(@{ type = 'forward'; value = @($Destination) })
  }
  if ($rule.success) { Write-Host '    rule created' -ForegroundColor Green }
  else               { throw "Could not create rule: $($rule.errorText)" }
}

Write-Host "`nDone." -ForegroundColor Green
Write-Host "  $address now forwards to $Destination"
Write-Host "  The contact form can send too: its destination is verified."
Write-Host "  Test: send a mail to $address, then submit the form on the site."

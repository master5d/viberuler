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
# A pasted token routinely arrives wrapped in quotes or with a stray newline —
# which fails as "Invalid API Token" and looks like a permissions problem.
$token = $token.Trim().Trim('"').Trim("'")
if (-not $token) { throw 'No token entered.' }

# The length is not a secret, and it is the fastest way to catch a bad paste:
# a Cloudflare API token is 40 characters. A Global API Key (37, hex) will NOT
# work here — this script speaks Bearer tokens only.
Write-Host ("    token received: {0} chars" -f $token.Length) -ForegroundColor DarkGray
if ($token.Length -ne 40) {
  Write-Host '    ! expected 40 chars — if you pasted a Global API Key, create an API *token* instead' -ForegroundColor Yellow
}

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

# --- 0. who am I (advisory only) --------------------------------------------
# /user/tokens/verify only answers for USER-owned tokens. An account-owned token
# — the kind you get from Account > API tokens — returns "1000: Invalid API
# Token" here while being perfectly valid for the calls we actually make. So this
# is a hint, never a gate: the zone lookup below is the real test.
Step 0 'Checking token (advisory)'
$v = Invoke-CF GET '/user/tokens/verify'
if ($v.success) {
  Write-Host '    user-owned token, verified' -ForegroundColor Green
} else {
  Write-Host "    verify says: $($v.errorText)" -ForegroundColor DarkGray
  Write-Host '    (normal for an account-owned token — continuing)' -ForegroundColor DarkGray
}

# --- 1. zone — this is the real gate ----------------------------------------
Step 1 "Looking up zone $Zone"
$z = Invoke-CF GET "/zones?name=$Zone"
if (-not $z.success) {
  throw @"
Cloudflare rejected the zone lookup: $($z.errorText)

If this says Invalid API Token, the token itself is wrong (bad paste, expired,
or revoked). If it says something about permissions, the token is real but is
missing one of:
  Zone   -> Zone                 -> Read
  Zone   -> DNS                  -> Edit
  Zone   -> Email Routing Rules  -> Edit
  Account-> Email Routing Addresses -> Edit
and Zone Resources must include $Zone.
"@
}
if (-not $z.result) { throw "Token works, but zone '$Zone' is not in its Zone Resources." }
$zoneId    = $z.result[0].id
$accountId = $z.result[0].account.id
Write-Host "    zone $zoneId / account $accountId" -ForegroundColor Green

# --- 2. the DNS records — the thing that actually decides spam vs inbox ------
# A zone can report enabled:true while carrying ZERO mail records: someone
# flipped it on in the dashboard and never onboarded DNS. That is exactly what
# happened here — no MX, no SPF, no DKIM — so hello@ silently received nothing
# and everything the Worker sent went to spam, because Gmail could not verify
# that the domain authorises mail claiming to come from it.
#
# So never trust `enabled`. Ask Cloudflare which records it REQUIRES, compare
# against what the zone actually has, and add what's missing.
Step 2 'Reconciling Email Routing DNS (MX + SPF + DKIM)'
$en = Invoke-CF POST "/zones/$zoneId/email/routing/dns" @{ name = $Zone }
if ($en.success) {
  Write-Host '    enabled — Cloudflare wrote and locked the records' -ForegroundColor Green
} else {
  Write-Host "    enable said: $($en.errorText)" -ForegroundColor DarkGray
}

$need = Invoke-CF GET "/zones/$zoneId/email/routing/dns"
$required = @($need.result.record)
if (-not $required) { $required = @($need.result) }   # shape differs by account

$have = Invoke-CF GET "/zones/$zoneId/dns_records?per_page=100"
$added = 0
foreach ($r in $required) {
  if (-not $r.type) { continue }
  $exists = $have.result | Where-Object {
    $_.type -eq $r.type -and $_.name -eq $r.name -and $_.content -eq $r.content
  }
  if ($exists) {
    Write-Host "    ok   $($r.type) $($r.name)" -ForegroundColor DarkGray
    continue
  }
  $body = @{ type = $r.type; name = $r.name; content = $r.content; ttl = 1 }
  if ($r.type -eq 'MX') { $body.priority = [int]$r.priority }
  $c = Invoke-CF POST "/zones/$zoneId/dns_records" $body
  if ($c.success) { Write-Host "    ADD  $($r.type) $($r.name)" -ForegroundColor Green; $added++ }
  else            { Write-Host "    !    $($r.type) $($r.name): $($c.errorText)" -ForegroundColor Yellow }
}
if ($added -eq 0) { Write-Host '    all required records already present' -ForegroundColor DarkGray }

# --- 2b. DMARC — Cloudflare does NOT add this one ---------------------------
# Without it Gmail sees a domain with no stated policy, which is a spam signal
# on its own. p=none only monitors; it changes nothing except deliverability.
Step '2b' 'Ensuring DMARC policy'
$dmarcName = "_dmarc.$Zone"
$dmarc = $have.result | Where-Object { $_.type -eq 'TXT' -and $_.name -eq $dmarcName }
if ($dmarc) {
  Write-Host "    already set: $($dmarc.content)" -ForegroundColor DarkGray
} else {
  $d = Invoke-CF POST "/zones/$zoneId/dns_records" @{
    type    = 'TXT'
    name    = '_dmarc'
    content = "v=DMARC1; p=none; rua=mailto:$Destination"
    ttl     = 1
  }
  if ($d.success) { Write-Host '    ADD  TXT _dmarc (p=none)' -ForegroundColor Green }
  else            { Write-Host "    !    $($d.errorText)" -ForegroundColor Yellow }
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

# --- 5. show the mail authentication the world will actually see ------------
# The point of the whole exercise: a receiving server asks DNS whether this
# domain authorises the mail. If these are absent, it goes to spam no matter how
# well-formed the message is.
Step 5 'Mail authentication now published'
$final = Invoke-CF GET "/zones/$zoneId/dns_records?per_page=100"
$mx    = @($final.result | Where-Object { $_.type -eq 'MX' })
$spf   = @($final.result | Where-Object { $_.type -eq 'TXT' -and $_.content -like 'v=spf1*' })
$dkim  = @($final.result | Where-Object { $_.type -eq 'TXT' -and $_.name -like '*_domainkey*' })
$dm    = @($final.result | Where-Object { $_.type -eq 'TXT' -and $_.name -eq "_dmarc.$Zone" })

function Show($label, $rows) {
  if ($rows.Count -gt 0) { Write-Host ("    {0,-6} {1}" -f $label, 'present') -ForegroundColor Green }
  else                   { Write-Host ("    {0,-6} {1}" -f $label, 'MISSING') -ForegroundColor Red }
}
Show 'MX'    $mx
Show 'SPF'   $spf
Show 'DKIM'  $dkim
Show 'DMARC' $dm

Write-Host "`nDone." -ForegroundColor Green
Write-Host "  $address forwards to $Destination"
Write-Host "  The contact form can send: its destination is verified."
Write-Host ""
Write-Host "  DNS takes 5-15 minutes to propagate. Then verify from outside:" -ForegroundColor DarkGray
Write-Host "    nslookup -type=MX $Zone 8.8.8.8" -ForegroundColor DarkGray
Write-Host "    nslookup -type=TXT $Zone 8.8.8.8        # expect v=spf1" -ForegroundColor DarkGray
Write-Host "    nslookup -type=TXT _dmarc.$Zone 8.8.8.8 # expect v=DMARC1" -ForegroundColor DarkGray
Write-Host "  Then send the form again — Gmail should stop flagging it." -ForegroundColor DarkGray

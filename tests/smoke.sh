#!/usr/bin/env bash
# Smoke test for the deployed `ai` function.
#
#   AI_URL=https://<ref>.supabase.co/functions/v1/ai CLASS_CODE=ABC123 tests/smoke.sh
#   ... add SPEND=1 to make one real 03 call (about one cent).
#
# Run it with live AI switched on and inside the window for the full set;
# switched off, it checks the 423 path instead.
set -u
: "${AI_URL:?set AI_URL}"
CODE="${CLASS_CODE:-}"
ORIGIN="${ORIGIN:-https://www.theaiminute.blog}"
DEVICE="smoke-$(date +%s)-$RANDOM"
fail=0

post() { # expected-status label body [code]
  local want=$1 label=$2 body=$3 code=${4-$CODE}
  local got
  got=$(curl -sS -o /tmp/smoke_body -w '%{http_code}' -X POST "$AI_URL" \
    -H "Origin: $ORIGIN" -H "Content-Type: application/json" \
    -H "X-Class-Code: $code" -H "X-Device-Id: $DEVICE" -d "$body")
  if [ "$got" = "$want" ]; then echo "PASS  $got  $label"; else echo "FAIL  $got (wanted $want)  $label  $(head -c 200 /tmp/smoke_body)"; fail=1; fi
}

status=$(curl -sS "$AI_URL/status")
echo "status: $status"

got=$(curl -sS -o /dev/null -w '%{http_code}' -X POST "$AI_URL" -H "Origin: https://evil.example" -d '{}')
[ "$got" = 403 ] && echo "PASS  403  disallowed origin" || { echo "FAIL  $got  disallowed origin"; fail=1; }

JOB='{"kind":"03.decompose","inputs":{"job":"Recruiter"}}'
if echo "$status" | grep -q '"live":true'; then
  post 401 "wrong class code" "$JOB" "WRONG9"
  post 400 "unknown kind" '{"kind":"08.feedback","inputs":{}}'
  post 400 "input out of range" '{"kind":"06.debrief","inputs":{"hist":[]}}'
  post 400 "quote in a job title" '{"kind":"03.decompose","inputs":{"job":"a\" b"}}'
  if [ "${SPEND:-0}" = 1 ]; then
    post 200 "03 happy path, with model and max_tokens overrides ignored" \
      '{"kind":"03.decompose","inputs":{"job":"Recruiter"},"model":"claude-opus-4-1","max_tokens":100000}'
    head -c 400 /tmp/smoke_body; echo
  fi
else
  reason=$(echo "$status" | sed -n 's/.*"reason":"\([^"]*\)".*/\1/p')
  if [ "$reason" = budget ]; then post 429 "budget spent" "$JOB"; else post 423 "live AI $reason" "$JOB"; fi
fi
exit $fail

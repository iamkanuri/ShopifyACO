#!/bin/bash
# Is any minted /c/ outreach link live in production? Two-sided: the route must be
# MOUNTED (a syntactically invalid token must 404 text/plain, not fall through to the
# SPA's 200 text/html) or a 404 on a real token proves nothing.
BASE=https://lens.thirdocular.com
mounted=$(curl -s -o /dev/null -w "%{http_code}:%{content_type}" "$BASE/c/NOTVALID")
spa=$(curl -s -o /dev/null -w "%{http_code}:%{content_type}" "$BASE/zz-no-such-path-v42")
echo "canary route-mounted (/c/NOTVALID) : $mounted   (expect 404:text/plain)"
echo "canary spa-fallthrough (/zz-…)     : $spa       (expect 200:text/html)"
live=0; total=0
for d in experiments/stage6/out/hosted/c/*/; do
  t=$(basename "$d"); total=$((total+1))
  code=$(curl -s -o /dev/null -w "%{http_code}" "$BASE/c/$t")
  [ "$code" = "200" ] && { live=$((live+1)); echo "  LIVE: $t"; }
done
echo "minted tokens on disk: $total | serving 200 in production: $live"

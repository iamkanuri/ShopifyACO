# Database certificate trust

`supabase-prod-ca-2021.crt` is Supabase's public CA, downloaded from the link in the authenticated project's Database Settings on 2026-10-28:

https://supabase-downloads.s3-ap-southeast-1.amazonaws.com/prod/ssl/prod-ca-2021.crt

SHA-256 of the downloaded file: `700723581420dd1ac98fd7e9ac529f0ef210eadcaf87fc868a3ad7d114c2f3b7`.

This is public trust material, not a private key. Remote Postgres connections verify certificate chains and hostnames. Exact Supabase hosts use this CA; other hosts use system roots. `DB_CA_CERT` remains an explicit CA override. URL SSL parameters are rejected because node-postgres can replace the application's TLS configuration with them. No unverified fallback remains. Update the certificate and its test fingerprint together after verifying the provider's replacement.

# Security policy

Please report vulnerabilities privately through
[GitHub security advisories](https://github.com/wahabshaikh/halalfood.world/security/advisories/new),
or by email to salam@halalfood.world. Do not open a public issue.

Include the affected URL or file, steps to reproduce, and the impact you expect. We aim to acknowledge reports
within three days and to fix confirmed issues before disclosing them.

Only the live site (`halalfood.world`) and the code in this repository are in scope. Worker Preview deployments on
`workers.dev` run against test data and deliberately expose test hooks (`/api/test/*`, Turnstile test keys); report
them only if they reach production data or secrets.

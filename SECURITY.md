# Security Policy

## Reporting a vulnerability

Please report security issues **privately** — do not open a public issue.

Use GitHub's [private vulnerability reporting](https://github.com/akim136/gridbase/security/advisories/new)
(the repo's **Security → Advisories → Report a vulnerability**) so the report stays
confidential until a fix is available.

Include the affected version/commit, a description, reproduction steps, and the
impact. You'll get an acknowledgement, and a fix or mitigation timeline once triaged.

## Scope

gridbase is self-hosted — you run the Worker (API) and the web app on your own
Cloudflare account / host. The most relevant areas:

- the Bearer-gated `/v1` API (`packages/api`) — fails closed when no secret is set;
- SQL identifier handling — allowlist-validated (`assertIdent`), values always bound;
- the BFF proxy (`apps/web/app/api/grid/[...path]`) — keeps the API secret server-side.

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the trust boundaries.

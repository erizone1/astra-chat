## Summary
What does this PR change and why?

## Testing / Evidence
- [ ] Lint passed (`cd shopify-app && npm run lint`)
- [ ] Typecheck passed (`cd shopify-app && npm run typecheck`)
- [ ] Build passed (`cd shopify-app && npm run build`)
- [ ] Local smoke test: `cd shopify-app && npm run dev` (note anything relevant)

## Env / Secrets Checklist
- [ ] No secrets added (tokens/keys/passwords) — reviewed PR diff
- [ ] `.env` not committed (it must stay local only)
- [ ] If env vars changed: `.env.example` updated + README updated with one-liners
- [ ] Any secrets are stored only in GitHub Secrets / hosting platform, not in code

## Risk / Security / Tenant Isolation
- [ ] No tenant isolation impact
- [ ] Tenant isolation / security-relevant change (explain):
  - Risk:
  - Mitigation / validation (shop scope checks, session usage, auth boundaries):

## Rollback plan
How would we safely revert if this causes issues?

# Break-glass log (append-only)

This file records every high-risk operation performed outside the standard
CI/CD path. The expectation in `docs/separation-of-duties.md` §3 is that
the founder writes a pre-action note BEFORE acting, performs the action
through the documented runbook, then writes a post-action note. The
quarterly access review surfaces every `break_glass.*` audit_events row
for sign-off.

Format:

```
YYYY-MM-DD HH:MM TZ  actor=<github-login>  category=<db-write|secret-rotate|prod-ssh|deploy-bypass|other>
pre-action:
  what: <one line>
  why: <one line>
  expected-duration: <min>
  risks: <bullet list>
post-action:
  what-happened: <one line>
  changes: <bullet list>
  evidence: <audit_events row id | deployments row id | commit sha>
  unexpected-effects: <one line or 'none'>
```

---

(no events recorded yet — first event lands here)

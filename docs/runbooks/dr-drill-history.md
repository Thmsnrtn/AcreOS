# DR drill history (append-only)

Companion to `docs/runbooks/dr-drill-quarterly.md`. One block per drill,
newest at top. Also recorded in the `dr_drills` database table so
`/api/jobs/health` can surface staleness, but THIS file is the
human-readable evidence the auditor will read first.

Format:

```
YYYY-MM-DD  ran-by=<github-login>
            snapshot-age=<h>  restore=<min>  boot=<min>  syn=<min>  verify=<min>
            total-rto=<min>  target-rto=45  passed=<true|false>
            what-went-wrong: <free text>
            whats-flaky: <free text>
            action-items: <free text>
            postmortem: <path or url>
```

---

(no drills recorded yet — first drill lands the first row, then a
corresponding INSERT into dr_drills)

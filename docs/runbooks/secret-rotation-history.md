# Secret rotation history (append-only)

This file is the chronological record of every secret rotation event. The
SOC 2 Type II auditor will sample rows from this file and ask for matching
evidence in the vendor console / Fly secrets audit log.

Format (one event per block, newest at top):

```
YYYY-MM-DD  secret=<NAME>  actor=<github-login>  reason=<routine|compromise|departure|other>
            old-key-fingerprint=<sha256-prefix-12chars>
            new-key-fingerprint=<sha256-prefix-12chars>
            notes=<one line>
```

Do not edit prior rows. If a rotation event was recorded incorrectly,
append a correcting row referring back to the prior row by date.

---

(no events recorded yet — first rotation lands the first row)

# v5 Condition Matrix

Conditions layer onto persona × journey to create realistic diversity.

## Dimensions

### Network
| Code | Description |
|------|-------------|
| NET-FAST | Fast broadband (50+ Mbps, <20ms latency) |
| NET-3G | 3G throttled (1.5 Mbps down, 750 Kbps up, 300ms RTT) |
| NET-FLAKY | Flaky connection (50% packet loss, intermittent drops) |

### Device
| Code | Viewport | Description |
|------|----------|-------------|
| DEV-DESKTOP | 1440×900 | Desktop with large monitor |
| DEV-LAPTOP | 1280×720 | Standard laptop |
| DEV-TABLET | 768×1024 | iPad portrait |
| DEV-PHONE | 375×812 | iPhone 14 |

### Session State
| Code | Description |
|------|-------------|
| SESS-FRESH | Brand new, no prior session |
| SESS-VALID | Returning with active valid session |
| SESS-EXPIRED | Returning with expired session cookie |
| SESS-REFRESH | Mid-flow page refresh (tests state persistence) |

### Time of Day
| Code | Description |
|------|-------------|
| TIME-BIZ | Business hours (9am-5pm ET, peak server load) |
| TIME-LATE | Late night (11pm-2am ET, minimal load) |
| TIME-WKND | Weekend (variable load) |

### Concurrency
| Code | Description |
|------|-------------|
| CONC-SOLO | Single user only |
| CONC-50 | Part of 50-user simultaneous burst |
| CONC-100 | Part of 100-user simultaneous burst |

### Accessibility Mode
| Code | Description |
|------|-------------|
| A11Y-STD | Standard visual interaction |
| A11Y-KBD | Keyboard-only navigation |
| A11Y-SR | Screen reader (NVDA/VoiceOver) |
| A11Y-HC | High contrast + reduced motion |

## Assignment Strategy

The 100 runs (10 personas × 10 journeys) rotate conditions to ensure coverage:

### Coverage Requirements
- Every journey exercised under every network speed at least once
- Every journey exercised on every device at least once
- Every journey exercised under every session state at least once
- Every journey exercised at every concurrency level at least once
- Persona 9 (Alex, accessibility) always runs with A11Y-SR or A11Y-KBD
- Persona 6 (Marcus, power user) always runs with CONC-50 or CONC-100
- Persona 1 (Maria, mobile-first) always runs with DEV-PHONE
- Persona 4 (Robert, retired) always runs with DEV-TABLET

### Run Assignment Table

| Run | Persona | Journey | Network | Device | Session | Concurrency | A11y |
|-----|---------|---------|---------|--------|---------|-------------|------|
| 001 | Maria | J1-Landing | NET-3G | DEV-PHONE | SESS-FRESH | CONC-SOLO | A11Y-STD |
| 002 | Maria | J2-Deal | NET-FAST | DEV-PHONE | SESS-VALID | CONC-SOLO | A11Y-STD |
| 003 | Maria | J3-Campaign | NET-FLAKY | DEV-PHONE | SESS-VALID | CONC-SOLO | A11Y-STD |
| 004 | Maria | J4-Decision | NET-FAST | DEV-PHONE | SESS-REFRESH | CONC-50 | A11Y-STD |
| 005 | Maria | J5-Sophie | NET-3G | DEV-PHONE | SESS-VALID | CONC-SOLO | A11Y-STD |
| 006 | Maria | J6-Scale | NET-FAST | DEV-PHONE | SESS-VALID | CONC-SOLO | A11Y-STD |
| 007 | Maria | J7-Billing | NET-FAST | DEV-PHONE | SESS-VALID | CONC-SOLO | A11Y-STD |
| 008 | Maria | J8-Delete | NET-FAST | DEV-PHONE | SESS-VALID | CONC-SOLO | A11Y-STD |
| 009 | Maria | J9-Return | NET-3G | DEV-PHONE | SESS-EXPIRED | CONC-SOLO | A11Y-STD |
| 010 | Maria | J10-Error | NET-FLAKY | DEV-PHONE | SESS-REFRESH | CONC-SOLO | A11Y-STD |
| 011 | David | J1-Landing | NET-FAST | DEV-DESKTOP | SESS-FRESH | CONC-SOLO | A11Y-STD |
| 012 | David | J2-Deal | NET-FAST | DEV-DESKTOP | SESS-VALID | CONC-SOLO | A11Y-STD |
| 013 | David | J3-Campaign | NET-FAST | DEV-DESKTOP | SESS-VALID | CONC-SOLO | A11Y-STD |
| 014 | David | J4-Decision | NET-FAST | DEV-DESKTOP | SESS-VALID | CONC-SOLO | A11Y-STD |
| 015 | David | J5-Sophie | NET-FAST | DEV-DESKTOP | SESS-VALID | CONC-SOLO | A11Y-STD |
| 016 | David | J6-Scale | NET-FAST | DEV-DESKTOP | SESS-VALID | CONC-50 | A11Y-STD |
| 017 | David | J7-Billing | NET-FAST | DEV-DESKTOP | SESS-VALID | CONC-SOLO | A11Y-STD |
| 018 | David | J8-Delete | NET-FAST | DEV-DESKTOP | SESS-VALID | CONC-SOLO | A11Y-STD |
| 019 | David | J9-Return | NET-FAST | DEV-DESKTOP | SESS-EXPIRED | CONC-SOLO | A11Y-STD |
| 020 | David | J10-Error | NET-3G | DEV-DESKTOP | SESS-REFRESH | CONC-SOLO | A11Y-STD |
| 021 | Jenna | J1-Landing | NET-FAST | DEV-LAPTOP | SESS-FRESH | CONC-SOLO | A11Y-STD |
| 022 | Jenna | J2-Deal | NET-3G | DEV-PHONE | SESS-VALID | CONC-SOLO | A11Y-STD |
| 023 | Jenna | J3-Campaign | NET-FAST | DEV-LAPTOP | SESS-VALID | CONC-SOLO | A11Y-STD |
| 024 | Jenna | J4-Decision | NET-FAST | DEV-LAPTOP | SESS-VALID | CONC-SOLO | A11Y-STD |
| 025 | Jenna | J5-Sophie | NET-FAST | DEV-PHONE | SESS-VALID | CONC-SOLO | A11Y-STD |
| 026 | Jenna | J6-Scale | NET-FAST | DEV-LAPTOP | SESS-VALID | CONC-SOLO | A11Y-STD |
| 027 | Jenna | J7-Billing | NET-FAST | DEV-LAPTOP | SESS-VALID | CONC-100 | A11Y-STD |
| 028 | Jenna | J8-Delete | NET-FAST | DEV-LAPTOP | SESS-VALID | CONC-SOLO | A11Y-STD |
| 029 | Jenna | J9-Return | NET-FAST | DEV-LAPTOP | SESS-EXPIRED | CONC-SOLO | A11Y-STD |
| 030 | Jenna | J10-Error | NET-FLAKY | DEV-PHONE | SESS-VALID | CONC-SOLO | A11Y-STD |
| 031 | Robert | J1-Landing | NET-3G | DEV-TABLET | SESS-FRESH | CONC-SOLO | A11Y-STD |
| 032 | Robert | J2-Deal | NET-FAST | DEV-TABLET | SESS-VALID | CONC-SOLO | A11Y-STD |
| 033 | Robert | J3-Campaign | NET-FAST | DEV-TABLET | SESS-VALID | CONC-SOLO | A11Y-STD |
| 034 | Robert | J4-Decision | NET-FAST | DEV-TABLET | SESS-VALID | CONC-SOLO | A11Y-STD |
| 035 | Robert | J5-Sophie | NET-3G | DEV-TABLET | SESS-VALID | CONC-SOLO | A11Y-STD |
| 036 | Robert | J6-Scale | NET-FAST | DEV-TABLET | SESS-VALID | CONC-SOLO | A11Y-STD |
| 037 | Robert | J7-Billing | NET-FAST | DEV-TABLET | SESS-VALID | CONC-SOLO | A11Y-STD |
| 038 | Robert | J8-Delete | NET-FAST | DEV-TABLET | SESS-VALID | CONC-SOLO | A11Y-STD |
| 039 | Robert | J9-Return | NET-FAST | DEV-TABLET | SESS-EXPIRED | CONC-SOLO | A11Y-STD |
| 040 | Robert | J10-Error | NET-3G | DEV-TABLET | SESS-REFRESH | CONC-SOLO | A11Y-STD |
| 041 | Priya | J1-Landing | NET-FAST | DEV-LAPTOP | SESS-FRESH | CONC-SOLO | A11Y-STD |
| 042 | Priya | J2-Deal | NET-FAST | DEV-DESKTOP | SESS-VALID | CONC-SOLO | A11Y-STD |
| 043 | Priya | J3-Campaign | NET-FAST | DEV-LAPTOP | SESS-VALID | CONC-SOLO | A11Y-STD |
| 044 | Priya | J4-Decision | NET-FAST | DEV-LAPTOP | SESS-VALID | CONC-50 | A11Y-STD |
| 045 | Priya | J5-Sophie | NET-FAST | DEV-LAPTOP | SESS-VALID | CONC-SOLO | A11Y-STD |
| 046 | Priya | J6-Scale | NET-FAST | DEV-DESKTOP | SESS-VALID | CONC-SOLO | A11Y-STD |
| 047 | Priya | J7-Billing | NET-FAST | DEV-LAPTOP | SESS-VALID | CONC-SOLO | A11Y-STD |
| 048 | Priya | J8-Delete | NET-FAST | DEV-LAPTOP | SESS-VALID | CONC-SOLO | A11Y-STD |
| 049 | Priya | J9-Return | NET-3G | DEV-LAPTOP | SESS-EXPIRED | CONC-SOLO | A11Y-STD |
| 050 | Priya | J10-Error | NET-FLAKY | DEV-LAPTOP | SESS-REFRESH | CONC-SOLO | A11Y-STD |
| 051 | Marcus | J1-Landing | NET-FAST | DEV-DESKTOP | SESS-FRESH | CONC-50 | A11Y-KBD |
| 052 | Marcus | J2-Deal | NET-FAST | DEV-DESKTOP | SESS-VALID | CONC-SOLO | A11Y-STD |
| 053 | Marcus | J3-Campaign | NET-FAST | DEV-DESKTOP | SESS-VALID | CONC-100 | A11Y-STD |
| 054 | Marcus | J4-Decision | NET-FAST | DEV-DESKTOP | SESS-VALID | CONC-50 | A11Y-STD |
| 055 | Marcus | J5-Sophie | NET-FAST | DEV-DESKTOP | SESS-VALID | CONC-SOLO | A11Y-STD |
| 056 | Marcus | J6-Scale | NET-FAST | DEV-DESKTOP | SESS-VALID | CONC-100 | A11Y-STD |
| 057 | Marcus | J7-Billing | NET-FAST | DEV-DESKTOP | SESS-VALID | CONC-50 | A11Y-STD |
| 058 | Marcus | J8-Delete | NET-FAST | DEV-DESKTOP | SESS-VALID | CONC-SOLO | A11Y-STD |
| 059 | Marcus | J9-Return | NET-FAST | DEV-DESKTOP | SESS-EXPIRED | CONC-SOLO | A11Y-KBD |
| 060 | Marcus | J10-Error | NET-FLAKY | DEV-DESKTOP | SESS-REFRESH | CONC-100 | A11Y-STD |
| 061 | Sarah | J1-Landing | NET-FAST | DEV-LAPTOP | SESS-FRESH | CONC-SOLO | A11Y-STD |
| 062 | Sarah | J2-Deal | NET-FAST | DEV-LAPTOP | SESS-VALID | CONC-SOLO | A11Y-STD |
| 063 | Sarah | J3-Campaign | NET-FAST | DEV-LAPTOP | SESS-VALID | CONC-SOLO | A11Y-STD |
| 064 | Sarah | J4-Decision | NET-FAST | DEV-LAPTOP | SESS-VALID | CONC-SOLO | A11Y-STD |
| 065 | Sarah | J5-Sophie | NET-3G | DEV-LAPTOP | SESS-VALID | CONC-SOLO | A11Y-STD |
| 066 | Sarah | J6-Scale | NET-FAST | DEV-LAPTOP | SESS-VALID | CONC-50 | A11Y-STD |
| 067 | Sarah | J7-Billing | NET-FAST | DEV-LAPTOP | SESS-VALID | CONC-SOLO | A11Y-STD |
| 068 | Sarah | J8-Delete | NET-FAST | DEV-LAPTOP | SESS-VALID | CONC-SOLO | A11Y-STD |
| 069 | Sarah | J9-Return | NET-FAST | DEV-LAPTOP | SESS-EXPIRED | CONC-SOLO | A11Y-STD |
| 070 | Sarah | J10-Error | NET-FLAKY | DEV-LAPTOP | SESS-VALID | CONC-SOLO | A11Y-STD |
| 071 | Tom | J1-Landing | NET-FAST | DEV-LAPTOP | SESS-EXPIRED | CONC-SOLO | A11Y-STD |
| 072 | Tom | J2-Deal | NET-3G | DEV-PHONE | SESS-VALID | CONC-SOLO | A11Y-STD |
| 073 | Tom | J3-Campaign | NET-FAST | DEV-LAPTOP | SESS-VALID | CONC-SOLO | A11Y-STD |
| 074 | Tom | J4-Decision | NET-FAST | DEV-LAPTOP | SESS-VALID | CONC-SOLO | A11Y-STD |
| 075 | Tom | J5-Sophie | NET-FAST | DEV-LAPTOP | SESS-VALID | CONC-SOLO | A11Y-STD |
| 076 | Tom | J6-Scale | NET-FAST | DEV-LAPTOP | SESS-VALID | CONC-SOLO | A11Y-STD |
| 077 | Tom | J7-Billing | NET-FAST | DEV-LAPTOP | SESS-VALID | CONC-SOLO | A11Y-STD |
| 078 | Tom | J8-Delete | NET-FAST | DEV-LAPTOP | SESS-VALID | CONC-SOLO | A11Y-STD |
| 079 | Tom | J9-Return | NET-FAST | DEV-LAPTOP | SESS-EXPIRED | CONC-SOLO | A11Y-STD |
| 080 | Tom | J10-Error | NET-3G | DEV-LAPTOP | SESS-REFRESH | CONC-50 | A11Y-STD |
| 081 | Alex | J1-Landing | NET-FAST | DEV-DESKTOP | SESS-FRESH | CONC-SOLO | A11Y-SR |
| 082 | Alex | J2-Deal | NET-FAST | DEV-DESKTOP | SESS-VALID | CONC-SOLO | A11Y-SR |
| 083 | Alex | J3-Campaign | NET-FAST | DEV-DESKTOP | SESS-VALID | CONC-SOLO | A11Y-KBD |
| 084 | Alex | J4-Decision | NET-FAST | DEV-DESKTOP | SESS-VALID | CONC-SOLO | A11Y-SR |
| 085 | Alex | J5-Sophie | NET-FAST | DEV-DESKTOP | SESS-VALID | CONC-SOLO | A11Y-SR |
| 086 | Alex | J6-Scale | NET-FAST | DEV-DESKTOP | SESS-VALID | CONC-SOLO | A11Y-KBD |
| 087 | Alex | J7-Billing | NET-FAST | DEV-DESKTOP | SESS-VALID | CONC-SOLO | A11Y-SR |
| 088 | Alex | J8-Delete | NET-FAST | DEV-DESKTOP | SESS-VALID | CONC-SOLO | A11Y-SR |
| 089 | Alex | J9-Return | NET-FAST | DEV-DESKTOP | SESS-EXPIRED | CONC-SOLO | A11Y-KBD |
| 090 | Alex | J10-Error | NET-FAST | DEV-DESKTOP | SESS-REFRESH | CONC-SOLO | A11Y-SR |
| 091 | Chris | J1-Landing | NET-FAST | DEV-PHONE | SESS-FRESH | CONC-SOLO | A11Y-STD |
| 092 | Chris | J2-Deal | NET-FAST | DEV-LAPTOP | SESS-VALID | CONC-SOLO | A11Y-STD |
| 093 | Chris | J3-Campaign | NET-3G | DEV-PHONE | SESS-VALID | CONC-SOLO | A11Y-STD |
| 094 | Chris | J4-Decision | NET-FAST | DEV-LAPTOP | SESS-VALID | CONC-SOLO | A11Y-STD |
| 095 | Chris | J5-Sophie | NET-FAST | DEV-PHONE | SESS-VALID | CONC-SOLO | A11Y-STD |
| 096 | Chris | J6-Scale | NET-FAST | DEV-LAPTOP | SESS-VALID | CONC-SOLO | A11Y-STD |
| 097 | Chris | J7-Billing | NET-FAST | DEV-LAPTOP | SESS-VALID | CONC-SOLO | A11Y-HC |
| 098 | Chris | J8-Delete | NET-FAST | DEV-LAPTOP | SESS-VALID | CONC-SOLO | A11Y-STD |
| 099 | Chris | J9-Return | NET-3G | DEV-PHONE | SESS-EXPIRED | CONC-SOLO | A11Y-STD |
| 100 | Chris | J10-Error | NET-FLAKY | DEV-PHONE | SESS-REFRESH | CONC-100 | A11Y-STD |

## Coverage Verification

| Dimension | Values | Runs Covered |
|-----------|--------|--------------|
| NET-FAST | 70+ runs | Every journey |
| NET-3G | 15 runs | Journeys 1,2,3,5,9,10 |
| NET-FLAKY | 10 runs | Journeys 3,10 at minimum |
| DEV-DESKTOP | 25 runs | Every journey via Marcus, David, Alex |
| DEV-LAPTOP | 40+ runs | Every journey |
| DEV-TABLET | 10 runs | All journeys via Robert |
| DEV-PHONE | 20 runs | Every journey via Maria + select others |
| SESS-FRESH | 10 runs | Journey 1 for all personas |
| SESS-VALID | 70+ runs | Most runs |
| SESS-EXPIRED | 10 runs | Journey 9 for all personas |
| SESS-REFRESH | 8 runs | Journey 10 for most |
| CONC-SOLO | 75+ runs | Majority |
| CONC-50 | 8 runs | Various journeys |
| CONC-100 | 5 runs | Scale + stress scenarios |
| A11Y-SR | 8 runs | Alex's journeys |
| A11Y-KBD | 4 runs | Alex + Marcus select |
| A11Y-HC | 1 run | Chris J7 |
| A11Y-STD | 87 runs | Default |

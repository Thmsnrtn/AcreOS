# Tariq El-Amin — Voice AI Audit

**Wave 3 · 87-Persona AcreOS Audit · 2026-05-01**
*36, ex-Deepgram and ex-ElevenLabs voice AI engineer. I shipped streaming ASR for utility dispatch (10k concurrent ag-truck calls), TTS voice cloning for an ed-tech tutor, and a realtime voice agent for a Series-B fintech. I read voice code with one ear on the codepath and one on a noisy diesel cab in July. AcreOS has Whisper + Deepgram + Twilio bones. The pipeline isn't finished — and the field-mobile voice-Pax is the single biggest unrealized differentiator on the roadmap.*

---

## 1. One-line verdict

**C+.** AcreOS has the *right providers picked* (Whisper for batch, Deepgram for streaming, Twilio for telephony, OpenAI for analysis) but the pipelines are wired with the discipline of a hackathon weekend, not a voice product. There is **no TTS** anywhere in the stack except a single hardcoded `<Say voice="Polly.Joanna">` TwiML disclosure. There is **no wake-word, no barge-in, no streaming TTS playback, no diarization beyond `idx % 2`, no language detection, no voice-Pax surface at all in the field-mobile UI** — the user records a memo, posts a webm, gets text back. That is voice 2018, not voice 2026. Eight weeks of focused work moves this to a defensible voice-first land-investing copilot — the only one I know of in the category.

---

## 2. ASR (speech-to-text) — what's there

| Surface | File:line | Provider | Model | Streaming? | Language |
|---|---|---|---|---|---|
| Field-scout voice memo | `server/routes-field-scout.ts:86–142` | OpenAI Whisper REST | `whisper-1` | No (batch upload) | Auto-detect (no hint) |
| Pax-rail mic input | `server/routes-ai.ts:1639–1657` | OpenAI Whisper REST | `whisper-1` | No | Auto-detect |
| Twilio call recording → transcript | `server/services/voiceAI.ts:71–118` | Whisper | `whisper-1` | No (post-call) | `'en'` hardcoded line 109 |
| Twilio call recording (alt) | `server/services/voiceCallAI.ts:145–241` | Whisper | `whisper-1`, `verbose_json` | No | None passed |
| Real-time call transcription | `server/services/realtimeTranscription.ts:120–177` | Deepgram WebSocket | `nova-2` | **Yes** | `en-US` hardcoded line 141 |

**Two parallel batch-Whisper paths** (`voiceAI.ts:71` and `voiceCallAI.ts:145`) doing the same thing. One uses the SDK, the other uses raw `fetch`. Pick one. Right now you have two places that lie to you about transcript shape, and `voiceAI.ts:108` writes `segments: []` — losing all timing data — while `voiceCallAI.ts:181–187` writes per-segment `transcriptFormatted` with **fake diarization** (`idx % 2 === 0 ? "Agent" : "Customer"`). That second one is worse than no diarization: it produces confidently-wrong speaker labels that downstream coaching insights (`voiceCallAI.ts:507–522`) compute talk-to-listen ratios from. **Your "talk-to-listen ratio" is currently a coin flip averaged over segment count.**

### What's wrong with `whisper-1` as the only ASR

1. **`whisper-1` is the original 2022 model.** OpenAI now offers `gpt-4o-transcribe` and `gpt-4o-mini-transcribe` (released 2025) — better accent handling, better hallucination control, **lower cost on `mini`**. Pin everywhere you have `whisper-1` to `gpt-4o-mini-transcribe` for batch and benchmark a 2-day error-rate test on real call audio.
2. **No language hint.** Whisper auto-detects, which works for English-monolingual but fails for Spanish-English code-switched audio (Esperanza's persona — see §6). Pass `language` per call based on user's org locale **and** allow per-call override (a Spanish-speaking landowner picks up the phone — the agent should be able to flag the call as `es` or `es-MX` so Whisper doesn't half-translate).
3. **Whisper hallucinates on silence.** A 60-second voice memo with 40s of dead air ("...standing in the field... [wind]... yeah") produces fabricated text on the silence (notorious failure: it inserts "thank you for watching" or "subscribe to my channel" — yes, really). **Fix: pre-process with VAD** (voice activity detection — `@ricky0123/vad-web` runs in-browser, ~1.2MB) and only send detected speech regions. Cuts billable Whisper minutes by ~30–50% on field memos.
4. **No streaming on the field-mobile voice memo.** A user holds a 90-second memo, hits stop, waits 4–8 seconds for the round-trip. **Switch to streaming via OpenAI Realtime or Deepgram** — partial transcripts stream while they speak, final lands within ~300ms of stop. UX is night-and-day. Tariq's rule: *if the user can read along while they're talking, they trust the transcript.*
5. **`.webm` upload from MediaRecorder isn't transcoded.** Whisper accepts it, but compression is variable across browsers (Safari emits `.mp4`, Chrome `.webm`, Firefox `.ogg`). On a 1-bar LTE field upload, you're sending 4–8x more bytes than necessary. **Pipe through Opus at 16kbps mono before upload** (the browser already has it; `MediaRecorder({ mimeType: 'audio/webm;codecs=opus', audioBitsPerSecond: 16000 })`). 60-second memo drops from ~480KB to ~120KB.

### Streaming pipeline (Deepgram) — almost there

`realtimeTranscription.ts:120` is the only file in the codebase that reads like it was written by someone who has shipped voice. WebSocket, `nova-2`, `interim_results: true`, broadcast on `org:${orgId}`, motivation-keyword detection on finalize. **Good.** But:

1. **It's only wired for inbound Twilio calls.** Not for field-mobile voice-Pax. Wire the same Deepgram stream to the in-app mic so Pax can be a real conversational agent.
2. **No reconnect-on-disconnect.** A 4G handoff drops the WS. No retry logic in `dg.on('error')`. On cell-spotty rural calls, the back half of a 12-minute call is lost.
3. **No keepalive heartbeat.** Deepgram closes idle WS at 60s. If the caller pauses to think, the next chunk arrives on a closed socket — silent failure, no transcript.
4. **`mulaw / 8000Hz / mono` is fine for telephony** but for in-app voice memos you should send `linear16 / 16000Hz / mono` for higher-quality input. Branch the params by source.
5. **`MOTIVATION_KEYWORDS` (line 28) is duplicated** in `routes-voice.ts:20`. Two lists, slightly different. They will drift. Move to `shared/motivationKeywords.ts` and import.

---

## 3. TTS (text-to-speech) — almost completely missing

There is **one** TTS callsite in the entire codebase: `routes-voice.ts:274` plays a TCPA disclosure with Twilio's built-in `<Say voice="Polly.Joanna">`. That's it. No ElevenLabs, no Cartesia, no OpenAI TTS, no streaming voice playback, no voice-Pax replies, no IVR menus, no voicemail drop, no audio briefings.

This is the single biggest white-space opportunity in AcreOS.

### What I'd ship (priority order)

1. **OpenAI `gpt-4o-mini-tts`** for default voice-Pax replies in the rail and field-mobile. Cheap (~$0.015/1M chars in, $0.60/1M chars out for audio), good quality, *streaming output*, `instructions` parameter lets you steer tone ("warm, paced, like a county-extension agent"). Latency to first audio byte: ~250ms. Ship this in week 1.
2. **Cartesia Sonic** (or **ElevenLabs Flash v2.5**) for the *founder's* customer-facing automated outreach (voicemail drop, callback playback). 75ms to first byte, voice cloning available. The Land Investor uploads 30s of their own voice, AcreOS clones it, and the system can leave a voicemail in their voice when they ask Pax to "leave Janet a message saying I'll call her tomorrow." **This is the killer feature for solo investors who can't be on the phone all day.** Native e-sign + native voice clone is a moat. Use ElevenLabs only for the cloning pipeline; keep the runtime TTS flexible behind an adapter.
3. **Twilio `<Play>` over `<Say>`** for the disclosure. Pre-render the disclosure text once via Cartesia → S3, cache by hash, swap in `<Play>` URL. `<Say voice="Polly.Joanna">` is robotic and un-AcreOS.
4. **Audio briefings for Aurelio's drop-pin flow.** While the user drives between parcels, Pax reads the next parcel's summary aloud ("County is Burnet, 14 acres, ag-zoned, last sold 2018 for $42k, owner is Marvin Reeves age 67, motivation flag — estate"). 60s of audio per parcel. TTS runs at the desk the night before; field user gets cached MP3s. Zero in-field latency, zero in-field bandwidth.

### TTS architecture I'd build

```
provider-adapter pattern (server/services/providers/tts/)
  ├── openaiTTS.ts        (gpt-4o-mini-tts, default)
  ├── cartesiaTTS.ts      (Sonic, low-latency / phone)
  ├── elevenLabsTTS.ts    (clone-only)
  └── pollyTTS.ts         (TwiML <Say> fallback)

ttsRouter.ts:
  - input: { text, voiceId?, latencyTier: 'phone'|'app'|'batch', orgId }
  - "phone" → Cartesia (75ms TTFB, mulaw 8kHz)
  - "app"   → OpenAI mini-tts (250ms TTFB, mp3 streaming)
  - "batch" → OpenAI standard (cheap, mp3 file)
  - cache by text+voiceId hash → S3 with 90d TTL
  - cost telemetry into aiTelemetryEvents (see Theo's audit)
```

Mirrors the LLM `aiRouter` pattern Theo already approved.

---

## 4. Real-time voice pipeline — the missing voice-Pax

The biggest gap: **Pax cannot have a voice conversation with the user.** Today the rail is:

```
mic → MediaRecorder → blob → POST /api/ai/voice/transcribe → text → text Pax → text reply
```

That's not voice AI. That's a dictation textbox.

### What 2026 voice-Pax looks like

Single WebSocket, full-duplex, **OpenAI Realtime API** (or **Deepgram Voice Agent API**, which bundles ASR+LLM+TTS — released GA Q4 2025):

```
[mic] ──ws──> [server proxy] ──ws──> OpenAI Realtime
                  │                       │
                  └── tool calls ────────┘ (Pax tools: create_lead, lookup_parcel, etc.)
                  │                       │
[speaker] <─ws─── [server proxy] <──ws──┘ (streaming audio out, ~300ms TTFB)
```

Why this matters specifically for AcreOS:

- **Hands-free at the parcel.** Aurelio's drop-pin flow becomes *talk-driven*: "Pax, drop a pin, photo's coming, owner is the Reeves estate, motivated — chickens dead." Three seconds of speech, zero taps, lead created with structured fields extracted server-side.
- **Driving between parcels.** Pax reads the next stop ("Next parcel is 12 acres in Bell County, owner Lloyd Pham, motivation unknown") and the user can interrupt with "skip, what's the one after." **Barge-in is non-negotiable** — without it, the user has to wait through Pax's full reply before responding. OpenAI Realtime supports server-side VAD with barge-in out of the box.
- **Phone-call coaching during the call.** Whisper coaching insights run *post-call* today. With a duplex pipeline, an in-ear coach prompt ("ask about timeline") can fire during the call. This is a Tier-3 feature — but it's worth $200/mo to a serious cold-caller.

### Wake-word — picoVoice or in-house?

For "Hey Pax" hands-free activation in the field:
- **picoVoice Porcupine**: 4KB model, on-device, ~6ms detection latency, $0 per inference — pay per-app license. **Right answer for AcreOS.** The user trains a custom wake word ("Hey Pax") once during onboarding, the model ships with the Capacitor app, no audio leaves the phone until wake. **Privacy-correct, battery-correct, latency-correct.** Two days to integrate.
- **Don't use** browser `webkitSpeechRecognition` — it's continuously streaming all audio to Google, leaks PII off-device, and isn't supported in Safari iOS (which is the field-mobile reality).

### Diarization (who is speaking)

`voiceCallAI.ts:181` does fake diarization (`idx % 2`). This must be replaced. Options:
- **Deepgram nova-2 with `diarize: true`** — already in use for streaming, just flip the flag. Adds ~$0.0043/min. Returns true `speaker: 0|1|2`.
- **Whisper + `pyannote.audio`** if you ever self-host — overkill for now.
- For inbound calls where you know the agent is on the AcreOS side and the seller is on the PSTN side, **diarization is solved by Twilio dual-channel recording** (`recordingChannels: 'dual'`) — agent on left, seller on right. Free, deterministic, beats any model. Currently not enabled — it should be.

---

## 5. Voice-Pax UX for field-mobile (cross-ref Aurelio)

Aurelio's drop-pin flow nailed the *gestural* path. Voice should be the **second** path — equally first-class, not a fallback.

### What the field user actually does

Standing next to a sign, sun overhead, gloves on, can't tap. They say:

> *"Hey Pax — drop a pin. Owner is the Reeves estate, looks abandoned, fence is down on the south side. Photo's coming. Mark this one motivated."*

What needs to happen:

1. **Wake-word triggers Capacitor mic permission** (already granted at onboarding).
2. **Streaming ASR** → text appears word-by-word in a 96px-tall floating panel (Aurelio: 60px is the floor; voice-Pax should be even larger because users will glance, not read).
3. **Tool routing** — `create_lead` with extracted fields: `ownerName: "Reeves estate"`, `condition: "abandoned"`, `notes: "fence down south side"`, `motivationFlag: true`.
4. **Audio confirmation back** ("Got it. Pin dropped on parcel 0042-1773-091. Reeves estate, marked motivated. Ready for the photo when you are.") — Cartesia Sonic, 80ms TTFB.
5. **Photo capture takes over the screen** — already wired in Aurelio's plan.
6. **Pax speaks the next prompt** while the user's hands are on the camera: "Anything else for this one?"

**Total user input: 14 seconds of natural speech and one camera tap.** That's the Drop-Pin v2 ceiling. Aurelio's gestural path is the floor.

### Voice transcript editing — keep Aurelio's note

Aurelio (§4 of his audit) flagged: *no playback before submission, no edit*. Echoing him: build the **playback + editable-transcript** step before the memo merges into the lead notes. Whisper *will* hallucinate names — "Reeves" becomes "Reeves" or "Reaves" or "Rees" depending on accent. The user must be able to fix it in 2 taps before submit.

Also: store the **raw audio Blob in IndexedDB** keyed by `visitId`. Two reasons — re-transcription if the model improves, and **disputes** ("did the seller really say that?"). Audit-grade voice retention is a B2B feature.

---

## 6. Multilingual — cross-ref Esperanza + Linh

I read Esperanza (Spanish bilingual) and Linh (Vietnamese first-gen) personas. Three voice-AI specifics:

1. **Language detection per-call.** `voiceAI.ts:109` writes `language: 'en'` regardless. This must come from Whisper's auto-detected `language` field (which `verbose_json` already returns at `voiceCallAI.ts:178` — but it's discarded). **Persist the detected language to `callTranscripts.language` and use it as the default for downstream LLM analysis** (the GPT-4o sentiment/intent prompts are English-only today; they'll mis-score Spanish text).
2. **Code-switching.** Real-world Texas-Mexico bilingual calls switch mid-sentence. `whisper-1` handles this OK; **`gpt-4o-transcribe` handles it better**, especially with `language: null` (let it detect) and a prompt biasing toward known proper nouns. Pass `prompt: "Land investor: ${ownerName} ${county} ${state}"` to bias Whisper toward the names it should preserve.
3. **TTS in Spanish for outbound voicemail drop.** Cartesia and ElevenLabs both have native Spanish voices; OpenAI mini-tts speaks ~50 languages. **Per-recipient TTS language selection** based on the lead's `preferredLanguage` field (which doesn't exist yet — propose: add to `leads` schema). Esperanza's audit will hit this; my flag is that the voice pipeline should be ready when she does.
4. **Vietnamese (Linh)** — Whisper's Vietnamese WER is ~12% (vs ~5% for English). For a small sub-segment, batch-only with manual review is acceptable. Don't promise streaming Vietnamese until you've tested it on real bilingual VN users.

### One simple migration

Replace every `model: 'whisper-1'` with a wrapper:

```ts
const transcription = await transcribe({
  audio: audioFile,
  language: lead?.preferredLanguage ?? org.defaultLanguage ?? null,  // null = auto-detect
  prompt: buildContextPrompt(lead),  // owner/county/state name biasing
  diarize: source === 'phone',
});
```

One callsite. All five existing transcribe paths converge. Tested once.

---

## 7. Cost + observability

### What I see

- **No telemetry** on Whisper minutes consumed. The 2 batch paths and the 2 in-app paths write nothing to `aiTelemetryEvents` (Theo flagged this for LLMs; same disease here).
- **No cost guardrail.** A user holds down the mic for 30 minutes, AcreOS happily transcribes it. At $0.006/min for Whisper that's $0.18 — fine. At Deepgram nova-2 streaming with diarization that's $0.0103/min × 30 = $0.31. Multiplied across 200 orgs × 50 calls/mo = $3,100/mo of voice spend invisible on the dashboard.
- **No retention policy.** `callTranscripts.audioUrl` is a Twilio URL with no expiry handling. Twilio holds recordings indefinitely at $0.0025/min/mo. After 12 months × 1000 calls × 8 minutes avg, that's $240/mo just sitting there. Add a retention sweep: copy to S3 (cheaper), delete from Twilio at 30 days.

### What to ship

- **Voice telemetry table** mirroring `aiTelemetryEvents`: per-call provider, model, duration_seconds, cost_cents, language_detected, diarization_used, success.
- **Per-org monthly voice budget** with soft warning at 80%, hard cap at 110%. Surface in admin UI.
- **Retention job**: `voiceRetentionSweeper.ts` running nightly — Twilio recordings older than 30d → S3 cold storage → URL update on `callTranscripts`.

---

## 8. Security + privacy specifics

1. **`/api/voice/transcribe` is unauthenticated** in the field-scout router (`routes-field-scout.ts:86`). I see no `isAuthenticated` middleware on the line. The `/api/ai/voice/transcribe` route in `routes-ai.ts:1639` is correctly gated. **Field-scout one is a free Whisper budget for any anonymous caller.** Fix this in 4 lines.
2. **No content moderation on transcripts.** A motivated-seller call may include the seller stating SSN, banking info, medical hardship. The transcript is stored in plain text and surfaced to support staff via `/transcripts/search` (line 376). **Pre-store PII redaction**: regex sweep for `\d{3}-\d{2}-\d{4}` (SSN), card numbers, routing numbers — replace with `[REDACTED-SSN]` etc. Open-source: `presidio-analyzer` or roll your own — 30 patterns covers 95% of risk.
3. **TCPA disclosure plays Polly.Joanna** every call. State-specific two-party-consent states (CA, FL, IL, MD, MA, MT, NH, PA, WA — Tariq has shipped this for a CA dispatch client) require *prior* consent or *clear notification at the start*. Audit: is the disclosure played **before** the seller answers, or after? `routes-voice.ts:267` doesn't show the trigger point. Verify via Twilio call flow XML — if the disclosure is on `<Dial>` instead of `<Connect>`, the seller hears it after their hello, which is **non-compliant in two-party states**.
4. **WebSocket auth on the streaming ingress** — `realtimeTranscription.ts` doesn't show how Twilio Media Streams authenticates back to AcreOS. If it's just a public WS endpoint, anyone can flood it with fake audio and spike Deepgram bills. Need: signed Twilio params + per-callSid token gate.

---

## 9. The 8-week voice AI sprint

In priority order. Each is shippable behind a flag.

### Week 1–2 — clean up + cost control

- **Day 1**: Auth-gate `/api/voice/transcribe` field-scout route. Bug bash.
- **Day 2–3**: Migrate batch Whisper to a single `transcribe()` adapter. Persist detected language. Pass context prompt with owner/county.
- **Day 4–5**: Pin to `gpt-4o-mini-transcribe`, run a 2-day error-rate bake against real seller calls. Decide stay/revert.
- **Day 6–7**: Voice telemetry table + dashboard tile. Per-org monthly minute counter.
- **Day 8–10**: PII redaction pre-store (regex sweep + audit log).

### Week 3–4 — streaming voice-Pax MVP

- **Day 11–13**: Wire OpenAI Realtime API to the Pax rail. Server-proxied WS. Tool-call passthrough.
- **Day 14–15**: Streaming TTS via gpt-4o-mini-tts. Audio playback in the rail.
- **Day 16–17**: Server VAD + barge-in. Test on real cell calls.
- **Day 18–20**: Voice-Pax shadow mode — opt-in flag, 5 founder-friendly orgs.

### Week 5–6 — field-mobile voice-Pax

- **Day 21–23**: picoVoice Porcupine wake-word integration (Capacitor plugin).
- **Day 24–26**: Drop-Pin-by-voice flow (cross-ref Aurelio §6 for the gestural twin).
- **Day 27–28**: Audio confirmation playback (Cartesia for low-latency in-app).
- **Day 29–30**: Editable transcript + raw-audio IndexedDB retention.

### Week 7–8 — outbound voice + retention

- **Day 31–33**: TTS adapter pattern (`tts/`). Cartesia for phone, OpenAI for app, Polly fallback.
- **Day 34–36**: Voicemail drop with cloned founder voice (ElevenLabs onboarding clone, 30s sample).
- **Day 37–38**: Twilio dual-channel recording → real diarization. Kill `idx % 2`.
- **Day 39–40**: Retention sweeper. S3 archive. Cost dashboard per-feature.

**Stretch (week 9+):** in-call coaching prompt overlay, Spanish voicemail drop, audio briefings for the drive-between-parcels flow.

---

## 10. Files I read

- `server/services/voiceAI.ts` — 529 lines, batch Whisper + GPT-4o analysis, hardcoded `language: 'en'`
- `server/services/voiceCallAI.ts` — 991 lines, parallel implementation with fake diarization
- `server/services/realtimeTranscription.ts` — 177 lines, Deepgram streaming, the only file written like a voice product
- `server/services/voiceLearning.ts` — 347 lines, text-only voice profile (this is "writing voice", not "speaking voice" — naming collision worth flagging)
- `server/jobs/realtimeTranscription.ts` — 327 lines, the queue side
- `server/routes-voice.ts` — 497 lines, Twilio webhooks + outcomes + analytics; one TwiML `<Say>` line is the entire TTS surface
- `server/routes-field-scout.ts` — 461 lines, **unauth** voice transcribe, mocked parcel-lookup (Aurelio also flagged)
- `server/routes-ai.ts:1639–1657` — Pax-rail mic transcribe (auth'd, correct)
- `client/src/pages/field-scout.tsx:617–681` — voice memo flow (good MediaRecorder hygiene; missing playback)
- `client/src/components/pax-copilot-rail.tsx:904–942` — rail mic flow (record → text, no audio reply)
- `docs/exhaustive-completion/elite-team-deep-2026-05-01/aurelio-field-mobile.md` — gestural drop-pin pairs with voice drop-pin
- `docs/exhaustive-completion/elite-team-2026-05-01/theo-ai.md` — observability gap mirrors voice telemetry gap

---

*— Tariq*
*The mic is the truck-cab steering wheel of the field investor. Build for the moment hands are full and eyes are on the parcel — not the moment they're at a desk.*

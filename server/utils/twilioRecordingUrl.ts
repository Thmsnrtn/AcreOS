/**
 * The audio URL for a Twilio call recording, or null.
 *
 * Twilio's recording-status callback carries a RecordingUrl that the server
 * then downloads for transcription. Only a recording resource on Twilio's own
 * API host is ever fetched: the URL is rebuilt on that fixed host from a
 * validated `/2010-04-01/Accounts/AC…/Recordings/RE…` path (with `.mp3`, the
 * format the transcriber reads). Anything else is refused.
 */
const TWILIO_API_HOST = "api.twilio.com";
const RECORDING_PATH_RE = /^\/2010-04-01\/Accounts\/AC[0-9a-f]{32}\/Recordings\/RE[0-9a-f]{32}(?:\.mp3)?$/i;

export function twilioRecordingAudioUrl(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" || url.hostname !== TWILIO_API_HOST) return null;
  if (url.username || url.password || url.port || url.search || url.hash) return null;
  if (!RECORDING_PATH_RE.test(url.pathname)) return null;
  const path = url.pathname.replace(/\.mp3$/i, "");
  return `https://${TWILIO_API_HOST}${path}.mp3`;
}

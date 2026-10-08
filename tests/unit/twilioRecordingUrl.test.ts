/**
 * The recording-status callback hands the server a URL to download. The
 * server only ever downloads a Twilio recording: the URL is rebuilt on
 * Twilio's API host from a validated recording path, or refused.
 */
import { describe, it, expect } from "vitest";
import { twilioRecordingAudioUrl } from "../../server/utils/twilioRecordingUrl";

const AC = "AC" + "0123456789abcdef".repeat(2);
const RE = "RE" + "fedcba9876543210".repeat(2);
const PATH = `/2010-04-01/Accounts/${AC}/Recordings/${RE}`;

describe("twilioRecordingAudioUrl", () => {
  it("accepts a Twilio recording URL and returns its .mp3 on api.twilio.com", () => {
    expect(twilioRecordingAudioUrl(`https://api.twilio.com${PATH}`)).toBe(`https://api.twilio.com${PATH}.mp3`);
    expect(twilioRecordingAudioUrl(`https://api.twilio.com${PATH}.mp3`)).toBe(`https://api.twilio.com${PATH}.mp3`);
  });

  it("refuses anything that is not a Twilio recording on Twilio's API host", () => {
    for (const bad of [
      `http://api.twilio.com${PATH}`,
      `https://api.twilio.com.example.com${PATH}`,
      `https://example.com${PATH}`,
      `https://user:pw@api.twilio.com${PATH}`,
      `https://api.twilio.com:8443${PATH}`,
      `https://api.twilio.com/2010-04-01/Accounts/${AC}/Calls/${RE}`,
      `https://api.twilio.com${PATH}?x=1`,
      `https://169.254.169.254/latest/meta-data`,
      "not a url",
      undefined,
      42,
    ]) {
      expect(twilioRecordingAudioUrl(bad), String(bad)).toBeNull();
    }
  });
});

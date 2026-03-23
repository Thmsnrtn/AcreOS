// Usage: npx tsx scripts/test-sms-send.ts --to +15551234567 --message "Hello from AcreOS"
import { smsService } from "../server/services/smsService";

async function main() {
  const args = process.argv.slice(2);
  const toIdx = args.indexOf("--to");
  const msgIdx = args.indexOf("--message");
  const to = toIdx !== -1 ? args[toIdx + 1] : undefined;
  const message = msgIdx !== -1 ? args[msgIdx + 1] : undefined;

  if (!to) {
    console.error("Usage: --to <phone> [--message <text>]");
    process.exit(1);
  }

  const text = message || "This is a test SMS from AcreOS.";

  console.log(`Sending test SMS to ${to}...`);
  try {
    const result = await smsService.sendSMS({
      to,
      message: text,
    });
    if (result.success) {
      console.log("Success:", result);
    } else {
      console.error("SMS send failed:", result.error);
      process.exit(1);
    }
  } catch (err) {
    console.error("Failed:", err);
    process.exit(1);
  }
}
main();

// Usage: npx tsx scripts/test-email-send.ts --to user@example.com --from sender@example.com
import { emailService } from "../server/services/emailService";

async function main() {
  const args = process.argv.slice(2);
  const toIdx = args.indexOf("--to");
  const fromIdx = args.indexOf("--from");
  const to = toIdx !== -1 ? args[toIdx + 1] : undefined;
  const from = fromIdx !== -1 ? args[fromIdx + 1] : undefined;

  if (!to) { console.error("Usage: --to <email> [--from <email>]"); process.exit(1); }

  console.log(`Sending test email to ${to}...`);
  try {
    const result = await emailService.sendEmail({
      to, from: from || "test@acreos.com",
      subject: "AcreOS Test Email",
      html: "<h1>Test Email</h1><p>This is a test email from AcreOS.</p>",
      text: "This is a test email from AcreOS.",
    });
    console.log("Success:", result);
  } catch (err) {
    console.error("Failed:", err);
    process.exit(1);
  }
}
main();

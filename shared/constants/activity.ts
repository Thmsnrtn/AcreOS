/**
 * Runtime-free constants — deliberately importable by the CLIENT.
 *
 * These used to live in `shared/schema.ts`, which is a barrel re-exporting 84
 * drizzle schema modules. Drizzle's column chains (`text("x").notNull()`) are
 * un-annotated calls no bundler can prove side-effect-free, so importing ONE
 * plain constant from that barrel dragged all 541 table definitions into the
 * client entry chunk: ~364 KB raw / 71 KB gzip of Postgres DDL shipped to every
 * user on every route, for tables a browser can never query. Measured — a single
 * constant import still yielded 438/438 tables present in the bundle.
 *
 * That is why this file imports NOTHING. Adding an import of `@shared/schema`
 * here, or of anything that reaches it, silently restores the whole payload;
 * `clientBundleHasNoOrm.test.ts` fails if it happens.
 *
 * `shared/schema.ts` re-exports these so existing server callers are unchanged.
 */

export const ACTIVITY_EVENT_TYPES = {
  email_sent: { name: "Email Sent", icon: "Mail", color: "blue" },
  email_opened: { name: "Email Opened", icon: "MailOpen", color: "green" },
  email_clicked: { name: "Email Clicked", icon: "MousePointer", color: "purple" },
  sms_sent: { name: "SMS Sent", icon: "MessageSquare", color: "cyan" },
  sms_delivered: { name: "SMS Delivered", icon: "MessageCircle", color: "green" },
  mail_sent: { name: "Direct Mail Sent", icon: "FileText", color: "orange" },
  mail_delivered: { name: "Direct Mail Delivered", icon: "Package", color: "green" },
  call_made: { name: "Call Made", icon: "PhoneOutgoing", color: "blue" },
  call_received: { name: "Call Received", icon: "PhoneIncoming", color: "green" },
  note_added: { name: "Note Added", icon: "StickyNote", color: "yellow" },
  stage_changed: { name: "Stage Changed", icon: "ArrowRightCircle", color: "purple" },
  payment_received: { name: "Payment Received", icon: "DollarSign", color: "green" },
  document_uploaded: { name: "Document Uploaded", icon: "Upload", color: "slate" },
  task_created: { name: "Task Created", icon: "ListTodo", color: "blue" },
  task_updated: { name: "Task Updated", icon: "ClipboardEdit", color: "amber" },
  task_completed: { name: "Task Completed", icon: "CheckCircle2", color: "green" },
  // W6.2b — synthetic track events. The deal /track endpoint maps the REAL
  // source tables (offers, seller_communications, campaign_responses,
  // mail_shipment_pieces) into the timeline at query time; these types name
  // the mapped rows. They are never persisted to activity_events.
  offer_sent: { name: "Offer Sent", icon: "Send", color: "blue" },
  offer_viewed: { name: "Offer Viewed", icon: "Eye", color: "purple" },
  offer_response: { name: "Offer Response", icon: "Reply", color: "green" },
  response_received: { name: "Response Received", icon: "Inbox", color: "green" },
} as const;

export type ActivityEventType = keyof typeof ACTIVITY_EVENT_TYPES;

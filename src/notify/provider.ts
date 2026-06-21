import { ENV } from "../server/env.js";

// ===========================================================================
// Notification provider interface (Phase 8). One seam, swappable backends:
//   • LoggerProvider (default) — records the message, no real send. Dev-safe and
//     used until an email provider is configured (D5: never fake liveness).
//   • EmailProvider — gated on EMAIL_* env. Until a real HTTP integration is wired
//     (Phase 11), it behaves as a configured-but-not-sending adapter that reports
//     'skipped' rather than pretending a send succeeded.
// getProvider() picks based on configuration. The delivery RESULT (sent/skipped/
// failed) is always returned so the caller can record an honest notifications row.
// ===========================================================================

export interface NotificationMessage {
  shop: string;
  recipient?: string | null;
  subject: string;
  body: string;
}

export type DeliveryStatus = "sent" | "skipped" | "failed";

export interface DeliveryResult {
  channel: "log" | "email";
  status: DeliveryStatus;
  error?: string;
}

export interface NotificationProvider {
  readonly channel: "log" | "email";
  send(msg: NotificationMessage): Promise<DeliveryResult>;
}

/** Default adapter: structured log only. Never throws; always 'sent' (to the log). */
export class LoggerProvider implements NotificationProvider {
  readonly channel = "log" as const;
  async send(msg: NotificationMessage): Promise<DeliveryResult> {
    console.log(`[notify:log] shop=${msg.shop} to=${msg.recipient ?? "-"} :: ${msg.subject}`);
    return { channel: "log", status: "sent" };
  }
}

/** Email adapter — configured via EMAIL_* env. The real HTTP send lands with the
 *  Phase 11 email integration; until then it reports 'skipped' (configured but not
 *  dispatched) so we never claim a delivery that didn't happen. */
export class EmailProvider implements NotificationProvider {
  readonly channel = "email" as const;
  async send(msg: NotificationMessage): Promise<DeliveryResult> {
    if (!ENV.email.apiKey || !ENV.email.from) {
      return { channel: "email", status: "skipped", error: "email not fully configured" };
    }
    if (!msg.recipient) {
      return { channel: "email", status: "skipped", error: "no recipient" };
    }
    // TODO(Phase 11): real provider HTTP call (Resend/Postmark/SES) using EMAIL_*.
    console.log(`[notify:email] (not yet dispatched) shop=${msg.shop} to=${msg.recipient} :: ${msg.subject}`);
    return { channel: "email", status: "skipped", error: "email dispatch not yet implemented (Phase 11)" };
  }
}

/** True when an email provider is configured well enough to attempt sends. */
export function emailConfigured(): boolean {
  return Boolean(ENV.email.provider && ENV.email.apiKey && ENV.email.from);
}

/** Resolve the active provider. Email when configured, else the dev logger. */
export function getProvider(): NotificationProvider {
  return emailConfigured() ? new EmailProvider() : new LoggerProvider();
}

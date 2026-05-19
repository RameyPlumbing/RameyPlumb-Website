import type { APIRoute } from "astro";
import { Resend } from "resend";

export const prerender = false;

interface ContactPayload {
  name?: string;
  phone?: string;
  email?: string;
  service?: string;
  location?: string;
  message?: string;
  website?: string;    // honeypot
  turnstileToken?: string;
}

const RESEND_API_KEY = import.meta.env.RESEND_API_KEY;
const CONTACT_TO_EMAIL = import.meta.env.CONTACT_TO_EMAIL ?? "dkr1997@gmail.com";
const CONTACT_FROM_EMAIL = import.meta.env.CONTACT_FROM_EMAIL ?? "noreply@rameyplumb.com";
const TURNSTILE_SECRET_KEY = import.meta.env.TURNSTILE_SECRET_KEY;

function escape(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

async function verifyTurnstile(token: string, ip: string | null): Promise<boolean> {
  if (!TURNSTILE_SECRET_KEY) {
    // If not configured, allow through (dev mode). Production should always have this set.
    console.warn("[contact] TURNSTILE_SECRET_KEY not set — skipping verification");
    return true;
  }
  if (!token) return false;

  const body = new URLSearchParams();
  body.append("secret", TURNSTILE_SECRET_KEY);
  body.append("response", token);
  if (ip) body.append("remoteip", ip);

  try {
    const res = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
      method: "POST",
      body,
    });
    const data = (await res.json()) as { success: boolean; "error-codes"?: string[] };
    if (!data.success) {
      console.warn("[contact] Turnstile verification failed:", data["error-codes"]);
    }
    return data.success === true;
  } catch (err) {
    console.error("[contact] Turnstile request error:", err);
    return false;
  }
}

export const POST: APIRoute = async ({ request, clientAddress }) => {
  // Parse JSON safely
  let payload: ContactPayload;
  try {
    payload = (await request.json()) as ContactPayload;
  } catch {
    return new Response(JSON.stringify({ ok: false, error: "Invalid request body." }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  // Honeypot — if filled, silently succeed (don't tip off the bot)
  if (payload.website && payload.website.trim().length > 0) {
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }

  // Required fields
  const name = (payload.name ?? "").trim();
  const phone = (payload.phone ?? "").trim();
  const email = (payload.email ?? "").trim();
  const service = (payload.service ?? "").trim();
  const message = (payload.message ?? "").trim();
  const location = (payload.location ?? "").trim();

  if (!name || !phone || !email || !service || !message) {
    return new Response(JSON.stringify({ ok: false, error: "Please fill out all required fields." }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  // Basic email shape check
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return new Response(JSON.stringify({ ok: false, error: "Please provide a valid email address." }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  // Length sanity check (prevent abuse / pasted content attacks)
  if (name.length > 200 || phone.length > 40 || email.length > 200 ||
      service.length > 100 || location.length > 200 || message.length > 5000) {
    return new Response(JSON.stringify({ ok: false, error: "One or more fields are too long." }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  // Verify Turnstile
  const verified = await verifyTurnstile(payload.turnstileToken ?? "", clientAddress ?? null);
  if (!verified) {
    return new Response(JSON.stringify({ ok: false, error: "Spam check failed. Please refresh and try again." }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  if (!RESEND_API_KEY) {
    console.error("[contact] RESEND_API_KEY not configured.");
    return new Response(JSON.stringify({ ok: false, error: "The contact form is not configured. Please call us instead." }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }

  // Send via Resend
  const resend = new Resend(RESEND_API_KEY);
  const subject = `New estimate request: ${service} — ${name}`;

  const textBody = [
    `Name:     ${name}`,
    `Phone:    ${phone}`,
    `Email:    ${email}`,
    `Service:  ${service}`,
    `Location: ${location || "(not provided)"}`,
    ``,
    `Message:`,
    message,
    ``,
    `---`,
    `Sent from the contact form at rameyplumb.com`,
  ].join("\n");

  const htmlBody = `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 600px; margin: 0 auto; padding: 24px; color: #15192b;">
      <h2 style="color: #122947; margin: 0 0 8px;">New estimate request</h2>
      <p style="color: #6b7785; margin: 0 0 24px; font-size: 14px;">From the contact form at <a href="https://rameyplumb.com" style="color: #6b3fbf;">rameyplumb.com</a></p>

      <table style="width: 100%; border-collapse: collapse; margin-bottom: 24px;">
        <tr><td style="padding: 8px 0; color: #6b7785; width: 100px;">Name</td><td style="padding: 8px 0; font-weight: 600;">${escape(name)}</td></tr>
        <tr><td style="padding: 8px 0; color: #6b7785;">Phone</td><td style="padding: 8px 0; font-weight: 600;"><a href="tel:${escape(phone.replace(/[^0-9+]/g, ""))}" style="color: #6b3fbf; text-decoration: none;">${escape(phone)}</a></td></tr>
        <tr><td style="padding: 8px 0; color: #6b7785;">Email</td><td style="padding: 8px 0; font-weight: 600;"><a href="mailto:${escape(email)}" style="color: #6b3fbf; text-decoration: none;">${escape(email)}</a></td></tr>
        <tr><td style="padding: 8px 0; color: #6b7785;">Service</td><td style="padding: 8px 0; font-weight: 600;">${escape(service)}</td></tr>
        <tr><td style="padding: 8px 0; color: #6b7785;">Location</td><td style="padding: 8px 0; font-weight: 600;">${escape(location || "—")}</td></tr>
      </table>

      <div style="padding: 16px 20px; background: #f5f1ea; border-left: 4px solid #6b3fbf; border-radius: 4px;">
        <div style="color: #6b7785; font-size: 12px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.1em; margin-bottom: 8px;">Message</div>
        <div style="white-space: pre-wrap; line-height: 1.6;">${escape(message)}</div>
      </div>

      <p style="color: #b9c1cb; font-size: 12px; margin-top: 32px;">
        Reply directly to this email to reach ${escape(name)}.
      </p>
    </div>
  `;

  try {
    const result = await resend.emails.send({
      from: `Ramey's Plumbing <${CONTACT_FROM_EMAIL}>`,
      to: [CONTACT_TO_EMAIL],
      replyTo: email,                  // Replying in Gmail goes to the customer
      subject,
      text: textBody,
      html: htmlBody,
    });
    if ((result as any).error) {
      console.error("[contact] Resend error:", (result as any).error);
      return new Response(JSON.stringify({ ok: false, error: "Could not send the message. Please call us instead." }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      });
    }
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("[contact] Send failure:", err);
    return new Response(JSON.stringify({ ok: false, error: "Could not send the message. Please call us instead." }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
};

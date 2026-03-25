const { Resend }      = require('resend');
const AppSettings     = require('../models/AppSettings');

const resend = new Resend(process.env.RESEND_API_KEY);

// Sender — update to a verified domain before going to production.
// In development, Resend allows sending from onboarding@resend.dev.
const FROM = 'SkyWatch <noreply@skywatch.academy>';

// Default copy — used when admin has not overridden the field.
const DEFAULTS = {
  subject: 'Welcome to SkyWatch — Mission Briefing',
  heading: 'Welcome to SkyWatch',
  body:    'Your intelligence briefings are ready. Study RAF aircraft, ranks, bases, squadrons, and doctrine. Test your recall through gamified knowledge checks and earn Aircoins to climb the Intelligence Corps rank ladder.',
  cta:     'Begin Mission',
  footer:  'SkyWatch — Intelligence Study Platform for RAF Applicants &amp; Enthusiasts.<br>If you didn&apos;t create this account, you can safely ignore this email.',
};

// Send a welcome email to a newly registered agent.
// Errors are caught internally so a mail failure never blocks registration.
async function sendWelcomeEmail({ email, agentNumber }) {
  try {
    const appUrl  = process.env.CLIENT_URL || 'http://localhost:5173';
    const s       = await AppSettings.getSettings();

    if (s.emailWelcomeEnabled === false) return;

    const subject = s.welcomeEmailSubject?.trim() || DEFAULTS.subject;
    const heading = s.welcomeEmailHeading?.trim() || DEFAULTS.heading;
    const body    = s.welcomeEmailBody?.trim()    || DEFAULTS.body;
    const cta     = s.welcomeEmailCta?.trim()     || DEFAULTS.cta;
    const footer  = s.welcomeEmailFooter?.trim()  || DEFAULTS.footer;

    const { error } = await resend.emails.send({
      from: FROM,
      to: email,
      subject,
      html: `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f4f8ff;font-family:Arial,Helvetica,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f8ff;padding:48px 20px;">
    <tr><td align="center">
      <table width="100%" style="max-width:520px;background:#ffffff;border-radius:12px;border:1px solid #e2e8f0;overflow:hidden;">

        <!-- Blue accent bar -->
        <tr><td style="background:linear-gradient(90deg,#1d4ed8 0%,#3b82f6 100%);height:4px;font-size:0;line-height:0;">&nbsp;</td></tr>

        <!-- Body -->
        <tr><td style="padding:40px 36px;">

          <p style="font-size:11px;font-weight:700;letter-spacing:0.22em;text-transform:uppercase;color:#1d4ed8;margin:0 0 24px;">
            Classified Transmission
          </p>

          <h1 style="font-size:26px;font-weight:800;color:#0f172a;letter-spacing:-0.02em;margin:0 0 8px;line-height:1.2;">
            ${heading}
          </h1>

          <p style="font-size:13px;color:#94a3b8;letter-spacing:0.04em;margin:0 0 28px;">
            Agent ${agentNumber} — clearance granted.
          </p>

          <p style="font-size:15px;line-height:1.75;color:#334155;margin:0 0 32px;">
            ${body}
          </p>

          <a href="${appUrl}"
             style="display:inline-block;background:#1d4ed8;color:#ffffff;text-decoration:none;
                    font-size:12px;font-weight:700;letter-spacing:0.14em;text-transform:uppercase;
                    padding:13px 30px;border-radius:6px;">
            ${cta}
          </a>

          <p style="font-size:11px;color:#94a3b8;margin:36px 0 0;padding-top:24px;border-top:1px solid #e2e8f0;line-height:1.6;">
            ${footer}
          </p>

        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`,
    });
    if (error) throw new Error(error.message);
  } catch (err) {
    console.error('[email] Welcome email failed for', email, '—', err.message);
  }
}

// Send a 6-digit confirmation code to a new registrant.
// Errors are caught internally so a mail failure returns a clear message to the caller.
async function sendConfirmationEmail({ email, code }) {
  const appUrl = process.env.CLIENT_URL || 'http://localhost:5173';
  const s = await AppSettings.getSettings();
  if (s.emailConfirmationEnabled === false) return;
  const { error } = await resend.emails.send({
    from: FROM,
    to: email,
    subject: 'SkyWatch — Confirm Your Email',
    html: `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f4f8ff;font-family:Arial,Helvetica,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f8ff;padding:48px 20px;">
    <tr><td align="center">
      <table width="100%" style="max-width:520px;background:#ffffff;border-radius:12px;border:1px solid #e2e8f0;overflow:hidden;">

        <!-- Blue accent bar -->
        <tr><td style="background:linear-gradient(90deg,#1d4ed8 0%,#3b82f6 100%);height:4px;font-size:0;line-height:0;">&nbsp;</td></tr>

        <!-- Body -->
        <tr><td style="padding:40px 36px;">

          <p style="font-size:11px;font-weight:700;letter-spacing:0.22em;text-transform:uppercase;color:#1d4ed8;margin:0 0 24px;">
            Classified Transmission
          </p>

          <h1 style="font-size:26px;font-weight:800;color:#0f172a;letter-spacing:-0.02em;margin:0 0 8px;line-height:1.2;">
            Confirm Your Email
          </h1>

          <p style="font-size:15px;line-height:1.75;color:#334155;margin:0 0 28px;">
            Enter the code below to complete your SkyWatch registration. This code expires in <strong>15 minutes</strong>.
          </p>

          <!-- Code block -->
          <div style="background:#f1f5f9;border:1px solid #e2e8f0;border-radius:8px;padding:24px;text-align:center;margin:0 0 28px;">
            <p style="font-size:11px;font-weight:700;letter-spacing:0.18em;text-transform:uppercase;color:#64748b;margin:0 0 12px;">
              Confirmation Code
            </p>
            <p style="font-size:40px;font-weight:800;letter-spacing:0.25em;color:#1d4ed8;margin:0;font-family:'Courier New',Courier,monospace;">
              ${code}
            </p>
          </div>

          <a href="${appUrl}/login?tab=verify&email=${encodeURIComponent(email)}"
             style="display:inline-block;background:#1d4ed8;color:#ffffff;text-decoration:none;
                    font-size:12px;font-weight:700;letter-spacing:0.14em;text-transform:uppercase;
                    padding:13px 30px;border-radius:6px;">
            Open SkyWatch
          </a>

          <p style="font-size:11px;color:#94a3b8;margin:36px 0 0;padding-top:24px;border-top:1px solid #e2e8f0;line-height:1.6;">
            SkyWatch — Intelligence Study Platform for RAF Applicants &amp; Enthusiasts.<br>
            If you didn&apos;t request this code, you can safely ignore this email.
          </p>

        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`,
  });
  if (error) throw new Error(error.message);
}

module.exports = { sendWelcomeEmail, sendConfirmationEmail };

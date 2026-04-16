// Shared HTML shell for transactional emails. Each mailer passes only the
// variable parts (heading, subtitle, body, optional middle block, CTA, footer)
// and this builder produces the surrounding layout (blue accent bar, card,
// "Classified Transmission" header).
function buildEmailHTML({ heading, subtitle = '', body = '', middle = '', ctaText, ctaUrl, footer }) {
  const subtitleHtml = subtitle
    ? `
          <p style="font-size:13px;color:#94a3b8;letter-spacing:0.04em;margin:0 0 28px;">
            ${subtitle}
          </p>`
    : '';
  const bodyHtml = body
    ? `
          <p style="font-size:15px;line-height:1.75;color:#334155;margin:0 0 ${middle ? '28' : '32'}px;">
            ${body}
          </p>`
    : '';
  const middleHtml = middle ? `\n          ${middle}` : '';
  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f4f8ff;font-family:Arial,Helvetica,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f8ff;padding:48px 20px;">
    <tr><td align="center">
      <table width="100%" style="max-width:520px;background:#ffffff;border-radius:12px;border:1px solid #e2e8f0;overflow:hidden;">

        <tr><td style="background:linear-gradient(90deg,#1d4ed8 0%,#3b82f6 100%);height:4px;font-size:0;line-height:0;">&nbsp;</td></tr>

        <tr><td style="padding:40px 36px;">

          <p style="font-size:11px;font-weight:700;letter-spacing:0.22em;text-transform:uppercase;color:#1d4ed8;margin:0 0 24px;">
            Classified Transmission
          </p>

          <h1 style="font-size:26px;font-weight:800;color:#0f172a;letter-spacing:-0.02em;margin:0 0 8px;line-height:1.2;">
            ${heading}
          </h1>${subtitleHtml}${bodyHtml}${middleHtml}

          <a href="${ctaUrl}"
             style="display:inline-block;background:#1d4ed8;color:#ffffff;text-decoration:none;
                    font-size:12px;font-weight:700;letter-spacing:0.14em;text-transform:uppercase;
                    padding:13px 30px;border-radius:6px;">
            ${ctaText}
          </a>

          <p style="font-size:11px;color:#94a3b8;margin:36px 0 0;padding-top:24px;border-top:1px solid #e2e8f0;line-height:1.6;">
            ${footer}
          </p>

        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

module.exports = { buildEmailHTML };

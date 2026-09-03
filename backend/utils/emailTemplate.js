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
  // The CTA is optional: admin-composed emails place their button inline within
  // the body (via a {{button}} marker) and pass no ctaText, so nothing should
  // render here. Transactional emails still pass ctaText and are unaffected.
  const ctaHtml = ctaText
    ? `\n          <a href="${ctaUrl}"
             style="display:inline-block;background:#1d4ed8;color:#ffffff;text-decoration:none;
                    font-size:12px;font-weight:700;letter-spacing:0.14em;text-transform:uppercase;
                    padding:13px 30px;border-radius:6px;">
            ${ctaText}
          </a>\n`
    : '';
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
          </h1>${subtitleHtml}${bodyHtml}${middleHtml}${ctaHtml}

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

// The CTA button, as a single line. Built single-line on purpose: the newline
// pass in formatComposedBody below would otherwise split it across paragraphs.
function buildCtaButton(label, href) {
  const text = label?.trim();
  if (!text) return '';
  return `<a href="${href}" style="display:inline-block;background:#1d4ed8;color:#ffffff;text-decoration:none;font-size:12px;font-weight:700;letter-spacing:0.14em;text-transform:uppercase;padding:13px 30px;border-radius:6px;">${text}</a>`;
}

// A run of "- " lines becomes one panel of ticked rows.
//
// The only markup the body understands, and it exists because the alternative
// was prose. An outreach email is skimmed in about two seconds, and the reasons
// someone should act cannot survive being the third sentence of a paragraph —
// they have to be things the eye lands on. Everything else about the plain-text
// editing model stays as it was: an admin who never types a dash never sees any
// of this.
//
// Tables and inline styles rather than lists and classes, because Outlook does
// not do the alternative. The block closes the surrounding <p> and opens a new
// one so it is a sibling rather than a table nested inside a paragraph, which
// browsers silently reword and some clients render with stray margins.
const PARA_OPEN = '<p style="font-size:15px;line-height:1.75;color:#334155;margin:0 0 20px;">';

function reasonRow(text) {
  return '<tr>'
    + '<td valign="top" style="width:26px;padding:0 0 14px;">'
    + '<div style="width:18px;height:18px;line-height:18px;border-radius:9px;background:#dbeafe;'
    + 'color:#1d4ed8;font-size:11px;font-weight:700;text-align:center;">&#10003;</div></td>'
    + `<td style="padding:0 0 14px;font-size:15px;line-height:1.6;color:#334155;">${text}</td>`
    + '</tr>';
}

function renderReasonBlocks(text) {
  const lines = text.split('\n');
  const out = [];
  let run = [];

  const flush = () => {
    if (!run.length) return;
    const rows = run.map(reasonRow).join('');
    out.push(
      '</p>'
      + '<table width="100%" cellpadding="0" cellspacing="0" role="presentation" '
      + 'style="margin:4px 0 26px;border-collapse:collapse;">'
      + rows
      + '</table>'
      + PARA_OPEN,
    );
    run = [];
  };

  for (const line of lines) {
    const m = line.match(/^\s*-\s+(.*)$/);
    if (m && m[1].trim()) {
      run.push(m[1].trim());
    } else {
      flush();
      out.push(line);
    }
  }
  flush();
  return out.join('\n');
}

// Turn plain admin-authored text into the email's body HTML.
//
// Escape, auto-link any http(s) URLs that were pasted in (trailing sentence
// punctuation is left outside the link), drop in the CTA button, then turn
// blank lines into paragraphs and single newlines into <br> so the composition
// renders the way it was typed. Button placement and linking both happen
// before the newline pass so neither can run past a line break.
//
// Shared by every mailer that takes free text (the admin composer and the CBAT
// questionnaire) AND mirrored on the client in Admin.jsx:buildEmailPreviewHTML.
// It lives here so there is one definition to keep those in step — a preview
// that formats differently to the real send is worse than no preview.
function formatComposedBody(body, buttonHtml) {
  let out = String(body ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/(https?:\/\/[^\s]+?)([.,!?;:]*)(?=\s|$)/g,
      '<a href="$1" style="color:#1d4ed8;text-decoration:underline;">$1</a>$2');
  if (buttonHtml && !out.includes('{{button}}')) out += '\n\n{{button}}';
  out = renderReasonBlocks(out.replace(/\{\{button\}\}/g, buttonHtml || ''));
  return out
    .replace(/\n{2,}/g, `</p>${PARA_OPEN}`)
    .replace(/\n/g, '<br>')
    // A block at the very top or bottom leaves an empty paragraph behind, which
    // is invisible but still carries its bottom margin.
    .replace(/<p[^>]*>(\s|<br>)*<\/p>/g, '');
}

module.exports = { buildEmailHTML, buildCtaButton, formatComposedBody };

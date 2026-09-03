/**
 * emailTemplate.test.js
 *
 * formatComposedBody — the shared body formatter behind the admin composer, the
 * questionnaire mailer and the client-side preview.
 *
 * The "- " reason rows are the only markup it understands. They exist because an
 * outreach email is skimmed, not read, so the reasons to act have to be things
 * the eye lands on rather than the third sentence of a paragraph.
 */

const { formatComposedBody, buildCtaButton } = require('../../utils/emailTemplate');

const BUTTON = buildCtaButton('Answer', 'https://skywatch.academy/survey/x');

describe('formatComposedBody — plain text', () => {
  it('turns blank lines into paragraphs and single newlines into breaks', () => {
    const out = formatComposedBody('One.\n\nTwo.\nStill two.', '');
    expect(out).toContain('</p><p');
    expect(out).toContain('Two.<br>Still two.');
  });

  it('escapes HTML the author typed', () => {
    expect(formatComposedBody('<script>alert(1)</script>', '')).not.toContain('<script>');
  });

  it('auto-links a pasted URL, leaving sentence punctuation outside it', () => {
    const out = formatComposedBody('Go to https://skywatch.academy.', '');
    expect(out).toContain('href="https://skywatch.academy"');
    expect(out).toContain('</a>.');
  });

  it('appends the button when no marker is given', () => {
    expect(formatComposedBody('Hello.', BUTTON)).toContain('Answer</a>');
  });

  it('places the button at the marker instead', () => {
    const out = formatComposedBody('Before.\n\n{{button}}\n\nAfter.', BUTTON);
    expect(out.indexOf('Answer</a>')).toBeLessThan(out.indexOf('After.'));
  });
});

describe('formatComposedBody — reason rows', () => {
  const body = 'Lead in.\n\n- First reason\n- Second reason\n\nTail.';

  it('groups a run of dashes into one table, not three', () => {
    const out = formatComposedBody(body, '');
    expect((out.match(/<table/g) ?? [])).toHaveLength(1);
    expect((out.match(/&#10003;/g) ?? [])).toHaveLength(2);
  });

  it('keeps the surrounding prose', () => {
    const out = formatComposedBody(body, '');
    expect(out).toContain('Lead in.');
    expect(out).toContain('Tail.');
    expect(out).toContain('First reason');
  });

  it('emits the table as a sibling of the paragraphs, never nested inside one', () => {
    // A table inside a <p> is reworded by the parser and picks up stray margins
    // in some clients.
    const out = formatComposedBody(body, '');
    expect(out).not.toMatch(/<p[^>]*>[^<]*<table/);
    expect(out).toContain('</p><table');
  });

  it('leaves no empty paragraph when the run opens or closes the body', () => {
    const out = formatComposedBody('- Only a reason', '');
    expect(out).not.toMatch(/<p[^>]*>(\s|<br>)*<\/p>/);
  });

  it('escapes the row text like everything else', () => {
    expect(formatComposedBody('- <b>bold</b>', '')).not.toContain('<b>bold</b>');
  });

  it('ignores a dash that is not a list marker', () => {
    const out = formatComposedBody('A well-known thing - really.', '');
    expect(out).not.toContain('<table');
  });

  it('ignores a bare dash on its own line', () => {
    expect(formatComposedBody('-\n', '')).not.toContain('<table');
  });

  it('does not disturb a body with no rows at all', () => {
    const plain = 'Just prose.\n\nMore prose.';
    expect(formatComposedBody(plain, '')).not.toContain('<table');
  });
});

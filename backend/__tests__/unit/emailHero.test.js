/**
 * emailHero.test.js
 *
 * The animated radar header on the CBAT questionnaire email. The animation is
 * CSS only, so what these tests guard is the fallback story: a client that
 * strips keyframes must still get a complete static radar from the inline
 * styles alone, Outlook for Windows must get nothing, and the mailers that do
 * NOT ask for the hero must render exactly as they always have.
 */

const { radarHero, BLIPS, PERIOD } = require('../../utils/emailHero');
const { buildEmailHTML }  = require('../../utils/emailTemplate');
const { renderSurveyEmail, SURVEY_DEFAULTS } = require('../../utils/surveyEmail');

describe('radarHero', () => {
  const hero = radarHero();

  it('drives every moving part from the head CSS, not inline', () => {
    for (const name of ['sw-spin', 'sw-ping', 'sw-blip', 'sw-shimmer', 'sw-status']) {
      expect(hero.css).toContain(`@keyframes ${name}`);
    }
    // Inline styles are what Gmail keeps; no animation may live there or a
    // stripped property leaves a half-drawn scope behind.
    expect(hero.html).not.toMatch(/style="[^"]*animation/);
    expect(hero.html).not.toMatch(/position\s*:/);
  });

  it('is hidden from Outlook for Windows with an mso conditional', () => {
    expect(hero.html).toContain('<!--[if !mso]><!-- -->');
    expect(hero.html).toContain('<!--<![endif]-->');
  });

  it('stacks the layers with zero-height wrappers so the scope survives without position', () => {
    expect((hero.html.match(/height:0;overflow:visible;/g) ?? []).length).toBeGreaterThanOrEqual(3);
  });

  it('lights each blip when the beam reaches it', () => {
    // A blip's delay is its clockwise angle as a fraction of the sweep period.
    const period = parseFloat(PERIOD);
    for (const b of BLIPS) {
      const delay = parseFloat(b.delay);
      expect(delay).toBeGreaterThan(0);
      expect(delay).toBeLessThan(period);
      expect(hero.css).toContain(`.${b.cls} { animation-delay: ${b.delay}; }`);
      expect(hero.html).toContain(`class="sw-blip ${b.cls}"`);
    }
  });

  it('keeps the blips visible in the static fallback', () => {
    // Dim, not gone: a client with no animation still sees contacts on the scope.
    const blipStyles = hero.html.match(/class="sw-blip[^"]*" style="([^"]*)"/g) ?? [];
    expect(blipStyles).toHaveLength(BLIPS.length);
    for (const s of blipStyles) expect(s).toMatch(/opacity:\.55/);
  });

  it('hides the ping in the static fallback so no second ring appears', () => {
    expect(hero.html).toMatch(/class="sw-ping" style="[^"]*opacity:0;/);
  });
});

describe('buildEmailHTML — hero slots', () => {
  const base = { heading: 'H', footer: 'F', ctaText: 'Go', ctaUrl: 'https://x' };

  it('renders no <style> and the static bar when nothing is asked for', () => {
    const html = buildEmailHTML(base);
    expect(html).not.toContain('<style');
    expect(html).not.toContain('sw-bar');
    expect(html).toContain('background:linear-gradient(90deg,#1d4ed8 0%,#3b82f6 100%);height:4px');
  });

  it('paints the hero above the accent bar and the CSS in the head', () => {
    const html = buildEmailHTML({ ...base, hero: '<tr><td>HERO</td></tr>', headCss: '.x{}', animatedBar: true });
    expect(html).toContain('<style type="text/css">.x{}</style></head>');
    expect(html.indexOf('HERO')).toBeLessThan(html.indexOf('class="sw-bar"'));
    expect(html).toContain('background-size:1040px 4px');
  });
});

describe('renderSurveyEmail', () => {
  it('carries the animated radar and the shimmer bar', () => {
    const fields = {
      subject: SURVEY_DEFAULTS.subject, heading: SURVEY_DEFAULTS.heading,
      subtitle: SURVEY_DEFAULTS.subtitle, body: SURVEY_DEFAULTS.body,
      ctaText: SURVEY_DEFAULTS.cta, footer: SURVEY_DEFAULTS.footer,
    };
    const { html } = renderSurveyEmail({ fields, user: { displayName: 'Pilot', agentNumber: '1' }, token: 't' });
    expect(html).toContain('@keyframes sw-spin');
    expect(html).toContain('class="sw-sweep"');
    expect(html).toContain('class="sw-bar"');
    expect(html).toContain('Classified Transmission');
    // The hero sits inside the card, before the accent bar and the copy.
    expect(html.indexOf('sw-sweep')).toBeLessThan(html.indexOf('sw-bar'));
    expect(html.indexOf('sw-bar')).toBeLessThan(html.indexOf('Classified Transmission'));
  });
});

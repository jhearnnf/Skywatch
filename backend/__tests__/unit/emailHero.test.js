/**
 * emailHero.test.js
 *
 * The animated radar header on the CBAT questionnaire email. It is an
 * animated GIF fetched from the public site, because CSS animation is
 * stripped by Gmail and Outlook. What these tests guard: the image is linked
 * by absolute URL under the site origin (never a relative path, never the
 * backend), it sizes correctly in Outlook for Windows, and the mailers that do
 * NOT ask for the hero render exactly as they always have.
 */

const { radarHero, heroImageUrl, HERO_PATH, HERO_WIDTH, HERO_HEIGHT } = require('../../utils/emailHero');
const { buildEmailHTML }  = require('../../utils/emailTemplate');
const { renderSurveyEmail, listUnsubscribeHeaders, SURVEY_DEFAULTS } = require('../../utils/surveyEmail');

describe('radarHero', () => {
  const hero = radarHero({ baseUrl: 'https://skywatch.academy' });

  it('links the GIF by absolute URL on the site origin', () => {
    expect(hero.html).toContain(`src="https://skywatch.academy${HERO_PATH}"`);
    expect(heroImageUrl('https://skywatch.academy/')).toBe(`https://skywatch.academy${HERO_PATH}`);
  });

  it('refuses to render without a base URL rather than emitting a relative src', () => {
    // A relative path resolves against nothing in an inbox: the image would
    // simply be missing.
    expect(() => radarHero({})).toThrow(/public site URL/);
  });

  it('sizes the image with attributes for Outlook and inline width for everyone else', () => {
    expect(hero.html).toMatch(new RegExp(`<img [^>]*width="${HERO_WIDTH}" height="${HERO_HEIGHT}"`));
    expect(hero.html).toMatch(/<img [^>]*style="[^"]*width:100%;max-width:520px;height:auto/);
    expect(hero.html).toMatch(/<img [^>]*alt="/);
  });

  it('keeps the moving CSS in the head, never inline', () => {
    for (const name of ['sw-shimmer', 'sw-status']) {
      expect(hero.css).toContain(`@keyframes ${name}`);
    }
    expect(hero.html).not.toMatch(/style="[^"]*animation/);
  });

  it('paints the image and the status line on the navy background', () => {
    // The GIF's edges are flat navy, so the cell behind it must match or a
    // seam shows where the image ends.
    expect((hero.html.match(/bgcolor="#06101e"/g) ?? []).length).toBe(2);
    expect(hero.html).toContain('Signal acquired');
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
  it('uses the plain header while the radar GIF is parked', () => {
    const fields = {
      subject: SURVEY_DEFAULTS.subject, heading: SURVEY_DEFAULTS.heading,
      subtitle: SURVEY_DEFAULTS.subtitle, body: SURVEY_DEFAULTS.body,
      ctaText: SURVEY_DEFAULTS.cta, footer: SURVEY_DEFAULTS.footer,
    };
    const { html } = renderSurveyEmail({ fields, user: { displayName: 'Pilot', agentNumber: '1' }, token: 't' });
    expect(html).not.toContain(HERO_PATH);
    expect(html).not.toContain('<style');
    expect(html).not.toContain('sw-bar');
    expect(html).toContain('Classified Transmission');
  });
});

describe('listUnsubscribeHeaders', () => {
  it('points one-click unsubscribe at the backend over https', () => {
    const h = listUnsubscribeHeaders('abc');
    expect(h['List-Unsubscribe']).toMatch(/^<https:\/\/[^>]+\/api\/survey\/abc\/unsubscribe>$/);
    expect(h['List-Unsubscribe-Post']).toBe('List-Unsubscribe=One-Click');
  });
});

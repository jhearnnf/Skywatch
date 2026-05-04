const {
  describeTone,
  trimToLimit,
  extractFirstJson,
  briefSummaryForPrompt,
  generateDailyRecon,
  generateDailyReconInfo,
  generateLatestIntel,
  generateBrandTransparency,
  generateDraft,
  SITE_BASE_URL,
  X_CHAR_LIMIT,
  POST_TYPES,
  VARIANT_NUDGES,
  VARIANT_TEMPERATURE,
  variantNudge,
} = require('../../utils/socialDraftGenerator');

function makeBrief(overrides = {}) {
  return {
    _id: '6800000000000000000000aa',
    title: 'Eurofighter Typhoon',
    subtitle: 'RAF multirole fighter',
    category: 'Aircrafts',
    subcategory: 'Combat',
    descriptionSections: [
      { heading: 'Overview', body: 'Twin-engine, canard-delta, supercruise-capable.' },
      { heading: 'Role',     body: 'QRA over UK and NATO airspace.' },
    ],
    ...overrides,
  };
}

function chatStub(content) {
  return jest.fn().mockResolvedValue({
    choices: [{ message: { content } }],
  });
}

// ─── helpers ─────────────────────────────────────────────────────────────────

describe('describeTone', () => {
  test('produces visibly different text at the extremes', () => {
    const low  = describeTone(1);
    const mid  = describeTone(7);
    const high = describeTone(10);
    expect(low).not.toEqual(mid);
    expect(mid).not.toEqual(high);
    expect(low.toLowerCase()).toMatch(/military|formal/);
    expect(high.toLowerCase()).toMatch(/cheeky|wild|carefree|wit/);
  });

  test('clamps out-of-range values', () => {
    expect(describeTone(0)).toBe(describeTone(1));
    expect(describeTone(99)).toBe(describeTone(10));
  });
});

describe('trimToLimit', () => {
  test('passes through short text unchanged', () => {
    expect(trimToLimit('hello')).toBe('hello');
  });

  test('cuts at a word boundary when the limit lands mid-word', () => {
    const long = 'one two three four five six seven eight nine ten eleven twelve thirteen';
    const out = trimToLimit(long, 30);
    expect(out.length).toBeLessThanOrEqual(30);
    // The cut should fall on a space boundary, so out should not end mid-word
    // for one of the "long" tail words.
    expect(out.endsWith(' ')).toBe(false);
    expect(long.startsWith(out)).toBe(true);
  });

  test('respects 280 by default', () => {
    const long = 'x'.repeat(400);
    expect(trimToLimit(long).length).toBeLessThanOrEqual(X_CHAR_LIMIT);
  });

  test('cuts on a sentence boundary when one exists, dropping the dangling clause', () => {
    // Two complete sentences then a truncating tail. Limit lands inside the tail.
    const text = 'RAF Valley got a mixed-reality upgrade. Eleven sims now let pilots practise circuits in VR. ' +
      'Turns out the best way to train fighter pilots is to make them think they are actually flying jets which never quite happens';
    const out = trimToLimit(text, 200);
    expect(out.length).toBeLessThanOrEqual(200);
    // Ends on a full-stop, not mid-word/clause.
    expect(/[.!?]$/.test(out)).toBe(true);
    expect(out.endsWith('VR.')).toBe(true);
  });

  test('falls back to word boundary when no sentence ending fits in the cut', () => {
    const text = 'one two three four five six seven eight nine ten eleven twelve thirteen fourteen';
    const out = trimToLimit(text, 30);
    expect(out.length).toBeLessThanOrEqual(30);
    expect(out.endsWith(' ')).toBe(false);
    expect(text.startsWith(out)).toBe(true);
  });
});

describe('extractFirstJson', () => {
  test('parses a clean JSON object', () => {
    expect(extractFirstJson('{"a":1}')).toEqual({ a: 1 });
  });

  test('strips markdown fences', () => {
    expect(extractFirstJson('```json\n{"a":1}\n```')).toEqual({ a: 1 });
  });

  test('finds the JSON inside surrounding text', () => {
    expect(extractFirstJson('Sure! {"b":2} hope this helps')).toEqual({ b: 2 });
  });

  test('throws on no JSON', () => {
    expect(() => extractFirstJson('not json at all')).toThrow();
  });
});

describe('briefSummaryForPrompt', () => {
  test('includes title, subtitle, category and sections', () => {
    const out = briefSummaryForPrompt(makeBrief());
    expect(out).toContain('Eurofighter Typhoon');
    expect(out).toContain('RAF multirole fighter');
    expect(out).toContain('Aircrafts');
    expect(out).toContain('Overview:');
    expect(out).toContain('canard-delta');
  });

  test('handles legacy string sections', () => {
    const b = makeBrief({ descriptionSections: ['legacy paragraph'] });
    const out = briefSummaryForPrompt(b);
    expect(out).toContain('legacy paragraph');
  });

  test('returns empty string for null', () => {
    expect(briefSummaryForPrompt(null)).toBe('');
  });
});

// ─── daily-recon ─────────────────────────────────────────────────────────────

describe('generateDailyRecon', () => {
  test('happy path returns text + poll + sourceMeta with site CTA appended', async () => {
    const openRouterChat = chatStub(JSON.stringify({
      text: 'Eurofighter Typhoon — what generation fighter is it?',
      pollOptions: ['Gen 4', 'Gen 4.5', 'Gen 5', 'Gen 6'],
      correctIndex: 1,
    }));
    const out = await generateDailyRecon({ brief: makeBrief(), tone: 7, openRouterChat });
    expect(out.text).toContain('Eurofighter Typhoon');
    expect(out.text).toContain('Read more briefs here:');
    expect(out.text).toContain(SITE_BASE_URL);
    // Daily-recon must NOT link to a specific brief — many are tier-gated, so
    // a per-brief link would dump the user on a sign-in wall.
    expect(out.text).not.toContain('/brief/');
    expect(out.poll.options).toEqual(['Gen 4', 'Gen 4.5', 'Gen 5', 'Gen 6']);
    expect(out.poll.duration_minutes).toBeGreaterThan(0);
    expect(out.sourceMeta.briefName).toBe('Eurofighter Typhoon');
    expect(out.sourceMeta.correctIndex).toBe(1);
  });

  test('CTA sits at the very end of the post and tells the model to budget for it', async () => {
    const openRouterChat = chatStub(JSON.stringify({
      text: 'Q?', pollOptions: ['a', 'b'], correctIndex: 0,
    }));
    const out = await generateDailyRecon({ brief: makeBrief(), tone: 7, openRouterChat });
    expect(out.text.endsWith(SITE_BASE_URL)).toBe(true);
    const sys = openRouterChat.mock.calls[0][0].messages.find(m => m.role === 'system').content;
    expect(sys).toMatch(/system will AUTOMATICALLY append/);
    expect(sys).toMatch(/Do NOT include any URL/);
    // Prose budget should be reduced by the CTA length, not the hardcoded 275.
    const ctaLen = `\n\nRead more briefs here: ${SITE_BASE_URL}`.length;
    expect(sys).toContain(`≤${280 - ctaLen} chars total`);
  });

  test('HARD LIMIT in guardrails uses the prose budget, not 280, and warns against X.com 280', async () => {
    const openRouterChat = chatStub(JSON.stringify({
      text: 'Q?', pollOptions: ['a', 'b'], correctIndex: 0,
    }));
    await generateDailyRecon({ brief: makeBrief(), tone: 7, openRouterChat });
    const sys = openRouterChat.mock.calls[0][0].messages.find(m => m.role === 'system').content;
    const ctaLen = `\n\nRead more briefs here: ${SITE_BASE_URL}`.length;
    const proseBudget = 280 - ctaLen;
    // The HARD LIMIT line must reference the prose budget, NOT 280.
    expect(sys).toMatch(new RegExp(`HARD LIMIT: ≤${proseBudget} characters of PROSE`));
    // It must also explicitly warn the model NOT to use 280 as its target.
    expect(sys).toMatch(/do NOT use X\.com's 280-char tweet limit as your target/i);
    // The old "≤280 characters total (X.com tweet limit)" wording must not leak in.
    expect(sys).not.toMatch(/HARD LIMIT: ≤280 characters total/);
  });

  test('honours an injected siteBaseUrl override', async () => {
    const openRouterChat = chatStub(JSON.stringify({
      text: 'Q?', pollOptions: ['a', 'b'], correctIndex: 0,
    }));
    const out = await generateDailyRecon({
      brief: makeBrief(), tone: 7, openRouterChat, siteBaseUrl: 'https://staging.example.com',
    });
    expect(out.text).toContain('Read more briefs here: https://staging.example.com');
    expect(out.text).not.toContain('/brief/');
  });

  test('still appends the site CTA when the brief has no _id', async () => {
    const openRouterChat = chatStub(JSON.stringify({
      text: 'Q?', pollOptions: ['a', 'b'], correctIndex: 0,
    }));
    const out = await generateDailyRecon({
      brief: makeBrief({ _id: undefined }), tone: 7, openRouterChat,
    });
    expect(out.text).toContain('Read more briefs here:');
    expect(out.text).toContain(SITE_BASE_URL);
    expect(out.sourceMeta.briefId).toBeNull();
  });

  test('preserves overlong model prose verbatim — no truncation', async () => {
    const openRouterChat = chatStub(JSON.stringify({
      text: 'x'.repeat(400),
      pollOptions: ['a', 'b'],
      correctIndex: 0,
    }));
    const out = await generateDailyRecon({ brief: makeBrief(), tone: 7, openRouterChat });
    // Show full AI output to the editor; human trims overflow manually.
    expect(out.text.length).toBeGreaterThan(X_CHAR_LIMIT);
    expect(out.text).toMatch(/^x{400}/);
    expect(out.text).toContain('Read more briefs here:');
  });

  test('clamps too-long poll options to 25 chars', async () => {
    const openRouterChat = chatStub(JSON.stringify({
      text: 'Q?',
      pollOptions: ['x'.repeat(40), 'short'],
      correctIndex: 0,
    }));
    const out = await generateDailyRecon({ brief: makeBrief(), tone: 7, openRouterChat });
    out.poll.options.forEach(o => expect(o.length).toBeLessThanOrEqual(25));
  });

  test('truncates >4 options', async () => {
    const openRouterChat = chatStub(JSON.stringify({
      text: 'Q?',
      pollOptions: ['a', 'b', 'c', 'd', 'e', 'f'],
      correctIndex: 0,
    }));
    const out = await generateDailyRecon({ brief: makeBrief(), tone: 7, openRouterChat });
    expect(out.poll.options).toHaveLength(4);
  });

  test('throws on <2 options', async () => {
    const openRouterChat = chatStub(JSON.stringify({
      text: 'Q?', pollOptions: ['only one'], correctIndex: 0,
    }));
    await expect(generateDailyRecon({ brief: makeBrief(), tone: 7, openRouterChat }))
      .rejects.toThrow(/<2 poll options/);
  });

  test('clamps correctIndex into the option range', async () => {
    const openRouterChat = chatStub(JSON.stringify({
      text: 'Q?', pollOptions: ['a', 'b'], correctIndex: 99,
    }));
    const out = await generateDailyRecon({ brief: makeBrief(), tone: 7, openRouterChat });
    expect(out.sourceMeta.correctIndex).toBe(1);
  });

  test('uses tone in the system prompt', async () => {
    const openRouterChat = chatStub(JSON.stringify({
      text: 'Q?', pollOptions: ['a', 'b'], correctIndex: 0,
    }));
    await generateDailyRecon({ brief: makeBrief(), tone: 10, openRouterChat });
    const messages = openRouterChat.mock.calls[0][0].messages;
    const sys = messages.find(m => m.role === 'system').content;
    expect(sys).toContain('cheeky');
  });

  test('throws if no brief supplied', async () => {
    await expect(generateDailyRecon({ tone: 7, openRouterChat: jest.fn() }))
      .rejects.toThrow(/brief/);
  });
});

// ─── daily-recon-info ────────────────────────────────────────────────────────

describe('generateDailyReconInfo', () => {
  test('returns plain text, no poll, with brief URL CTA appended', async () => {
    const openRouterChat = chatStub('The Eurofighter Typhoon can supercruise — supersonic without afterburners.');
    const brief = makeBrief();
    const out = await generateDailyReconInfo({ brief, tone: 7, openRouterChat });
    expect(out.text).toContain('Typhoon');
    expect(out.text).toContain('Read the full brief:');
    expect(out.text).toContain(`${SITE_BASE_URL}/brief/${brief._id}`);
    expect(out.poll).toBeNull();
    expect(out.sourceMeta.briefName).toBe('Eurofighter Typhoon');
    expect(out.sourceMeta.briefUrl).toBe(`${SITE_BASE_URL}/brief/${brief._id}`);
  });

  test('CTA sits at the very end of the post', async () => {
    const openRouterChat = chatStub('A factual info tweet body.');
    const brief = makeBrief();
    const out = await generateDailyReconInfo({ brief, tone: 7, openRouterChat });
    expect(out.text.endsWith(`${SITE_BASE_URL}/brief/${brief._id}`)).toBe(true);
  });

  test('preserves full model output verbatim — no truncation', async () => {
    const openRouterChat = chatStub('x'.repeat(400));
    const out = await generateDailyReconInfo({ brief: makeBrief(), tone: 7, openRouterChat });
    expect(out.text.length).toBeGreaterThan(X_CHAR_LIMIT);
    expect(out.text).toMatch(/^x{400}/);
    expect(out.text).toContain('Read the full brief:');
  });

  test('honours an injected siteBaseUrl override', async () => {
    const openRouterChat = chatStub('body');
    const brief = makeBrief();
    const out = await generateDailyReconInfo({
      brief, tone: 7, openRouterChat, siteBaseUrl: 'https://staging.example.com',
    });
    expect(out.text).toContain(`https://staging.example.com/brief/${brief._id}`);
    expect(out.sourceMeta.briefUrl).toBe(`https://staging.example.com/brief/${brief._id}`);
  });

  test('skips the CTA when the brief has no _id', async () => {
    const openRouterChat = chatStub('stand-alone info tweet');
    const out = await generateDailyReconInfo({
      brief: makeBrief({ _id: undefined }), tone: 7, openRouterChat,
    });
    expect(out.text).toBe('stand-alone info tweet');
    expect(out.text).not.toContain('Read the full brief:');
    expect(out.sourceMeta.briefUrl).toBeNull();
  });

  test('HARD LIMIT in guardrails uses the prose budget, not 280', async () => {
    const openRouterChat = chatStub('body');
    const brief = makeBrief();
    await generateDailyReconInfo({ brief, tone: 7, openRouterChat });
    const sys = openRouterChat.mock.calls[0][0].messages.find(m => m.role === 'system').content;
    const ctaLen = `\n\nRead the full brief: ${SITE_BASE_URL}/brief/${brief._id}`.length;
    const proseBudget = 280 - ctaLen;
    expect(sys).toMatch(new RegExp(`HARD LIMIT: ≤${proseBudget} characters of PROSE`));
    expect(sys).toMatch(/do NOT use X\.com's 280-char tweet limit as your target/i);
    expect(sys).not.toMatch(/HARD LIMIT: ≤280 characters total/);
  });

  test('throws if no brief supplied', async () => {
    await expect(generateDailyReconInfo({ tone: 7, openRouterChat: jest.fn() }))
      .rejects.toThrow(/brief/);
  });

  test('throws on empty model response', async () => {
    const openRouterChat = chatStub('');
    await expect(generateDailyReconInfo({ brief: makeBrief(), tone: 7, openRouterChat }))
      .rejects.toThrow(/empty/);
  });
});

// ─── latest-intel ────────────────────────────────────────────────────────────

describe('generateLatestIntel', () => {
  test('returns plain text, no poll, with brief URL CTA appended', async () => {
    const openRouterChat = chatStub('Eurofighter Typhoon scrambled to escort an unidentified aircraft over the North Sea.');
    const brief = makeBrief();
    const out = await generateLatestIntel({ brief, tone: 7, openRouterChat });
    expect(out.text).toContain('Typhoon');
    expect(out.text).toContain('Read the full brief:');
    expect(out.text).toContain(`${SITE_BASE_URL}/brief/${brief._id}`);
    expect(out.poll).toBeNull();
    expect(out.sourceMeta.briefName).toBe('Eurofighter Typhoon');
    expect(out.sourceMeta.briefUrl).toBe(`${SITE_BASE_URL}/brief/${brief._id}`);
  });

  test('CTA sits at the very end of the post', async () => {
    const openRouterChat = chatStub('Body of the tweet.');
    const brief = makeBrief();
    const out = await generateLatestIntel({ brief, tone: 7, openRouterChat });
    expect(out.text.endsWith(`${SITE_BASE_URL}/brief/${brief._id}`)).toBe(true);
  });

  test('preserves the full model output verbatim — no truncation', async () => {
    const openRouterChat = chatStub('x'.repeat(400));
    const out = await generateLatestIntel({ brief: makeBrief(), tone: 7, openRouterChat });
    // Body retained in full so the editor can show overflow in red and the
    // human trims manually. Publish endpoint rejects >280 as final guard.
    expect(out.text.length).toBeGreaterThan(X_CHAR_LIMIT);
    expect(out.text).toMatch(/^x{400}/);
    expect(out.text).toContain('Read the full brief:');
  });

  test('honours an injected siteBaseUrl override', async () => {
    const openRouterChat = chatStub('body');
    const brief = makeBrief();
    const out = await generateLatestIntel({
      brief, tone: 7, openRouterChat, siteBaseUrl: 'https://staging.example.com',
    });
    expect(out.text).toContain(`https://staging.example.com/brief/${brief._id}`);
    expect(out.sourceMeta.briefUrl).toBe(`https://staging.example.com/brief/${brief._id}`);
  });

  test('skips the CTA when the brief has no _id', async () => {
    const openRouterChat = chatStub('body of the tweet');
    const out = await generateLatestIntel({
      brief: makeBrief({ _id: undefined }), tone: 7, openRouterChat,
    });
    expect(out.text).toBe('body of the tweet');
    expect(out.text).not.toContain('Read the full brief:');
    expect(out.sourceMeta.briefUrl).toBeNull();
  });

  test('HARD LIMIT in guardrails uses the prose budget when a CTA is appended', async () => {
    const openRouterChat = chatStub('body');
    const brief = makeBrief();
    await generateLatestIntel({ brief, tone: 7, openRouterChat });
    const sys = openRouterChat.mock.calls[0][0].messages.find(m => m.role === 'system').content;
    const ctaLen = `\n\nRead the full brief: ${SITE_BASE_URL}/brief/${brief._id}`.length;
    const proseBudget = 280 - ctaLen;
    expect(sys).toMatch(new RegExp(`HARD LIMIT: ≤${proseBudget} characters of PROSE`));
    expect(sys).toMatch(/do NOT use X\.com's 280-char tweet limit as your target/i);
    expect(sys).not.toMatch(/HARD LIMIT: ≤280 characters total/);
  });

  test('HARD LIMIT falls back to full 280 when no CTA will be appended (no brief _id)', async () => {
    const openRouterChat = chatStub('body');
    await generateLatestIntel({ brief: makeBrief({ _id: undefined }), tone: 7, openRouterChat });
    const sys = openRouterChat.mock.calls[0][0].messages.find(m => m.role === 'system').content;
    // No CTA → 280 IS the budget; the standalone-tweet wording should be present.
    expect(sys).toMatch(/HARD LIMIT: ≤280 characters total \(X\.com tweet limit\)/);
    expect(sys).not.toMatch(/PROSE \(your output\)/);
  });

  test('instructs the model not to invent its own URL or CTA', async () => {
    const openRouterChat = chatStub('body');
    await generateLatestIntel({ brief: makeBrief(), tone: 7, openRouterChat });
    const messages = openRouterChat.mock.calls[0][0].messages;
    const sys = messages.find(m => m.role === 'system').content;
    expect(sys).toMatch(/system will AUTOMATICALLY append/);
    expect(sys).toMatch(/Do NOT include any URL/);
  });

  test('throws on empty response', async () => {
    const openRouterChat = chatStub('');
    await expect(generateLatestIntel({ brief: makeBrief(), tone: 7, openRouterChat }))
      .rejects.toThrow(/empty/);
  });
});

// ─── brand-transparency ─────────────────────────────────────────────────────

describe('generateBrandTransparency', () => {
  const sampleCommits = [
    { sha: 'a'.repeat(40), shortSha: 'aaaaaaa', message: 'Add Socials/X.com panel to admin', date: '2026-04-20' },
    { sha: 'b'.repeat(40), shortSha: 'bbbbbbb', message: 'fix: brief image fallback for cloudinary 404',  date: '2026-04-19' },
  ];

  test('uses a commit and returns text + commit metadata', async () => {
    const openRouterChat = chatStub('Shipped a new Socials panel — admins can now draft tweets in app.');
    const fetchCommits   = jest.fn().mockResolvedValue(sampleCommits);
    const out = await generateBrandTransparency({ tone: 7, openRouterChat, fetchCommits });
    expect(out.text).toContain('Socials');
    expect(out.poll).toBeNull();
    expect(out.sourceMeta.commitSha).toMatch(/^[ab]+$/);
    expect(out.sourceMeta.commitMessage).toBeTruthy();
  });

  test('throws when no commits', async () => {
    const openRouterChat = chatStub('x');
    const fetchCommits   = jest.fn().mockResolvedValue([]);
    await expect(generateBrandTransparency({ tone: 7, openRouterChat, fetchCommits }))
      .rejects.toThrow(/no significant commits/);
  });

  test('passes context commits to the user prompt but only ONE picked commit', async () => {
    const openRouterChat = chatStub('shipped');
    const fetchCommits   = jest.fn().mockResolvedValue(sampleCommits);
    await generateBrandTransparency({ tone: 7, openRouterChat, fetchCommits });
    const messages = openRouterChat.mock.calls[0][0].messages;
    const user = messages.find(m => m.role === 'user').content;
    expect(user).toMatch(/Recent commit message:/);
  });

  test('HARD LIMIT uses the full 280 (no CTA appended for brand-transparency)', async () => {
    const openRouterChat = chatStub('shipped');
    const fetchCommits   = jest.fn().mockResolvedValue(sampleCommits);
    await generateBrandTransparency({ tone: 7, openRouterChat, fetchCommits });
    const sys = openRouterChat.mock.calls[0][0].messages.find(m => m.role === 'system').content;
    expect(sys).toMatch(/HARD LIMIT: ≤280 characters total \(X\.com tweet limit\)/);
    // Must NOT use the prose-budget phrasing — brand-transparency owns the whole tweet.
    expect(sys).not.toMatch(/PROSE \(your output\)/);
  });
});

// ─── dispatcher ─────────────────────────────────────────────────────────────

describe('generateDraft (dispatcher)', () => {
  test('routes to daily-recon', async () => {
    const openRouterChat = chatStub(JSON.stringify({ text: 'Q?', pollOptions: ['a','b'], correctIndex: 0 }));
    const out = await generateDraft({
      postType: 'daily-recon', tone: 7, brief: makeBrief(), openRouterChat, fetchCommits: jest.fn(),
    });
    expect(out.poll).toBeTruthy();
  });

  test('routes to daily-recon-info (no poll, with brief URL CTA)', async () => {
    const openRouterChat = chatStub('A stand-out fact from this brief.');
    const out = await generateDraft({
      postType: 'daily-recon-info', tone: 7, brief: makeBrief(), openRouterChat, fetchCommits: jest.fn(),
    });
    expect(out.text).toContain('fact');
    expect(out.poll).toBeNull();
    expect(out.text).toContain('Read the full brief:');
  });

  test('routes to latest-intel', async () => {
    const openRouterChat = chatStub('latest news summary');
    const out = await generateDraft({
      postType: 'latest-intel', tone: 7, brief: makeBrief(), openRouterChat, fetchCommits: jest.fn(),
    });
    expect(out.text).toContain('summary');
    expect(out.poll).toBeNull();
  });

  test('routes to brand-transparency', async () => {
    const openRouterChat = chatStub('shipped a thing');
    const fetchCommits   = jest.fn().mockResolvedValue([{ sha: 'a', shortSha: 'a', message: 'feat: thing', date: 'd' }]);
    const out = await generateDraft({
      postType: 'brand-transparency', tone: 7, openRouterChat, fetchCommits,
    });
    expect(out.text).toContain('shipped');
  });

  test('rejects invalid postType', async () => {
    await expect(generateDraft({
      postType: 'wat', tone: 7, openRouterChat: jest.fn(), fetchCommits: jest.fn(),
    })).rejects.toThrow(/invalid postType/);
  });

  test('clamps tone before dispatch (no throw on out-of-range)', async () => {
    const openRouterChat = chatStub('ok');
    const out = await generateDraft({
      postType: 'latest-intel', tone: 99, brief: makeBrief(), openRouterChat, fetchCommits: jest.fn(),
    });
    // latest-intel now appends a brief-URL CTA, so just check the prose body.
    expect(out.text.startsWith('ok')).toBe(true);
  });
});

describe('exports', () => {
  test('POST_TYPES is correct', () => {
    expect(POST_TYPES).toEqual(['daily-recon', 'daily-recon-info', 'latest-intel', 'brand-transparency']);
  });
});

// ─── variants (3-up carousel) ───────────────────────────────────────────────

describe('variantNudge', () => {
  test('returns three distinct strings for indices 0/1/2', () => {
    const a = variantNudge(0);
    const b = variantNudge(1);
    const c = variantNudge(2);
    expect(a).toBeTruthy();
    expect(b).toBeTruthy();
    expect(c).toBeTruthy();
    expect(a).not.toEqual(b);
    expect(b).not.toEqual(c);
    expect(a).not.toEqual(c);
  });

  test('returns empty string for out-of-range / non-integer / null', () => {
    expect(variantNudge(3)).toBe('');
    expect(variantNudge(-1)).toBe('');
    expect(variantNudge(null)).toBe('');
    expect(variantNudge(undefined)).toBe('');
    expect(variantNudge(1.5)).toBe('');
  });

  test('VARIANT_NUDGES export has exactly 3 entries', () => {
    expect(VARIANT_NUDGES).toHaveLength(3);
  });
});

describe('variantIndex injection — daily-recon', () => {
  test('appends the variant nudge into the system prompt and bumps temperature', async () => {
    const openRouterChat = chatStub(JSON.stringify({
      text: 'Q?', pollOptions: ['a', 'b'], correctIndex: 0,
    }));
    await generateDailyRecon({ brief: makeBrief(), tone: 7, openRouterChat, variantIndex: 1 });
    const body = openRouterChat.mock.calls[0][0];
    const sys = body.messages.find(m => m.role === 'system').content;
    expect(sys).toContain(VARIANT_NUDGES[1]);
    expect(body.temperature).toBe(VARIANT_TEMPERATURE);
  });

  test('omits the nudge when no variantIndex is given', async () => {
    const openRouterChat = chatStub(JSON.stringify({
      text: 'Q?', pollOptions: ['a', 'b'], correctIndex: 0,
    }));
    await generateDailyRecon({ brief: makeBrief(), tone: 7, openRouterChat });
    const sys = openRouterChat.mock.calls[0][0].messages.find(m => m.role === 'system').content;
    VARIANT_NUDGES.forEach(n => expect(sys).not.toContain(n));
  });
});

describe('variantIndex injection — latest-intel', () => {
  test('appends the variant nudge and bumps temperature', async () => {
    const openRouterChat = chatStub('body of the tweet');
    await generateLatestIntel({ brief: makeBrief(), tone: 7, openRouterChat, variantIndex: 2 });
    const body = openRouterChat.mock.calls[0][0];
    const sys = body.messages.find(m => m.role === 'system').content;
    expect(sys).toContain(VARIANT_NUDGES[2]);
    expect(body.temperature).toBe(VARIANT_TEMPERATURE);
  });
});

describe('variantIndex injection — brand-transparency', () => {
  test('appends the variant nudge and bumps temperature', async () => {
    const openRouterChat = chatStub('shipped');
    const fetchCommits   = jest.fn().mockResolvedValue([
      { sha: 'a'.repeat(40), shortSha: 'aaa', message: 'feat: x', date: '2026-04-01' },
    ]);
    await generateBrandTransparency({ tone: 7, openRouterChat, fetchCommits, variantIndex: 0 });
    const body = openRouterChat.mock.calls[0][0];
    const sys = body.messages.find(m => m.role === 'system').content;
    expect(sys).toContain(VARIANT_NUDGES[0]);
    expect(body.temperature).toBe(VARIANT_TEMPERATURE);
  });
});

describe('variantIndex injection — daily-recon-info', () => {
  test('appends the variant nudge and bumps temperature', async () => {
    const openRouterChat = chatStub('body of the tweet');
    await generateDailyReconInfo({ brief: makeBrief(), tone: 7, openRouterChat, variantIndex: 1 });
    const body = openRouterChat.mock.calls[0][0];
    const sys = body.messages.find(m => m.role === 'system').content;
    expect(sys).toContain(VARIANT_NUDGES[1]);
    expect(body.temperature).toBe(VARIANT_TEMPERATURE);
  });
});

describe('generateDraft (dispatcher) — variantIndex pass-through', () => {
  test('forwards variantIndex into the daily-recon system prompt', async () => {
    const openRouterChat = chatStub(JSON.stringify({
      text: 'Q?', pollOptions: ['a', 'b'], correctIndex: 0,
    }));
    await generateDraft({
      postType: 'daily-recon', tone: 7, brief: makeBrief(),
      openRouterChat, fetchCommits: jest.fn(), variantIndex: 1,
    });
    const sys = openRouterChat.mock.calls[0][0].messages.find(m => m.role === 'system').content;
    expect(sys).toContain(VARIANT_NUDGES[1]);
  });

  test('forwards variantIndex into latest-intel', async () => {
    const openRouterChat = chatStub('body');
    await generateDraft({
      postType: 'latest-intel', tone: 7, brief: makeBrief(),
      openRouterChat, fetchCommits: jest.fn(), variantIndex: 2,
    });
    const sys = openRouterChat.mock.calls[0][0].messages.find(m => m.role === 'system').content;
    expect(sys).toContain(VARIANT_NUDGES[2]);
  });

  test('forwards variantIndex into brand-transparency', async () => {
    const openRouterChat = chatStub('shipped');
    const fetchCommits   = jest.fn().mockResolvedValue([
      { sha: 'a'.repeat(40), shortSha: 'aaa', message: 'feat: x', date: '2026-04-01' },
    ]);
    await generateDraft({
      postType: 'brand-transparency', tone: 7,
      openRouterChat, fetchCommits, variantIndex: 0,
    });
    const sys = openRouterChat.mock.calls[0][0].messages.find(m => m.role === 'system').content;
    expect(sys).toContain(VARIANT_NUDGES[0]);
  });

  test('non-integer variantIndex is treated as no-nudge', async () => {
    const openRouterChat = chatStub('body');
    await generateDraft({
      postType: 'latest-intel', tone: 7, brief: makeBrief(),
      openRouterChat, fetchCommits: jest.fn(), variantIndex: 'oops',
    });
    const sys = openRouterChat.mock.calls[0][0].messages.find(m => m.role === 'system').content;
    VARIANT_NUDGES.forEach(n => expect(sys).not.toContain(n));
  });
});

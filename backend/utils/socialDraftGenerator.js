// Generates draft text for the three social-post types from the admin Socials
// panel. All three accept a `tone` 1–10 dial:
//   1  = stiff corporate (think a big company's apology note)
//   7  = default; modern brand voice on X — warm, human, specific
//   10 = cheeky/comedic/satirical, still no typos or grammar errors
//
// External deps (OpenRouter, IntelligenceBrief lookup, GitHub commits) are
// passed in so unit tests can stub them without hitting the network or the DB.

const X_CHAR_LIMIT = 280;
const X_POLL_LIMIT = 25;          // X allows ≤25 chars per poll option
const X_POLL_MIN_OPTS = 2;
const X_POLL_MAX_OPTS = 4;
const POLL_DURATION_MINUTES = 24 * 60;

// Default model — kept here so the whole feature swaps in one place.
const DEFAULT_MODEL = 'anthropic/claude-haiku-4-5';

// Public site URL used to build linkable CTAs (latest-intel posts).
const SITE_BASE_URL = 'https://skywatch.academy';

const POST_TYPES = ['daily-recon', 'daily-recon-info', 'latest-intel', 'brand-transparency'];

// Per-variant prompt nudge — used when generating 3 alternative drafts in
// parallel so the variants don't collapse to near-identical text. Index 0/1/2
// map to the three carousel cards in the admin UI; any out-of-range index
// yields an empty nudge (i.e. plain prompt).
const VARIANT_NUDGES = [
  'Variant style: punchy and direct. Lead with the core point in the first 6 words; favour short declarative sentences.',
  'Variant style: hook-first. Open with a question or a surprising fact that pulls the reader in before delivering the takeaway.',
  'Variant style: scene-setting. Open with one vivid concrete detail (a place, a piece of kit, a moment) before the wider point.',
];

function variantNudge(variantIndex) {
  if (!Number.isInteger(variantIndex)) return '';
  return VARIANT_NUDGES[variantIndex] || '';
}

// Slight temperature bump from the OpenRouter default so the three variant
// calls don't return near-identical drafts even if the nudges overlap.
const VARIANT_TEMPERATURE = 0.85;

function describeTone(tone) {
  const t = clamp(Math.round(tone), 1, 10);
  if (t === 1) return 'MAXIMUM MILITARY FORMAL. Write like a senior RAF officer filing an official operational report — crisp, passive voice where appropriate, zero personality, zero humour, zero contractions. Sentences are complete and precise. Every word must justify its presence. Think STANAG signal format crossed with a Ministry of Defence press release. Absolutely no slang, no emojis, no warmth, no first person.';
  if (t <= 3) return 'formal and authoritative. Write like a defence ministry spokesperson: measured, impersonal, factually dense. No contractions, no slang, no emojis. Personality is absent by design. Reads like a briefing document, not a tweet.';
  if (t <= 5) return 'professional and clear. Plain English, direct sentences, no filler. A human wrote this but left their personality at the door. No jokes, no emojis, no flourishes — just the facts, well-expressed.';
  if (t <= 7) return 'modern brand voice — confident, warm, specific. Sounds like a person, not a press release. One light personality beat per post is fine; no jokes. Default register for SkyWatch posts.';
  if (t === 8) return 'personable and a little cheeky. A wry observation or knowing aside is welcome. Conversational without being sloppy. Reads like someone who knows the platform and isn\'t afraid to show it — but the information still leads.';
  if (t === 9) return 'genuinely witty and ironic. Sharp, honest, confident. A real joke or punchline is not just welcome — it\'s expected. Dry humour, light self-awareness, a touch of irreverence. Never forced, never cringe. NEVER spelling mistakes or grammatical errors.';
  return 'MAXIMUM cheeky, wild, and carefree — but always honest and never dishonest. This post should make someone laugh out loud or do a double-take on the timeline. Go for it: deadpan zingers, absurdist observations, over-the-top irony, a punchline so good it hurts. The joke IS the point — if you removed it, the post would be worse. Wit and irreverence cranked to 11. Still 100% factually accurate (honesty is non-negotiable even at tone 10 — never exaggerate or misrepresent facts for comic effect). NEVER emojis as the punchline. NEVER forced memes or "fellow kids" energy. NEVER spelling mistakes or grammatical errors — sloppy writing kills the joke.';
}

function clamp(n, lo, hi) { return Math.max(lo, Math.min(hi, n)); }

// Shared guardrails (everything except the length rule, which depends on
// whether the post has an auto-appended CTA — see guardrailsBlock).
const COMMON_GUARDRAILS_TAIL = [
  'COMPLETE THOUGHTS ONLY: every sentence in the post MUST finish. Never write a clause you can\'t complete — a half-finished sentence is a broken post. Better to write fewer sentences that finish than to start a thought you can\'t close.',
  'Never mention or imply that this site helps RAF applicants. Keep references general.',
  'Stay factual on geopolitical/AOR content. No political commentary or hot takes.',
  'No hashtag spam — at most ONE hashtag, and only if it genuinely adds reach.',
  'Do NOT wrap the post in quotes.',
  'Do NOT prepend with anything like "Tweet:" or "Post:".',
];

// Build the guardrail list for a given post. When hasCta=true the model only
// owns the prose body (effectiveLimit chars) — the system appends the CTA
// itself, so the model must NOT be told the X.com 280-char limit as its
// budget or it'll happily write up to 280 chars of prose and overrun once the
// CTA is glued on. When hasCta=false (brand-transparency) the model owns the
// whole tweet, so 280 IS the budget.
function guardrailsBlock({ effectiveLimit = X_CHAR_LIMIT, hasCta = false } = {}) {
  const limitLine = hasCta
    ? `HARD LIMIT: ≤${effectiveLimit} characters of PROSE (your output). This is your ENTIRE budget — do NOT use X.com's 280-char tweet limit as your target. The system automatically glues a CTA onto the end of your text afterwards, and the combined post must fit inside 280 chars, so anything you write over ${effectiveLimit} chars overruns and gets rejected at publish. INVIOLABLE. Plan the post to land inside the ${effectiveLimit}-char prose budget on the first try; don't write a long draft expecting it to be cut later.`
    : `HARD LIMIT: ≤${effectiveLimit} characters total (X.com tweet limit). This is INVIOLABLE — X.com WILL reject anything over. Plan the post so it lands inside the limit on the first try; don't write a long draft expecting it to be cut later.`;
  return [`- ${limitLine}`, ...COMMON_GUARDRAILS_TAIL.map(g => `- ${g}`)].join('\n');
}

function trimToLimit(text, limit = X_CHAR_LIMIT) {
  const t = (text || '').trim();
  if (t.length <= limit) return t;
  const cut = t.slice(0, limit);
  // Prefer ending on the last complete sentence inside the cut window so the
  // post never reads as truncated mid-clause. A "sentence end" is .!? followed
  // by whitespace or end-of-cut. Require the kept portion to be at least a
  // third of the limit so we never collapse to a tiny "Hi." stub.
  const sentenceMatch = cut.match(/^[\s\S]*[.!?](?=\s|$)/);
  if (sentenceMatch && sentenceMatch[0].length >= limit / 3) {
    return sentenceMatch[0].trim();
  }
  // Fallback: cut at the last word boundary, never mid-word.
  const lastSpace = cut.lastIndexOf(' ');
  return (lastSpace > limit - 25 ? cut.slice(0, lastSpace) : cut).trim();
}

function extractFirstJson(raw) {
  if (!raw) throw new Error('empty model response');
  // Strip markdown fences if the model added them.
  const cleaned = raw.replace(/^```(?:json)?/i, '').replace(/```\s*$/i, '').trim();
  const start = cleaned.indexOf('{');
  const end   = cleaned.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) {
    throw new Error(`could not find JSON object in model response: ${raw.slice(0, 200)}`);
  }
  return JSON.parse(cleaned.slice(start, end + 1));
}

function briefSummaryForPrompt(brief) {
  if (!brief) return '';
  const parts = [];
  if (brief.title)    parts.push(`Title: ${brief.title}`);
  if (brief.subtitle) parts.push(`Subtitle: ${brief.subtitle}`);
  if (brief.category) parts.push(`Category: ${brief.category}${brief.subcategory ? ` (${brief.subcategory})` : ''}`);
  const sections = Array.isArray(brief.descriptionSections) ? brief.descriptionSections : [];
  sections.forEach((s, i) => {
    if (!s) return;
    const heading = (typeof s === 'object' && s.heading) ? s.heading : `Section ${i + 1}`;
    const body    = typeof s === 'string' ? s : (s.body || '');
    if (body) parts.push(`${heading}:\n${body}`);
  });
  return parts.join('\n\n');
}

// ─── Daily Recon ─────────────────────────────────────────────────────────────
async function generateDailyRecon({ brief, tone, openRouterChat, model = DEFAULT_MODEL, siteBaseUrl = SITE_BASE_URL, variantIndex }) {
  if (!brief)          throw new Error('daily-recon requires a brief');
  if (!openRouterChat) throw new Error('openRouterChat dependency required');
  const briefName = brief.title || 'Intel Brief';
  const summary   = briefSummaryForPrompt(brief);
  const briefId   = brief._id ? String(brief._id) : null;
  // Daily-recon picks from any category and many briefs are tier-gated, so
  // linking the user to /brief/{id} would dump them on a sign-in wall. Send
  // them to the site root instead — they can pick something they're allowed
  // to read without the friction of an immediate paywall.
  const ctaSuffix   = `\n\nRead more briefs here: ${siteBaseUrl}`;
  const proseTarget = X_CHAR_LIMIT - ctaSuffix.length;
  const nudge = variantNudge(variantIndex);

  const system = [
    'You write tweets for SkyWatch — a defence/aerospace knowledge platform.',
    `Voice/tone (dial = ${tone} of 10): ${describeTone(tone)}`,
    nudge ? `\n${nudge}\n` : '',
    'Task: a "Daily Recon" poll question. Pick a single specific factual question grounded in the brief below — facts only, no opinions. Choose 2–4 plausible answers (only ONE correct). Wrong answers should be plausible enough to make people think.',
    '',
    'Return strictly valid JSON only, matching this shape:',
    '{',
    `  "text": "<tweet text — must include the brief name and the question. ≤${proseTarget} chars total>",`,
    '  "pollOptions": ["<opt1>", "<opt2>", ...],   // 2 to 4 options, each ≤25 chars',
    '  "correctIndex": <0-based index of the correct option>',
    '}',
    '',
    `IMPORTANT — write only the prose body in "text". The system will AUTOMATICALLY append "${ctaSuffix.trim()}" after your text. Do NOT include any URL, link, "read the brief"-style line, or other CTA yourself — that line is added for you. Your prose budget is ≤${proseTarget} chars (see HARD LIMIT below) — do NOT plan against X.com's 280-char tweet limit, plan against ${proseTarget}.`,
    '',
    'Guardrails:',
    guardrailsBlock({ effectiveLimit: proseTarget, hasCta: true }),
    `- Each poll option must be ≤${X_POLL_LIMIT} chars.`,
    `- Provide between ${X_POLL_MIN_OPTS} and ${X_POLL_MAX_OPTS} options.`,
    '- The correct option must be factually correct based on the brief.',
  ].join('\n');

  const user = [
    `Brief name (use this exact name in the post): "${briefName}"`,
    '',
    'Brief content:',
    summary,
  ].join('\n');

  const data = await openRouterChat({
    model,
    messages: [
      { role: 'system', content: system },
      { role: 'user',   content: user },
    ],
    response_format: { type: 'json_object' },
    temperature: VARIANT_TEMPERATURE,
  });
  const raw = data?.choices?.[0]?.message?.content || '';
  const parsed = extractFirstJson(raw);

  // Don't auto-trim — show the full AI prose in the editor so the human can
  // trim it manually (overflow shows in red, publish rejects >280 as a final
  // guard). The HARD LIMIT in the prompt tells the model to land inside the
  // budget on its own.
  const proseText = String(parsed.text || '').trim();
  const text = `${proseText}${ctaSuffix}`;
  let options = Array.isArray(parsed.pollOptions) ? parsed.pollOptions : [];
  options = options
    .map(o => String(o || '').trim().slice(0, X_POLL_LIMIT))
    .filter(Boolean);
  if (options.length < X_POLL_MIN_OPTS) {
    throw new Error(`daily-recon: model returned <${X_POLL_MIN_OPTS} poll options`);
  }
  if (options.length > X_POLL_MAX_OPTS) options = options.slice(0, X_POLL_MAX_OPTS);

  const correctIndex = Number.isInteger(parsed.correctIndex) ? parsed.correctIndex : 0;

  return {
    text,
    poll: { options, duration_minutes: POLL_DURATION_MINUTES },
    sourceMeta: {
      briefId,
      briefName,
      correctIndex: clamp(correctIndex, 0, options.length - 1),
    },
  };
}

// ─── Daily Recon (Info) ──────────────────────────────────────────────────────
async function generateDailyReconInfo({ brief, tone, openRouterChat, model = DEFAULT_MODEL, siteBaseUrl = SITE_BASE_URL, variantIndex }) {
  if (!brief)          throw new Error('daily-recon-info requires a brief');
  if (!openRouterChat) throw new Error('openRouterChat dependency required');
  const summary  = briefSummaryForPrompt(brief);
  const briefId  = brief._id ? String(brief._id) : null;
  const briefUrl = briefId ? `${siteBaseUrl}/brief/${briefId}` : null;
  const ctaSuffix   = briefUrl ? `\n\nRead the full brief: ${briefUrl}` : '';
  const proseTarget = X_CHAR_LIMIT - ctaSuffix.length;
  const nudge = variantNudge(variantIndex);

  const system = [
    'You write tweets for SkyWatch — a defence/aerospace knowledge platform.',
    `Voice/tone (dial = ${tone} of 10): ${describeTone(tone)}`,
    nudge ? `\n${nudge}\n` : '',
    'Task: a "Daily Recon" info post. Pick ONE specific, surprising, or little-known fact from the brief below — something that would make someone on X stop and read. State it directly. No poll, no speculation, facts only.',
    '',
    ctaSuffix
      ? `IMPORTANT — write only the prose body of the tweet. The system will AUTOMATICALLY append "${ctaSuffix.trim()}" after your text. Do NOT include any URL, link, "read the brief"-style line, or other CTA yourself — that line is added for you. Your prose budget is ≤${proseTarget} chars (see HARD LIMIT below) — do NOT plan against X.com's 280-char tweet limit, plan against ${proseTarget}.`
      : `The tweet must stand on its own — do NOT end with a CTA pointing to "the brief" or any other unlinked content.`,
    '',
    'Return PLAIN TEXT only — no JSON, no markdown, no quotes. The whole response is the tweet body.',
    '',
    'Guardrails:',
    guardrailsBlock({ effectiveLimit: proseTarget, hasCta: !!ctaSuffix }),
  ].join('\n');

  const user = `Brief content:\n\n${summary}`;

  const data = await openRouterChat({
    model,
    messages: [
      { role: 'system', content: system },
      { role: 'user',   content: user },
    ],
    temperature: VARIANT_TEMPERATURE,
  });
  const raw = (data?.choices?.[0]?.message?.content || '').trim();
  if (!raw) throw new Error('daily-recon-info: empty model response');
  const finalText = ctaSuffix ? `${raw}${ctaSuffix}` : raw;
  return {
    text: finalText,
    poll: null,
    sourceMeta: {
      briefId,
      briefName: brief.title || null,
      briefUrl,
    },
  };
}

// ─── Latest Intel ────────────────────────────────────────────────────────────
async function generateLatestIntel({ brief, tone, openRouterChat, model = DEFAULT_MODEL, siteBaseUrl = SITE_BASE_URL, variantIndex }) {
  if (!brief)          throw new Error('latest-intel requires a brief');
  if (!openRouterChat) throw new Error('openRouterChat dependency required');
  const summary  = briefSummaryForPrompt(brief);
  const briefId  = brief._id ? String(brief._id) : null;
  const briefUrl = briefId ? `${siteBaseUrl}/brief/${briefId}` : null;
  // News briefs are unlocked for guests, so we link directly to the brief and
  // let the system append the CTA — keeps the URL canonical and stops the
  // model inventing wrong slugs.
  const ctaSuffix  = briefUrl ? `\n\nRead the full brief: ${briefUrl}` : '';
  const proseTarget = X_CHAR_LIMIT - ctaSuffix.length;
  const nudge = variantNudge(variantIndex);

  const system = [
    'You write tweets for SkyWatch — a defence/aerospace knowledge platform.',
    `Voice/tone (dial = ${tone} of 10): ${describeTone(tone)}`,
    nudge ? `\n${nudge}\n` : '',
    'Task: a "Latest Intel" tweet body. One concise, scannable summary of the news brief below. Do NOT editorialise, do NOT speculate. Mention the headline-worthy fact, name the place/aircraft/operation if relevant.',
    '',
    ctaSuffix
      ? `IMPORTANT — write only the prose body of the tweet. The system will AUTOMATICALLY append "${ctaSuffix.trim()}" after your text. Do NOT include any URL, link, "read the brief"-style line, or other CTA yourself — that line is added for you. Your prose budget is ≤${proseTarget} chars (see HARD LIMIT below) — do NOT plan against X.com's 280-char tweet limit, plan against ${proseTarget}.`
      : `The tweet must stand on its own — do NOT end with a CTA pointing to "the brief" or any other unlinked content.`,
    '',
    'Return PLAIN TEXT only — no JSON, no markdown, no quotes. The whole response is the tweet body.',
    '',
    'Guardrails:',
    guardrailsBlock({ effectiveLimit: proseTarget, hasCta: !!ctaSuffix }),
  ].join('\n');

  const user = `Brief content:\n\n${summary}`;

  const data = await openRouterChat({
    model,
    messages: [
      { role: 'system', content: system },
      { role: 'user',   content: user },
    ],
    temperature: VARIANT_TEMPERATURE,
  });
  const raw = (data?.choices?.[0]?.message?.content || '').trim();
  if (!raw) throw new Error('latest-intel: empty model response');
  // Don't auto-trim — surface the full AI prose to the editor so the human
  // can decide what to cut. Publish still rejects >280 as a final guard.
  const finalText = ctaSuffix ? `${raw}${ctaSuffix}` : raw;
  return {
    text: finalText,
    poll: null,
    sourceMeta: {
      briefId,
      briefName: brief.title || null,
      briefUrl,
    },
  };
}

// ─── Brand Transparency ──────────────────────────────────────────────────────
async function generateBrandTransparency({ tone, openRouterChat, fetchCommits, model = DEFAULT_MODEL, variantIndex }) {
  if (!openRouterChat) throw new Error('openRouterChat dependency required');
  if (!fetchCommits)   throw new Error('fetchCommits dependency required');
  const commits = await fetchCommits();
  if (!commits || commits.length === 0) {
    throw new Error('brand-transparency: no significant commits found');
  }
  // Pick a commit randomly from the top 8 to keep variety while avoiding very stale ones.
  const pool = commits.slice(0, 8);
  const picked = pool[Math.floor(Math.random() * pool.length)];
  const nudge = variantNudge(variantIndex);

  const system = [
    'You write tweets for SkyWatch — a defence/aerospace knowledge platform.',
    `Voice/tone (dial = ${tone} of 10): ${describeTone(tone)}`,
    nudge ? `\n${nudge}\n` : '',
    'Task: a "DevLog" tweet showing off a recent product change. The commit message is the source of truth — translate it into something a non-engineer would care about. Frame it as a real human builder, not a corporate PR account. Mention what was built and (briefly) why it matters to users.',
    '',
    'Return PLAIN TEXT only — no JSON, no markdown, no quotes. The whole response is the tweet.',
    '',
    'Guardrails:',
    guardrailsBlock({ effectiveLimit: X_CHAR_LIMIT, hasCta: false }),
    '- Do NOT include the commit hash unless it genuinely fits.',
    '- Do NOT use the word "commit", "PR", "merge", or other engineering-internal terms unless tone ≥ 9 and it lands as wry self-aware humour.',
  ].join('\n');

  const user = [
    `Recent commit message: "${picked.message}"`,
    `Authored: ${picked.date || 'recently'}`,
    '',
    'Other recent change titles for context (do NOT mention these — only the one above):',
    ...pool.filter(c => c.sha !== picked.sha).slice(0, 5).map(c => `  - ${c.message}`),
  ].join('\n');

  const data = await openRouterChat({
    model,
    messages: [
      { role: 'system', content: system },
      { role: 'user',   content: user },
    ],
    temperature: VARIANT_TEMPERATURE,
  });
  const raw = (data?.choices?.[0]?.message?.content || '').trim();
  if (!raw) throw new Error('brand-transparency: empty model response');
  // Don't auto-trim — let the human edit overflow in the textarea.
  const text = raw;
  return {
    text,
    poll: null,
    sourceMeta: {
      commitSha: picked.sha,
      commitShortSha: picked.shortSha,
      commitMessage: picked.message,
      commitUrl: picked.url,
      commitDate: picked.date,
    },
  };
}

// ─── Dispatcher ──────────────────────────────────────────────────────────────
async function generateDraft({ postType, tone, brief, openRouterChat, fetchCommits, model = DEFAULT_MODEL, variantIndex }) {
  if (!POST_TYPES.includes(postType)) {
    throw new Error(`invalid postType: ${postType}`);
  }
  const t = clamp(Number.isFinite(tone) ? tone : 7, 1, 10);
  const v = Number.isInteger(variantIndex) ? variantIndex : null;
  switch (postType) {
    case 'daily-recon':
      return generateDailyRecon({ brief, tone: t, openRouterChat, model, variantIndex: v });
    case 'daily-recon-info':
      return generateDailyReconInfo({ brief, tone: t, openRouterChat, model, variantIndex: v });
    case 'latest-intel':
      return generateLatestIntel({ brief, tone: t, openRouterChat, model, variantIndex: v });
    case 'brand-transparency':
      return generateBrandTransparency({ tone: t, openRouterChat, fetchCommits, model, variantIndex: v });
  }
}

module.exports = {
  POST_TYPES,
  DEFAULT_MODEL,
  SITE_BASE_URL,
  X_CHAR_LIMIT,
  X_POLL_LIMIT,
  POLL_DURATION_MINUTES,
  VARIANT_NUDGES,
  VARIANT_TEMPERATURE,
  variantNudge,
  describeTone,
  trimToLimit,
  extractFirstJson,
  briefSummaryForPrompt,
  generateDailyRecon,
  generateDailyReconInfo,
  generateLatestIntel,
  generateBrandTransparency,
  generateDraft,
};

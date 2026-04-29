const { AsyncLocalStorage } = require('async_hooks');
const OpenRouterUsageLog = require('../models/OpenRouterUsageLog');

// Per-request feature context. Routes wrap their handler bodies with
// withFeature(...) so that any downstream callOpenRouter() invocation inside
// that scope — including ones made by utility functions that receive
// openRouterChat as an injected parameter — logs against the right feature
// without having to thread an extra argument through every call site.
//
// The store also carries an optional briefId so every call inside a brief-tied
// request (generate-keywords, regenerate-brief, bulk-generate-stub, etc.) is
// linked back to its brief on the usage page. Routes call setBrief(id) at
// entry; downstream wrapper calls pick it up without threading a parameter.
const featureStorage = new AsyncLocalStorage();

function withFeature(feature, fn) {
  return featureStorage.run({ feature, briefId: null }, fn);
}

function featureMiddleware(feature) {
  return (req, res, next) => featureStorage.run({ feature, briefId: null }, () => next());
}

function currentFeature(fallback = 'generic') {
  return featureStorage.getStore()?.feature || fallback;
}

function setBrief(briefId) {
  const store = featureStorage.getStore();
  if (store && briefId) store.briefId = briefId;
}

function currentBriefId() {
  return featureStorage.getStore()?.briefId || null;
}

function resolveKeyAndHeader(key) {
  if (key === 'aptitude') {
    return {
      apiKey: process.env.OPENROUTER_KEY_APTITUDE || process.env.OPENROUTER_KEY,
      title:  'SkyWatch APTITUDE_SYNC',
    };
  }
  if (key === 'socials') {
    return {
      apiKey: process.env.OPENROUTER_KEY_SOCIALS || process.env.OPENROUTER_KEY,
      title:  'SkyWatch Socials',
    };
  }
  return {
    apiKey: process.env.OPENROUTER_KEY,
    title:  'SkyWatch',
  };
}

// Fire-and-forget usage logging. A failed log must never break the caller.
// Pending writes are tracked on a module-level set so tests can await them.
const pendingLogWrites = new Set();

function logUsage({ key, feature, briefId, model, usage }) {
  const u = usage || {};
  const costUsd = typeof u.cost === 'number' ? u.cost : 0;
  const p = OpenRouterUsageLog.create({
    key,
    feature,
    briefId:          briefId || null,
    model,
    promptTokens:     u.prompt_tokens     ?? 0,
    completionTokens: u.completion_tokens ?? 0,
    totalTokens:      u.total_tokens      ?? 0,
    costUsd,
  }).catch(err => console.error('[OpenRouterUsageLog] failed to write:', err.message));
  pendingLogWrites.add(p);
  p.finally(() => pendingLogWrites.delete(p));
}

// Test helper — resolves once every outstanding usage log write has settled.
async function _flushPendingLogWrites() {
  while (pendingLogWrites.size) {
    await Promise.allSettled([...pendingLogWrites]);
  }
}

// Core wrapper. Injects usage:{ include: true } so the response carries an
// actual $ cost we can log. Throws on non-2xx so callers can keep the same
// try/catch shape they had before.
async function callOpenRouter({ key = 'main', feature, body, extraHeaders }) {
  const { apiKey, title } = resolveKeyAndHeader(key);
  const resolvedFeature = feature || currentFeature();

  const enrichedBody = { ...body, usage: { include: true } };

  const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type':  'application/json',
      'HTTP-Referer':  process.env.CLIENT_URL || 'http://localhost:5173',
      'X-Title':       title,
      ...(extraHeaders || {}),
    },
    body: JSON.stringify(enrichedBody),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`OpenRouter ${res.status}: ${text.slice(0, 300)}`);
  }

  const data = await res.json();

  logUsage({
    key,
    feature: resolvedFeature,
    briefId: currentBriefId(),
    model:   body.model || data.model || 'unknown',
    usage:   data.usage,
  });

  return data;
}

// Fetch the lifetime usage for a given key from OpenRouter's /api/v1/key
// endpoint. Returns { usage, limit, label } — usage is cumulative $ spent.
async function fetchOpenRouterKeyUsage(key) {
  const { apiKey } = resolveKeyAndHeader(key);
  if (!apiKey) return { usage: 0, limit: null, label: null, error: 'no api key configured' };

  try {
    const res = await fetch('https://openrouter.ai/api/v1/key', {
      headers: { 'Authorization': `Bearer ${apiKey}` },
    });
    if (!res.ok) {
      const text = await res.text();
      return { usage: 0, limit: null, label: null, error: `OpenRouter ${res.status}: ${text.slice(0, 200)}` };
    }
    const json = await res.json();
    const d = json?.data || {};
    return {
      usage: typeof d.usage === 'number' ? d.usage : 0,
      limit: typeof d.limit === 'number' ? d.limit : null,
      label: d.label || null,
      error: null,
    };
  } catch (err) {
    return { usage: 0, limit: null, label: null, error: err.message };
  }
}

module.exports = {
  callOpenRouter,
  fetchOpenRouterKeyUsage,
  withFeature,
  featureMiddleware,
  currentFeature,
  setBrief,
  currentBriefId,
  _flushPendingLogWrites,
};

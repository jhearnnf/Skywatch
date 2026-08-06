// Caption alignment.
//
// We already know exactly what was said — we wrote the script and handed it to
// the TTS. So this is *forced alignment*, not transcription: take whisper's
// timings but the script's spelling, always.
//
// That distinction is the whole point. Whisper reliably mangles the vocabulary
// this project cares about — "CBAT" becomes "see bat", callsigns and rank
// abbreviations come out phonetically — and a caption reading "SEE BAT" under a
// video about the CBAT is worse than no captions at all. Whisper is only ever
// asked *when* a word was spoken, never *which* word it was.
//
// Alignment is a standard edit-distance DP over normalised tokens. Because each
// beat is narrated as its own audio file, the sequences being aligned are one
// short sentence against one short transcript, so the search space is tiny and
// the match is near-perfect in practice.

// Compare on letters and digits only: whisper punctuates and capitalises to its
// own taste, and none of that should cause a mismatch.
function normalise(token) {
  return String(token || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

function tokenise(text) {
  return String(text || '').split(/\s+/).filter(Boolean);
}

// Levenshtein alignment with backtrace. Returns one entry per script token:
// { scriptIndex, whisperIndex | null }.
function alignTokens(scriptTokens, whisperTokens) {
  const m = scriptTokens.length;
  const n = whisperTokens.length;

  const a = scriptTokens.map(normalise);
  const b = whisperTokens.map(normalise);

  // cost[i][j] = best cost aligning first i script tokens with first j whisper
  const cost = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) cost[i][0] = i;
  for (let j = 0; j <= n; j++) cost[0][j] = j;

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const sub = cost[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1);
      cost[i][j] = Math.min(sub, cost[i - 1][j] + 1, cost[i][j - 1] + 1);
    }
  }

  const pairs = [];
  let i = m, j = n;
  while (i > 0) {
    if (j > 0 && cost[i][j] === cost[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)) {
      // Only claim a timing when the tokens actually matched. A substitution
      // means whisper heard something else there, and borrowing its timing
      // would be a guess dressed up as a measurement.
      pairs.push({ scriptIndex: i - 1, whisperIndex: a[i - 1] === b[j - 1] ? j - 1 : null });
      i--; j--;
    } else if (cost[i][j] === cost[i - 1][j] + 1) {
      pairs.push({ scriptIndex: i - 1, whisperIndex: null });   // whisper dropped it
      i--;
    } else {
      j--;                                                      // whisper hallucinated one
    }
  }

  return pairs.reverse();
}

// Give every script token a start and end.
//
// Matched tokens take whisper's measurement. Runs of unmatched tokens are
// spread evenly across the gap between their nearest matched neighbours, which
// keeps captions moving at a plausible pace instead of freezing on one page.
function fillTimings(scriptTokens, whisperWords, pairs, { fallbackDurationMs = 0 } = {}) {
  const out = scriptTokens.map((text, idx) => {
    const pair = pairs.find(p => p.scriptIndex === idx);
    const w = pair && pair.whisperIndex != null ? whisperWords[pair.whisperIndex] : null;
    return {
      text,
      startMs: w ? w.startMs : null,
      endMs:   w ? w.endMs   : null,
    };
  });

  const anchored = out.some(w => w.startMs != null);

  // Nothing matched at all — whisper failed or the audio was silent. Spread the
  // line evenly so captions still appear rather than vanishing.
  if (!anchored) {
    const total = fallbackDurationMs || scriptTokens.length * 350;
    const per = total / Math.max(1, scriptTokens.length);
    return out.map((w, i) => ({ text: w.text, startMs: Math.round(i * per), endMs: Math.round((i + 1) * per) }));
  }

  // Forward pass over each unmatched run.
  let i = 0;
  while (i < out.length) {
    if (out[i].startMs != null) { i++; continue; }

    let j = i;
    while (j < out.length && out[j].startMs == null) j++;

    const prevEnd = i > 0 ? out[i - 1].endMs : 0;
    const nextStart = j < out.length ? out[j].startMs : prevEnd + (j - i) * 350;
    const span = Math.max(1, nextStart - prevEnd);
    const per = span / (j - i);

    for (let k = i; k < j; k++) {
      out[k].startMs = Math.round(prevEnd + (k - i) * per);
      out[k].endMs   = Math.round(prevEnd + (k - i + 1) * per);
    }
    i = j;
  }

  // Enforce monotonicity. Whisper occasionally emits overlapping spans, and a
  // caption whose highlight jumps backwards is very visible.
  for (let k = 1; k < out.length; k++) {
    if (out[k].startMs < out[k - 1].endMs) out[k].startMs = out[k - 1].endMs;
    if (out[k].endMs <= out[k].startMs) out[k].endMs = out[k].startMs + 60;
  }

  return out;
}

// Align one beat's script line against whisper's words for that beat's audio.
function alignBeat(scriptText, whisperWords, opts = {}) {
  const scriptTokens = tokenise(scriptText);
  if (scriptTokens.length === 0) return [];

  const words = Array.isArray(whisperWords) ? whisperWords.filter(w => w && w.text) : [];
  const pairs = alignTokens(scriptTokens, words.map(w => w.text));
  return fillTimings(scriptTokens, words, pairs, opts);
}

// Build the caption word list for a whole script.
//
// `rawByBeat` is what the agent reported: { [beatId]: [{ text, startMs, endMs }] },
// each beat's timings relative to its own audio file. Voice lines supply the
// offset that turns those into positions on the finished video.
function buildCaptions(script, rawByBeat) {
  const beats = script?.script?.beats ?? [];
  const lines = script?.voice?.lines ?? [];

  const rows = [];

  const addBeat = (beatId, text) => {
    const line = lines.find(l => l.beatId === beatId);
    if (!line) return;                       // not narrated, so nothing to caption
    const aligned = alignBeat(text, rawByBeat?.[beatId], { fallbackDurationMs: line.durationMs });
    for (const w of aligned) {
      rows.push({
        beatId,
        text: w.text,
        startMs: (line.startMs ?? 0) + w.startMs,
        endMs:   (line.startMs ?? 0) + w.endMs,
      });
    }
  };

  for (const beat of beats) addBeat(beat.id, beat.text);
  if (script?.outro?.enabled && script.outro.copy) addBeat('outro', script.outro.copy);

  return rows;
}

module.exports = { buildCaptions, alignBeat, alignTokens, fillTimings, normalise, tokenise };

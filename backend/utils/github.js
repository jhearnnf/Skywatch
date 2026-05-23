// Lightweight GitHub commits fetch used by the "Summarize recent updates" admin
// helper for the Update Notifications feature. No external dependency — uses the
// REST API directly. Anonymous requests work for public repos but are heavily
// rate-limited; set GITHUB_TOKEN in env to lift to 5000 req/hr.

const DEFAULT_REPO = 'jhearnnf/Skywatch';

// Commit messages we never want feeding into a user-facing summary.
const NOISE_PREFIXES = ['merge ', 'chore:', 'chore(', 'wip:', 'wip ', 'bump '];

function isNoise(message) {
  const m = (message || '').trim().toLowerCase();
  if (!m) return true;
  return NOISE_PREFIXES.some(p => m.startsWith(p));
}

// Fetch up to `limit` recent commits, newest first. `sinceDays` filters to the
// recent window (defaults to 14 days). Returns a clean array of {sha, message, date, author}.
async function getRecentCommits({
  repo      = DEFAULT_REPO,
  sinceDays = 14,
  limit     = 30,
} = {}) {
  const since = new Date(Date.now() - sinceDays * 24 * 60 * 60 * 1000).toISOString();
  const url = `https://api.github.com/repos/${repo}/commits?per_page=${limit}&since=${encodeURIComponent(since)}`;

  const headers = { 'Accept': 'application/vnd.github+json', 'User-Agent': 'Skywatch-Admin' };
  if (process.env.GITHUB_TOKEN) {
    headers['Authorization'] = `Bearer ${process.env.GITHUB_TOKEN}`;
  }

  const res = await fetch(url, { headers });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`GitHub ${res.status}: ${text.slice(0, 300)}`);
  }

  const raw = await res.json();
  return raw
    .map(c => ({
      sha:     c.sha?.slice(0, 7) || '',
      // Only keep the first line — commit bodies are noisy and break the summary prompt.
      message: (c.commit?.message || '').split('\n')[0].trim(),
      date:    c.commit?.author?.date || c.commit?.committer?.date || null,
      author:  c.commit?.author?.name || c.author?.login || 'unknown',
    }))
    .filter(c => c.message && !isNoise(c.message));
}

module.exports = { getRecentCommits, DEFAULT_REPO };

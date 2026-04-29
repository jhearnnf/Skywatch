// Fetches recent commits from GitHub for the brand-transparency social-post
// generator. We deploy on Railway where the runtime container has no .git, so
// shelling out to `git log` isn't an option — the API is the only reliable
// path.
//
// Configure via env:
//   GITHUB_REPO   = "owner/name"  (e.g. jhearnnf/Skywatch)
//   GITHUB_TOKEN  = fine-grained PAT, contents:read scoped to that one repo
//
// Returns up to `limit` commits with chore/test/docs/Merge prefixes filtered
// out so the AI sees commits that actually represent user-visible changes.

const SKIP_PREFIX_RE = /^(chore|test|tests|docs|doc|ci|build|style|lint|deps?|merge|revert|wip)(\(.*?\))?:?\s/i;
const SKIP_MESSAGE_RE = /^(merge\s+(branch|pull\s+request)|revert\s+")/i;

async function fetchRecentCommits({ repo, token, branch = 'main', perPage = 30, limit = 15, fetchImpl = fetch } = {}) {
  const repoSlug = repo || process.env.GITHUB_REPO;
  const auth     = token || process.env.GITHUB_TOKEN;
  if (!repoSlug) throw new Error('GITHUB_REPO not configured');
  if (!auth)     throw new Error('GITHUB_TOKEN not configured');

  const url = `https://api.github.com/repos/${repoSlug}/commits?sha=${encodeURIComponent(branch)}&per_page=${perPage}`;
  const res = await fetchImpl(url, {
    headers: {
      'Authorization': `Bearer ${auth}`,
      'Accept': 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'skywatch-social-bot',
    },
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    throw new Error(`GitHub commits fetch failed (${res.status}): ${txt.slice(0, 200)}`);
  }
  const json = await res.json();

  const significant = [];
  for (const c of json) {
    const message = (c?.commit?.message || '').trim();
    if (!message) continue;
    const firstLine = message.split('\n', 1)[0];
    if (SKIP_PREFIX_RE.test(firstLine)) continue;
    if (SKIP_MESSAGE_RE.test(firstLine)) continue;
    significant.push({
      sha:        c.sha,
      shortSha:   c.sha.slice(0, 7),
      message:    firstLine,
      fullMessage: message,
      authorName: c?.commit?.author?.name || null,
      date:       c?.commit?.author?.date || null,
      url:        c?.html_url || null,
    });
    if (significant.length >= limit) break;
  }
  return significant;
}

module.exports = { fetchRecentCommits, SKIP_PREFIX_RE, SKIP_MESSAGE_RE };

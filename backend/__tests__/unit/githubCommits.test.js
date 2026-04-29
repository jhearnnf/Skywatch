const { fetchRecentCommits } = require('../../utils/githubCommits');

function commit(sha, message) {
  return {
    sha,
    commit: { message, author: { name: 'James', date: '2026-04-20T10:00:00Z' } },
    html_url: `https://github.com/jhearnnf/Skywatch/commit/${sha}`,
  };
}

function mockOk(body) {
  return jest.fn().mockResolvedValue({
    ok: true, status: 200, json: async () => body, text: async () => '',
  });
}

describe('githubCommits.fetchRecentCommits', () => {
  test('hits the right endpoint with auth + accept headers', async () => {
    const fetchImpl = mockOk([]);
    await fetchRecentCommits({ repo: 'jhearnnf/Skywatch', token: 'tok_123', fetchImpl });
    const [url, opts] = fetchImpl.mock.calls[0];
    expect(url).toContain('https://api.github.com/repos/jhearnnf/Skywatch/commits');
    expect(url).toContain('sha=main');
    expect(opts.headers.Authorization).toBe('Bearer tok_123');
    expect(opts.headers.Accept).toBe('application/vnd.github+json');
  });

  test('filters out chore/test/docs/Merge commits', async () => {
    const body = [
      commit('a', 'feat: add quiz polls to socials panel'),
      commit('b', 'chore: bump deps'),
      commit('c', 'test: add unit tests for foo'),
      commit('d', 'Add target lock animation to flashcards'),
      commit('e', 'Merge pull request #42'),
      commit('f', 'docs: update README'),
      commit('g', 'fix: brief image fallback when cloudinary 404s'),
      commit('h', 'ci: pin node version'),
      commit('i', 'Revert "broken thing"'),
      commit('j', 'style: format'),
      commit('k', 'feat(games): SDT difficulty curve'),
    ];
    const fetchImpl = mockOk(body);
    const out = await fetchRecentCommits({ repo: 'r/r', token: 't', fetchImpl, limit: 10 });
    const messages = out.map(c => c.message);
    expect(messages).toEqual([
      'feat: add quiz polls to socials panel',
      'Add target lock animation to flashcards',
      'fix: brief image fallback when cloudinary 404s',
      'feat(games): SDT difficulty curve',
    ]);
  });

  test('honours the limit', async () => {
    const body = Array.from({ length: 20 }, (_, i) => commit(`s${i}`, `feat: thing ${i}`));
    const fetchImpl = mockOk(body);
    const out = await fetchRecentCommits({ repo: 'r/r', token: 't', fetchImpl, limit: 5 });
    expect(out).toHaveLength(5);
  });

  test('shape of returned commit', async () => {
    const fetchImpl = mockOk([commit('abc1234567890', 'feat: x')]);
    const out = await fetchRecentCommits({ repo: 'r/r', token: 't', fetchImpl });
    expect(out[0]).toMatchObject({
      sha: 'abc1234567890',
      shortSha: 'abc1234',
      message: 'feat: x',
      authorName: 'James',
      url: expect.stringContaining('/commit/abc1234567890'),
    });
  });

  test('throws on missing config', async () => {
    const saved = { repo: process.env.GITHUB_REPO, tok: process.env.GITHUB_TOKEN };
    delete process.env.GITHUB_REPO;
    delete process.env.GITHUB_TOKEN;
    await expect(fetchRecentCommits({ fetchImpl: jest.fn() })).rejects.toThrow(/GITHUB_REPO/);
    process.env.GITHUB_REPO = 'r/r';
    await expect(fetchRecentCommits({ fetchImpl: jest.fn() })).rejects.toThrow(/GITHUB_TOKEN/);
    if (saved.repo) process.env.GITHUB_REPO = saved.repo; else delete process.env.GITHUB_REPO;
    if (saved.tok)  process.env.GITHUB_TOKEN = saved.tok; else delete process.env.GITHUB_TOKEN;
  });

  test('throws on non-2xx with status', async () => {
    const fetchImpl = jest.fn().mockResolvedValue({
      ok: false, status: 401, json: async () => ({}), text: async () => 'Bad credentials',
    });
    await expect(fetchRecentCommits({ repo: 'r/r', token: 't', fetchImpl }))
      .rejects.toThrow(/401.*Bad credentials/);
  });
});

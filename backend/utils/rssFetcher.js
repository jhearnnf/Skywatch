const RssParser = require('rss-parser');

const FEEDS = [
  { name: 'UK Defence Journal', url: 'https://ukdefencejournal.org.uk/feed/' },
  { name: 'Forces Net',         url: 'https://www.forces.net/rss.xml' },
  { name: 'Breaking Defense',   url: 'https://breakingdefense.com/feed/' },
];

const parser = new RssParser({ timeout: 10000 });

async function fetchRssHeadlines(fromDate, toDate) {
  const fromMs = new Date(fromDate).getTime();
  const toMs   = new Date(toDate + 'T23:59:59Z').getTime();

  const results = await Promise.allSettled(
    FEEDS.map(feed =>
      parser.parseURL(feed.url).then(parsed => ({ feed, parsed }))
    )
  );

  const items = [];
  for (const result of results) {
    if (result.status === 'rejected') {
      console.warn(`[rss-fetcher] Feed failed:`, result.reason?.message);
      continue;
    }
    const { feed, parsed } = result.value;
    for (const item of parsed.items ?? []) {
      const pubDate = item.pubDate ? new Date(item.pubDate) : null;
      if (!pubDate || isNaN(pubDate.getTime())) continue;
      const ms = pubDate.getTime();
      if (ms < fromMs || ms > toMs) continue;
      items.push({
        headline:    (item.title ?? '').trim(),
        eventDate:   pubDate.toISOString().slice(0, 10),
        url:         item.link ?? '',
        source:      feed.name,
        description: (item.contentSnippet ?? item.summary ?? '').slice(0, 600).trim(),
      });
    }
  }

  items.sort((a, b) => new Date(b.eventDate) - new Date(a.eventDate));
  return items.filter(i => i.headline);
}

module.exports = { fetchRssHeadlines };

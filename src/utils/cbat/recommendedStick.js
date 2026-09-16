// The kit we recommend, and the affiliate links that sell it. One place so the
// names on the cabinet and the links under them can never drift apart.
//
// The stick is read by ACT, RTT and SMA. The pedals are the other half of the
// real SMA set-up (its lateral axis is on the feet there), so they are
// recommended on that game only, and SMA is the only game that reads them.
//
// Each item carries one link per Amazon store we are enrolled in, keyed by
// the store ids in hardwareStore.js. `url` is the UK link, kept as the plain
// default for anything that does not know which store the player should be
// sent to; the cabinet itself asks storeLink() so a Canadian lands on
// amazon.ca rather than a UK listing that will not ship to them.
export const RECOMMENDED_STICK = {
  key: 'stick',
  name: 'Thrustmaster TCA Sidestick',
  edition: 'Airbus Edition',
  url: 'https://amzn.to/46wjHHt',
  links: {
    uk: 'https://amzn.to/46wjHHt',
    ca: 'https://link.amazon/B0fVegX6l',
  },
}

export const RECOMMENDED_PEDALS = {
  key: 'pedals',
  name: 'Thrustmaster T.Flight Rudder Pedals',
  edition: 'TFRP',
  url: 'https://amzn.to/4gX1hpr',
  links: {
    uk: 'https://amzn.to/4gX1hpr',
    ca: 'https://link.amazon/B0fG2x5yl',
  },
}

// The link for `item` in `store`, falling back to the UK link for a store the
// item has no listing in. Never returns nothing: a button with no href is
// worse than a UK button.
export function storeLink(item, store) {
  return item.links?.[store] ?? item.url
}

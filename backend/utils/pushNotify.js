'use strict';

/**
 * Phone / desktop push notifications for chat.
 *
 * Two delivery routes, one decision:
 *
 *   web  — Web Push (VAPID) to a browser or installed web app. The service
 *          worker (public/push-sw.js) draws the notification.
 *   fcm  — Firebase Cloud Messaging to the Android app, over the FCM HTTP v1
 *          API. Authenticated with a service account through
 *          google-auth-library, which the backend already has for Google
 *          sign-in, so Android costs no extra dependency.
 *
 * WHO is notified, and why, is decided once here (decideRecipients) and is
 * the same for both routes. Each recipient gets AT MOST ONE notification per
 * message, for the most personal reason that applies and that they have left
 * switched on: a DM beats an @mention beats a reply beats "new message in a
 * room you follow". Someone who has turned replies off but follows General
 * still hears about a reply in General, as a General notification.
 *
 * Unconfigured is a normal state, not an error: with neither VAPID keys nor an
 * FCM service account set, every entry point returns straight away without
 * touching the database. That keeps local dev and the test suite quiet.
 *
 * Callers never await delivery on a request path. appendMessage() and the
 * reaction route schedule it and move on; a slow or failing push service must
 * not slow down or fail a chat send.
 */

const webpush = require('web-push');
const PushSubscription = require('../models/PushSubscription');
const User = require('../models/User');
const { LOUNGE_SLUG } = require('../seeds/seedCbatLounge');

// Channel slug → the User.pushPrefs switch that follows it. Only these rooms
// can be followed; every other channel (cohort rooms, the medal feed) only
// ever notifies through a DM, mention, reply or reaction.
const ROOM_PREFS = {
  [LOUNGE_SLUG]:   'lounge',
  general:         'general',
  announcements:   'updates',
};

const PREF_KEYS = ['dms', 'replies', 'mentions', 'reactions', 'lounge', 'general', 'updates'];

// The pushPrefs defaults, mirrored from the User model so a user document read
// with .lean() (which skips schema defaults for a missing sub-object) still
// reads correctly.
const PREF_DEFAULTS = {
  dms: true, replies: true, mentions: true, reactions: true,
  lounge: false, general: false, updates: false,
};

function prefsOf(user) {
  return { ...PREF_DEFAULTS, ...(user?.pushPrefs ?? {}) };
}

const BODY_MAX = 140;
// How long a push service may hold a notification for a device that is off.
// A chat line an hour old is still worth seeing; a day old it is just noise.
const TTL_SECONDS = 60 * 60;

// ── Configuration ────────────────────────────────────────────────────────────

let webConfig;   // { publicKey, privateKey, subject } | null
let fcmConfig;   // { projectId, credentials } | null
let fcmClientPromise = null;

function readWebConfig() {
  const publicKey  = process.env.VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  if (!publicKey || !privateKey) return null;
  return {
    publicKey,
    privateKey,
    subject: process.env.VAPID_SUBJECT || 'https://skywatch.academy',
  };
}

// FCM_SERVICE_ACCOUNT is the service account JSON downloaded from Firebase,
// either pasted raw or base64-encoded (easier in hosting dashboards that
// mangle newlines in the private key).
function readFcmConfig() {
  const raw = process.env.FCM_SERVICE_ACCOUNT;
  if (!raw) return null;
  try {
    const text = raw.trim().startsWith('{') ? raw : Buffer.from(raw, 'base64').toString('utf8');
    const credentials = JSON.parse(text);
    if (!credentials.project_id || !credentials.client_email || !credentials.private_key) return null;
    return { projectId: credentials.project_id, credentials };
  } catch {
    console.warn('[push] FCM_SERVICE_ACCOUNT is set but is not valid service account JSON');
    return null;
  }
}

function config() {
  if (webConfig === undefined) webConfig = readWebConfig();
  if (fcmConfig === undefined) fcmConfig = readFcmConfig();
  return { web: webConfig, fcm: fcmConfig };
}

function isConfigured() {
  const { web, fcm } = config();
  return Boolean(web || fcm);
}

function publicConfig() {
  const { web, fcm } = config();
  return { webPublicKey: web?.publicKey ?? null, fcm: Boolean(fcm) };
}

// ── Transports ───────────────────────────────────────────────────────────────

// Each returns 'ok', 'gone' (the address is dead: forget it) or 'error'.

async function sendWeb(sub, payload) {
  const { web } = config();
  if (!web) return 'error';
  try {
    await webpush.sendNotification(
      { endpoint: sub.endpoint, keys: sub.keys },
      JSON.stringify(payload),
      {
        TTL: TTL_SECONDS,
        urgency: 'high',
        vapidDetails: { subject: web.subject, publicKey: web.publicKey, privateKey: web.privateKey },
      },
    );
    return 'ok';
  } catch (err) {
    if (err?.statusCode === 404 || err?.statusCode === 410) return 'gone';
    console.warn('[push] web push failed:', err?.statusCode ?? '', err?.body ?? err?.message);
    return 'error';
  }
}

function fcmClient() {
  if (!fcmClientPromise) {
    const { GoogleAuth } = require('google-auth-library');
    const auth = new GoogleAuth({
      credentials: config().fcm.credentials,
      scopes: ['https://www.googleapis.com/auth/firebase.messaging'],
    });
    fcmClientPromise = auth.getClient().catch((err) => {
      fcmClientPromise = null;   // let the next send try again
      throw err;
    });
  }
  return fcmClientPromise;
}

async function sendFcm(sub, payload) {
  const { fcm } = config();
  if (!fcm) return 'error';
  try {
    const client = await fcmClient();
    await client.request({
      url:    `https://fcm.googleapis.com/v1/projects/${fcm.projectId}/messages:send`,
      method: 'POST',
      data: {
        message: {
          token: sub.endpoint,
          notification: { title: payload.title, body: payload.body },
          // FCM data values must all be strings.
          data: { url: payload.url, tag: payload.tag, kind: payload.kind },
          android: {
            priority: 'high',
            ttl: `${TTL_SECONDS}s`,
            notification: {
              tag:        payload.tag,
              channel_id: 'chat',
              icon:       'ic_stat_notify',
              color:      '#5baaff',
            },
          },
        },
      },
    });
    return 'ok';
  } catch (err) {
    const status  = err?.response?.status;
    const details = err?.response?.data?.error?.details ?? [];
    const code    = details.find(d => d?.errorCode)?.errorCode;
    if (status === 404 || code === 'UNREGISTERED') return 'gone';
    console.warn('[push] FCM send failed:', status ?? '', code ?? err?.message);
    return 'error';
  }
}

// Swappable so tests can see what would have been sent without a push service.
let transports = { web: sendWeb, fcm: sendFcm };

async function deliver(subs, payload) {
  const gone = [];
  await Promise.all(subs.map(async (sub) => {
    const send = transports[sub.kind];
    if (!send) return;
    const outcome = await send(sub, payload);
    if (outcome === 'gone') gone.push(sub._id);
  }));
  if (gone.length) await PushSubscription.deleteMany({ _id: { $in: gone } });
}

// ── Wording ──────────────────────────────────────────────────────────────────

function clip(text, max = BODY_MAX) {
  const flat = String(text ?? '').replace(/\s+/g, ' ').trim();
  return flat.length > max ? `${flat.slice(0, max - 3).trimEnd()}...` : flat;
}

function messagePreview(message) {
  const body = clip(message.body);
  if (body) return body;
  const kinds = (message.attachments ?? []).map(a => a.kind);
  if (kinds.includes('video')) return 'Sent a video';
  if (kinds.length) return 'Sent a photo';
  return 'Sent a message';
}

function channelName(conversation) {
  return conversation?.channel?.name || 'Community';
}

function wordingFor(reason, { conversation, senderName }) {
  const where = conversation.type === 'channel' ? ` in ${channelName(conversation)}` : '';
  switch (reason) {
    case 'dms':      return { title: senderName, prefixBody: false };
    case 'mentions': return { title: `${senderName} mentioned you${where}`, prefixBody: false };
    case 'replies':  return { title: `${senderName} replied to you${where}`, prefixBody: false };
    default:         return { title: channelName(conversation), prefixBody: true };
  }
}

// ── Who hears about a new message ────────────────────────────────────────────

// Personal reasons, most personal first. Room follows come after these.
const REASON_ORDER = ['dms', 'mentions', 'replies'];

/**
 * Work out, for one new message, which users should be notified and why.
 * Pure apart from the reads it is handed, so it is unit-testable on its own.
 *
 * @param {Object} args
 * @param {Object} args.conversation
 * @param {Object} args.message
 * @param {Map<string, Object>} args.users  id → { pushPrefs, blockedUserIds, isBot }
 * @param {Set<string>} [args.roomFollowers] ids following this message's room
 * @returns {Map<string, string>} recipient id → reason (a pushPrefs key)
 */
function decideRecipients({ conversation, message, users, roomFollowers = new Set() }) {
  const sender = message.senderUserId ? String(message.senderUserId) : null;
  const reasons = new Map();   // id → Set of reasons
  const add = (id, reason) => {
    if (!id) return;
    const key = String(id);
    if (key === sender) return;
    if (!reasons.has(key)) reasons.set(key, new Set());
    reasons.get(key).add(reason);
  };

  if (conversation.type === 'dm') {
    for (const id of conversation.participantIds ?? []) add(id, 'dms');
  }
  // A reply from the team on a support ticket is, to the user, a message
  // addressed to them, so it rides the DM switch.
  if (conversation.type === 'support' && message.senderRole === 'admin') {
    add(conversation.userId, 'dms');
  }
  for (const id of message.mentions ?? []) add(id, 'mentions');
  if (message.replyTo?.userId) add(message.replyTo.userId, 'replies');

  const roomKey = conversation.type === 'channel' ? ROOM_PREFS[conversation.channel?.slug] : null;
  if (roomKey) for (const id of roomFollowers) add(id, roomKey);

  const out = new Map();
  for (const [id, set] of reasons) {
    const user = users.get(id);
    if (!user || user.isBot) continue;
    if (sender && (user.blockedUserIds ?? []).some(b => String(b) === sender)) continue;
    const prefs = prefsOf(user);
    const order = roomKey ? [...REASON_ORDER, roomKey] : REASON_ORDER;
    const reason = order.find(r => set.has(r) && prefs[r]);
    if (reason) out.set(id, reason);
  }
  return out;
}

function isNotifiable(message) {
  if (!message) return false;
  if (message.senderRole === 'system') return false;
  if (message.joinedUserId) return false;
  return true;
}

/**
 * Notify everyone who should hear about a freshly appended message.
 * Never throws.
 */
async function notifyNewMessage({ conversation, message, senderDisplayName }) {
  try {
    if (!isConfigured() || !isNotifiable(message)) return;

    // Room followers are looked up only among accounts that have at least one
    // device signed up, so a busy room does not read every User on each line.
    let roomFollowers = new Set();
    const roomKey = conversation.type === 'channel' ? ROOM_PREFS[conversation.channel?.slug] : null;
    if (roomKey) {
      const withDevices = await PushSubscription.distinct('userId');
      if (withDevices.length) {
        const followers = await User.find({
          _id: { $in: withDevices },
          [`pushPrefs.${roomKey}`]: true,
        }).select('_id').lean();
        roomFollowers = new Set(followers.map(u => String(u._id)));
      }
    }

    const candidateIds = new Set(roomFollowers);
    if (conversation.type === 'dm') (conversation.participantIds ?? []).forEach(id => candidateIds.add(String(id)));
    if (conversation.type === 'support' && conversation.userId) candidateIds.add(String(conversation.userId));
    (message.mentions ?? []).forEach(id => candidateIds.add(String(id)));
    if (message.replyTo?.userId) candidateIds.add(String(message.replyTo.userId));
    if (message.senderUserId) candidateIds.delete(String(message.senderUserId));
    if (!candidateIds.size) return;

    const subs = await PushSubscription.find({ userId: { $in: [...candidateIds] } }).lean();
    if (!subs.length) return;
    const withSubs = [...new Set(subs.map(s => String(s.userId)))];

    const userDocs = await User.find({ _id: { $in: withSubs } })
      .select('pushPrefs blockedUserIds isBot').lean();
    const users = new Map(userDocs.map(u => [String(u._id), u]));

    const recipients = decideRecipients({ conversation, message, users, roomFollowers });
    if (!recipients.size) return;

    const senderName = conversation.type === 'support' && message.senderRole === 'admin'
      ? 'SkyWatch Help Team'
      : (senderDisplayName || message.senderDisplayName || 'An agent');
    const preview = messagePreview(message);
    const url = `/chat/${conversation._id}`;
    const tag = `chat-${conversation._id}`;

    await Promise.all([...recipients].map(([id, reason]) => {
      const { title, prefixBody } = wordingFor(reason, { conversation, senderName });
      const body = prefixBody ? clip(`${senderName}: ${preview}`) : preview;
      return deliver(
        subs.filter(s => String(s.userId) === id),
        { title, body, url, tag, kind: reason },
      );
    }));
  } catch (err) {
    console.warn('[push] notifyNewMessage failed:', err?.message);
  }
}

// ── Reactions ────────────────────────────────────────────────────────────────

// Toggling a reaction off and on again must not buzz someone's phone each
// time. One notification per (message, reactor, emoji) per window.
const REACTION_REPEAT_MS = 10 * 60 * 1000;
const recentReactions = new Map();

function seenRecently(key, now = Date.now()) {
  for (const [k, at] of recentReactions) if (now - at > REACTION_REPEAT_MS) recentReactions.delete(k);
  if (recentReactions.has(key)) return true;
  recentReactions.set(key, now);
  return false;
}

/**
 * Tell a message's author that someone reacted to it. Only for an added
 * reaction, never a removed one. Never throws.
 */
async function notifyReaction({ conversation, message, reactor, emoji }) {
  try {
    if (!isConfigured()) return;
    const authorId = message.senderUserId ? String(message.senderUserId) : null;
    if (!authorId || authorId === String(reactor._id)) return;
    if (seenRecently(`${message._id}:${reactor._id}:${emoji}`)) return;

    const author = await User.findById(authorId).select('pushPrefs blockedUserIds isBot').lean();
    if (!author || author.isBot || !prefsOf(author).reactions) return;
    if ((author.blockedUserIds ?? []).some(b => String(b) === String(reactor._id))) return;

    const subs = await PushSubscription.find({ userId: authorId }).lean();
    if (!subs.length) return;

    const name = reactor.displayName || 'An agent';
    const where = conversation.type === 'channel' ? ` in ${channelName(conversation)}` : '';
    await deliver(subs, {
      title: `${name} reacted ${emoji} to your message${where}`,
      body:  messagePreview(message),
      url:   `/chat/${conversation._id}`,
      tag:   `reaction-${message._id}`,
      kind:  'reactions',
    });
  } catch (err) {
    console.warn('[push] notifyReaction failed:', err?.message);
  }
}

// Fire-and-forget wrappers for request paths.
function scheduleNewMessage(args) {
  if (!isConfigured()) return;
  setImmediate(() => { notifyNewMessage(args); });
}

function scheduleReaction(args) {
  if (!isConfigured()) return;
  setImmediate(() => { notifyReaction(args); });
}

// ── Test hooks ───────────────────────────────────────────────────────────────

function _setTransports(next) { transports = { ...transports, ...next }; }
function _setConfig(next) {
  webConfig = next?.web ?? null;
  fcmConfig = next?.fcm ?? null;
  fcmClientPromise = null;
}
function _reset() {
  transports = { web: sendWeb, fcm: sendFcm };
  webConfig = undefined;
  fcmConfig = undefined;
  fcmClientPromise = null;
  recentReactions.clear();
}

module.exports = {
  PREF_KEYS,
  PREF_DEFAULTS,
  ROOM_PREFS,
  prefsOf,
  publicConfig,
  isConfigured,
  decideRecipients,
  notifyNewMessage,
  notifyReaction,
  scheduleNewMessage,
  scheduleReaction,
  _setTransports,
  _setConfig,
  _reset,
};

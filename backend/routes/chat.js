const router = require('express').Router();
const mongoose = require('mongoose');
const { protect, adminOnly } = require('../middleware/auth');
const ChatConversation = require('../models/ChatConversation');
const ChatMessage      = require('../models/ChatMessage');
const ChatRead         = require('../models/ChatRead');
const AppSettings      = require('../models/AppSettings');
const AdminAction      = require('../models/AdminAction');
const ProblemReport    = require('../models/ProblemReport');
const User             = require('../models/User');
const { generateAnnouncementDrafts } = require('../utils/announcementDrafts');
const { resolveSelectedBadges } = require('../utils/selectedBadge');

const isValidId = (id) => mongoose.Types.ObjectId.isValid(id);

// ── Feature-flag gate ────────────────────────────────────────────────────────
async function chatGate(req, res, next) {
  try {
    const settings = await AppSettings.getSettings();
    if (settings.chatEnabled === false) {
      return res.status(503).json({ status: 'error', message: 'Chat is currently unavailable.' });
    }
    next();
  } catch (err) {
    next(err);
  }
}

router.use(protect, chatGate);

// ── Rate limiting ────────────────────────────────────────────────────────────
// In-process sliding window. Deliberately not Mongo-backed: this guards against
// a user holding down Enter, not against a distributed attacker, and the
// backend runs as a single instance. If it is ever scaled horizontally each
// instance will enforce its own window — revisit then.
const RATE_LIMIT_MAX    = 10;
const RATE_LIMIT_WINDOW = 30_000;
const sendTimestamps = new Map(); // userId -> number[]

function hitRateLimit(userId) {
  const key = String(userId);
  const now = Date.now();
  const recent = (sendTimestamps.get(key) ?? []).filter(t => now - t < RATE_LIMIT_WINDOW);
  if (recent.length >= RATE_LIMIT_MAX) {
    sendTimestamps.set(key, recent);
    return true;
  }
  recent.push(now);
  sendTimestamps.set(key, recent);
  return false;
}

// Keep the map from growing without bound on a long-lived process.
setInterval(() => {
  const cutoff = Date.now() - RATE_LIMIT_WINDOW;
  for (const [key, times] of sendTimestamps) {
    const live = times.filter(t => t > cutoff);
    if (live.length) sendTimestamps.set(key, live);
    else sendTimestamps.delete(key);
  }
}, RATE_LIMIT_WINDOW).unref?.();

// ── Helpers ──────────────────────────────────────────────────────────────────

const slugify = (name) => String(name).toLowerCase().trim()
  .replace(/[^a-z0-9]+/g, '-')
  .replace(/^-+|-+$/g, '')
  .slice(0, 40);

const isChatBanned = (user) => Boolean(user?.chatBannedAt);

// Who a message is from, as far as other users are concerned. Support threads
// collapse every admin to one "Skywatch Support" identity; in channels and DMs
// admins speak under their own display name like anyone else.
const SUPPORT_LABEL = 'Skywatch Support';

// Read access.
//   channel  — any logged-in user, unless archived (admins keep reading those)
//   dm       — the two participants
//   support  — the owning user
// Admins can read everything, which is the whole point of the transcript view.
function canRead(convo, user) {
  if (!convo) return false;
  if (user.isAdmin) return true;
  if (convo.type === 'channel') return !convo.isArchived;
  if (convo.type === 'dm') {
    return (convo.participantIds ?? []).some(id => String(id) === String(user._id));
  }
  return Boolean(convo.userId) && String(convo.userId) === String(user._id);
}

// Post access, layered on top of read access. Returns null when allowed, or
// { status, body } describing the refusal.
//
// Two rules worth spelling out:
//   • A chat-banned user can still post in SUPPORT. A ban that also severed the
//     only route to appeal it would be a trap.
//   • The display-name requirement applies to channels and DMs only. Support is
//     a private thread with staff — making someone choose a public identity
//     before they can ask for help would be a pointless gate.
function postRefusal(convo, user) {
  if (!canRead(convo, user)) return { status: 403, body: { message: 'Forbidden' } };

  // Being an admin grants READ access to every DM — that is the transcript
  // power. It does not grant the ability to speak in one. Posting into two
  // strangers' private thread would be indistinguishable from one of them
  // having sent it, so participation is required here even for admins.
  if (convo.type === 'dm') {
    const isParticipant = (convo.participantIds ?? []).some(id => String(id) === String(user._id));
    if (!isParticipant) {
      return { status: 403, body: { message: 'You are not part of this conversation.' } };
    }
  }

  if (convo.type === 'channel') {
    if (convo.isArchived) return { status: 400, body: { message: 'This channel has been archived.' } };
    // An announcements board: everyone reads, only staff post.
    if (convo.channel?.adminOnly && !user.isAdmin) {
      return {
        status: 403,
        body: { code: 'CHANNEL_READ_ONLY', message: 'Only the Skywatch team can post in this channel.' },
      };
    }
  }
  if (convo.type === 'support') {
    if (convo.status === 'closed') return { status: 400, body: { message: 'This chat has been closed.' } };
    return null; // bans and display names do not gate support
  }

  if (isChatBanned(user)) {
    return {
      status: 403,
      body: {
        code: 'CHAT_BANNED',
        message: user.chatBanReason
          ? `You cannot post in chat. Reason: ${user.chatBanReason}`
          : 'You cannot post in chat.',
      },
    };
  }
  if (!user.displayName) {
    return {
      status: 409,
      body: {
        code: 'DISPLAY_NAME_REQUIRED',
        message: 'Set a display name before posting in chat.',
      },
    };
  }
  return null;
}

// Append a message, advancing the conversation's last-message fields and
// marking it read for the sender (sending implies reading everything up to now).
async function appendMessage({ conversation, senderUserId, senderRole, body, senderDisplayName = null }) {
  const message = await ChatMessage.create({
    conversationId: conversation._id,
    senderUserId,
    senderRole,
    body,
    senderDisplayName,
  });

  const update = {
    lastMessageAt:         message.createdAt,
    lastMessageSenderRole: senderRole,
  };
  // Shared across the admin team — see the note on the field in the model.
  if (senderRole === 'admin' && conversation.type === 'support') {
    update.adminLastReadAt = message.createdAt;
  }
  await ChatConversation.findByIdAndUpdate(conversation._id, {
    $set: update,
    $inc: { messageCount: 1 },
  });

  if (senderUserId) await markRead(senderUserId, conversation._id, message.createdAt);

  return message;
}

function markRead(userId, conversationId, at = new Date()) {
  return ChatRead.findOneAndUpdate(
    { userId, conversationId },
    { $set: { lastReadAt: at } },
    { upsert: true },
  );
}

// The unread rule, in one place.
//
// A conversation you have never opened counts as unread — including a channel.
// The Community dot is meant to say "there is something new in here" to every
// user, not only to people who have already been in. The cost is that a user
// who has never opened Community sees a dot for the existing backlog once;
// opening it clears that for good, and the per-user opt-out
// (communityNotificationsEnabled) is the escape hatch for anyone who does not
// want the badge at all.
//
// A user's own message never dots them: appendMessage marks the conversation
// read for the sender as it writes.
function isUnread(convo, readRow) {
  if (!convo.messageCount) return false;
  if (!readRow) return true;
  return new Date(readRow.lastReadAt) < new Date(convo.lastMessageAt);
}

// Every conversation a user can see, projected to just what unread needs.
async function visibleConversations(user, { lean = true } = {}) {
  const query = ChatConversation.find({
    $or: [
      { type: 'channel', isArchived: false },
      { type: 'dm', participantIds: user._id },
      { type: 'support', userId: user._id },
    ],
  }).sort({ lastMessageAt: -1 });
  return lean ? query.lean() : query;
}

async function readMap(userId, conversationIds) {
  const rows = await ChatRead.find({
    userId,
    conversationId: { $in: conversationIds },
  }).lean();
  return new Map(rows.map(r => [String(r.conversationId), r]));
}

// Last non-deleted message per conversation, in one aggregation rather than
// one query per row.
async function previewMap(conversationIds) {
  if (!conversationIds.length) return new Map();
  const rows = await ChatMessage.aggregate([
    { $match: { conversationId: { $in: conversationIds }, deletedAt: null } },
    { $sort: { conversationId: 1, createdAt: -1 } },
    { $group: {
      _id:               '$conversationId',
      body:              { $first: '$body' },
      createdAt:         { $first: '$createdAt' },
      senderRole:        { $first: '$senderRole' },
      senderDisplayName: { $first: '$senderDisplayName' },
    } },
  ]);
  return new Map(rows.map(r => [String(r._id), r]));
}

// Note on deleted messages: non-admins never receive them at all (see the
// query filter in GET /messages). The hideBody branch below is the belt to that
// braces — it keeps any other caller that forgets the filter from leaking a
// removed body.
function serializeMessage(m, { viewerIsAdmin, conversationType }) {
  const deleted = Boolean(m.deletedAt);
  const hideBody = deleted && !viewerIsAdmin;

  // Support threads present all admin replies as one support identity.
  const label = conversationType === 'support' && m.senderRole === 'admin' && !viewerIsAdmin
    ? SUPPORT_LABEL
    : m.senderDisplayName;

  return {
    _id:               m._id,
    conversationId:    m.conversationId,
    senderUserId:      m.senderUserId,
    senderRole:        m.senderRole,
    senderDisplayName: label,
    body:              hideBody ? null : m.body,
    deleted,
    deletedAt:         m.deletedAt ?? null,
    createdAt:         m.createdAt,
  };
}

const channelTitle = (c) =>
  [c.channel?.emoji, c.channel?.name].filter(Boolean).join(' ') || 'Channel';

// Avatar data for everyone who has spoken in a thread, keyed by user id.
//
// Sent as a map rather than denormalised onto each message for two reasons: a
// busy channel repeats the same handful of senders many times over, and the
// avatar is deliberately LIVE — someone who changes their badge should see it
// update on their old messages too. (The display name is the opposite: that is
// snapshotted per message, because a moderation transcript has to show the name
// that was actually on screen at the time.)
//
// In a support thread every admin reply presents as one "Skywatch Support"
// identity, so admins are omitted here — their personal badge is not the
// support team's face, and exposing it would leak which staff member replied.
async function senderProfiles(messages, { conversationType, viewerIsAdmin }) {
  const collapseAdmins = conversationType === 'support' && !viewerIsAdmin;

  const ids = [...new Set(
    messages
      .filter(m => m.senderUserId && m.senderRole !== 'system')
      .filter(m => !(collapseAdmins && m.senderRole === 'admin'))
      .map(m => String(m.senderUserId)),
  )];
  if (!ids.length) return {};

  const users = await User.find({ _id: { $in: ids } })
    .select('displayName agentNumber selectedBadgeBriefId rank')
    .populate('rank', 'rankNumber rankAbbreviation')
    .lean();

  const badges = await resolveSelectedBadges(users.map(u => u.selectedBadgeBriefId));

  const out = {};
  for (const u of users) {
    out[String(u._id)] = {
      _id:           u._id,
      displayName:   u.displayName ?? null,
      agentNumber:   u.agentNumber ?? null,
      // Shape matches what <ProfileBadge> expects, so the chat avatar renders
      // through exactly the same precedence as everywhere else in the app:
      // cutout → rank badge → rank abbreviation.
      selectedBadge: badges.get(String(u.selectedBadgeBriefId)) ?? null,
      rank:          u.rank ?? null,
    };
  }
  return out;
}

// ── User: overview ───────────────────────────────────────────────────────────

// GET /api/chat/overview — one request drives the whole chat list: the pinned
// support row, every live channel, and the user's DMs, each with a preview and
// an unread flag.
router.get('/overview', async (req, res) => {
  try {
    const convos = await visibleConversations(req.user);
    const ids    = convos.map(c => c._id);
    const [reads, previews, dmUsers] = await Promise.all([
      readMap(req.user._id, ids),
      previewMap(ids),
      (async () => {
        const otherIds = convos
          .filter(c => c.type === 'dm')
          .map(c => (c.participantIds ?? []).find(id => String(id) !== String(req.user._id)))
          .filter(Boolean);
        if (!otherIds.length) return new Map();
        const users = await User.find({ _id: { $in: otherIds } })
          .select('displayName agentNumber isAdmin').lean();
        return new Map(users.map(u => [String(u._id), u]));
      })(),
    ]);

    const decorate = (c) => {
      const preview = previews.get(String(c._id));
      return {
        _id:           c._id,
        type:          c.type,
        lastMessageAt: c.lastMessageAt,
        messageCount:  c.messageCount ?? 0,
        unread:        isUnread(c, reads.get(String(c._id))),
        preview: preview
          ? {
            body: preview.body,
            senderDisplayName:
                c.type === 'support' && preview.senderRole === 'admin'
                  ? SUPPORT_LABEL
                  : preview.senderDisplayName,
            createdAt: preview.createdAt,
          }
          : null,
      };
    };

    const channels = convos
      .filter(c => c.type === 'channel')
      .map(c => ({
        ...decorate(c),
        title:       channelTitle(c),
        name:        c.channel?.name ?? '',
        slug:        c.channel?.slug ?? '',
        emoji:       c.channel?.emoji ?? null,
        description: c.channel?.description ?? '',
        order:       c.channel?.order ?? 0,
        adminOnly:   Boolean(c.channel?.adminOnly),
      }))
      .map(c => ({ ...c, adminOnly: Boolean(c.adminOnly) }))
      .sort((a, b) => (a.order - b.order) || a.name.localeCompare(b.name));

    const dms = convos
      .filter(c => c.type === 'dm')
      .map(c => {
        const otherId = (c.participantIds ?? []).find(id => String(id) !== String(req.user._id));
        const other   = dmUsers.get(String(otherId)) ?? null;
        return {
          ...decorate(c),
          otherUser: other && {
            _id:         other._id,
            displayName: other.displayName,
            agentNumber: other.agentNumber,
            isAdmin:     Boolean(other.isAdmin),
          },
          title: other?.displayName || (other?.agentNumber ? `Agent #${other.agentNumber}` : 'Unknown agent'),
        };
      })
      // A DM with no messages yet is an artefact of opening the composer and
      // walking away; don't clutter the list with it.
      .filter(d => d.messageCount > 0);

    const supportConvo = convos.find(c => c.type === 'support' && c.status === 'open')
      ?? convos.find(c => c.type === 'support')
      ?? null;

    res.json({ status: 'success', data: {
      support: supportConvo
        ? { ...decorate(supportConvo), title: SUPPORT_LABEL, status: supportConvo.status }
        : null,
      channels,
      dms,
      viewer: {
        displayName:         req.user.displayName ?? null,
        displayNameRequired: !req.user.displayName,
        chatBanned:          isChatBanned(req.user),
        chatBanReason:       req.user.chatBanReason ?? null,
      },
    } });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// GET /api/chat/users/:id/card — the tap-a-name card in a channel.
// Deliberately minimal: enough to recognise someone and open a DM, nothing more.
router.get('/users/:id/card', async (req, res) => {
  try {
    if (!isValidId(req.params.id)) return res.status(404).json({ message: 'User not found' });
    const target = await User.findById(req.params.id)
      .select('displayName agentNumber isAdmin isBanned').lean();
    if (!target || target.isBanned) return res.status(404).json({ message: 'User not found' });

    res.json({ status: 'success', data: { user: {
      _id:         target._id,
      displayName: target.displayName ?? null,
      agentNumber: target.agentNumber ?? null,
      isAdmin:     Boolean(target.isAdmin),
      isSelf:      String(target._id) === String(req.user._id),
    } } });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// POST /api/chat/dm { userId } — open (or coalesce into) a DM.
// Deduped by the unique participantKey; a concurrent second insert hits E11000
// and re-resolves, the same pattern the support chat uses.
router.post('/dm', async (req, res) => {
  try {
    const { userId } = req.body || {};
    if (!isValidId(userId)) return res.status(400).json({ message: 'Invalid user id' });
    if (String(userId) === String(req.user._id)) {
      return res.status(400).json({ message: 'You cannot message yourself.' });
    }

    const target = await User.findById(userId).select('_id isBanned').lean();
    if (!target || target.isBanned) return res.status(404).json({ message: 'User not found' });

    const participantKey = ChatConversation.dmKey(req.user._id, userId);
    let convo = await ChatConversation.findOne({ type: 'dm', participantKey });
    if (!convo) {
      // Same ordering as ChatConversation.dmKey, so participantIds and
      // participantKey can never disagree about which id comes first.
      const participantIds = [req.user._id, target._id]
        .map(String).sort().map(id => new mongoose.Types.ObjectId(id));
      try {
        convo = await ChatConversation.create({ type: 'dm', participantIds, participantKey });
      } catch (err) {
        if (err && err.code === 11000) {
          convo = await ChatConversation.findOne({ type: 'dm', participantKey });
        } else {
          throw err;
        }
      }
    }

    res.json({ status: 'success', data: { conversation: convo } });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// ── User: support chat (unchanged behaviour) ─────────────────────────────────

// POST /api/chat/conversations — start (or coalesce into) a help chat.
router.post('/conversations', async (req, res) => {
  try {
    let convo = await ChatConversation.findOne({
      type: 'support', userId: req.user._id, status: 'open',
    });
    if (!convo) {
      try {
        convo = await ChatConversation.create({
          type: 'support', userId: req.user._id, startedByRole: 'user',
        });
      } catch (err) {
        if (err && err.code === 11000) {
          convo = await ChatConversation.findOne({ type: 'support', userId: req.user._id, status: 'open' });
        } else {
          throw err;
        }
      }
    }
    res.json({ status: 'success', data: { conversation: convo } });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// GET /api/chat/conversations/mine — the current user's support conversations
router.get('/conversations/mine', async (req, res) => {
  try {
    const conversations = await ChatConversation
      .find({ type: 'support', userId: req.user._id })
      .sort({ lastMessageAt: -1 });
    res.json({ status: 'success', data: { conversations } });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// GET /api/chat/unread/me — drives the navbar dot.
// `hasAnyOpenChat` is retained for the support-chat entry point; the badge
// itself is now always visible off-native, so it no longer gates the nav item.
router.get('/unread/me', async (req, res) => {
  try {
    const convos = await visibleConversations(req.user);
    const reads  = await readMap(req.user._id, convos.map(c => c._id));

    const unread = convos.filter(c => isUnread(c, reads.get(String(c._id))));
    const hasAnyOpenChat = convos.some(c => c.type === 'support' && c.status === 'open');

    // Opted out of the Community dot. Zeroed here rather than left to the
    // client so the badge cannot come back through any other caller, and so a
    // stale frontend can't keep showing it.
    const muted = req.user.communityNotificationsEnabled === false;

    res.json({ status: 'success', data: {
      hasAnyOpenChat,
      hasUnread:   !muted && unread.length > 0,
      totalUnread: muted ? 0 : unread.length,
      muted,
    } });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// ── Messages ─────────────────────────────────────────────────────────────────

// GET /api/chat/conversations/:id/messages?before=<ISO>&limit=50
router.get('/conversations/:id/messages', async (req, res) => {
  try {
    if (!isValidId(req.params.id)) return res.status(404).json({ message: 'Conversation not found' });

    const convo = await ChatConversation.findById(req.params.id);
    if (!convo) return res.status(404).json({ message: 'Conversation not found' });
    if (!canRead(convo, req.user)) return res.status(403).json({ message: 'Forbidden' });

    const limit  = Math.min(200, Math.max(1, parseInt(req.query.limit, 10) || 50));
    const before = req.query.before ? new Date(req.query.before) : null;
    const filter = { conversationId: convo._id };
    if (before && !isNaN(before.getTime())) filter.createdAt = { $lt: before };

    // A removed message is gone as far as users are concerned — no tombstone,
    // no "removed by a moderator" placeholder. A placeholder still advertises
    // that something happened and invites speculation about what; leaving no
    // trace is the point of removing it.
    //
    // Filtered in the QUERY rather than after fetching, so `limit` and
    // `hasMore` still describe the page the user actually receives. Admins are
    // exempt: the moderation record is the whole reason the row is kept.
    if (!req.user.isAdmin) filter.deletedAt = null;

    const messages = await ChatMessage
      .find(filter)
      .sort({ createdAt: -1 })
      .limit(limit + 1)
      .lean();

    const hasMore = messages.length > limit;
    const items   = (hasMore ? messages.slice(0, limit) : messages).reverse();

    const senders = await senderProfiles(items, {
      conversationType: convo.type,
      viewerIsAdmin:    Boolean(req.user.isAdmin),
    });

    res.json({ status: 'success', data: {
      messages: items.map(m => serializeMessage(m, {
        viewerIsAdmin:    Boolean(req.user.isAdmin),
        conversationType: convo.type,
      })),
      senders,
      hasMore,
      conversation: {
        _id:        convo._id,
        type:       convo.type,
        status:     convo.status,
        isArchived: convo.isArchived,
        adminOnly:  Boolean(convo.channel?.adminOnly),
        title:      convo.type === 'channel' ? channelTitle(convo) : null,
      },
    } });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// POST /api/chat/conversations/:id/messages — send a message
router.post('/conversations/:id/messages', async (req, res) => {
  try {
    if (!isValidId(req.params.id)) return res.status(404).json({ message: 'Conversation not found' });

    const body = (req.body?.body ?? '').toString().trim();
    if (!body) return res.status(400).json({ message: 'Message body is required' });
    if (body.length > 4000) return res.status(400).json({ message: 'Message too long (max 4000 chars)' });

    const convo = await ChatConversation.findById(req.params.id);
    if (!convo) return res.status(404).json({ message: 'Conversation not found' });

    const refusal = postRefusal(convo, req.user);
    if (refusal) return res.status(refusal.status).json(refusal.body);

    if (hitRateLimit(req.user._id)) {
      return res.status(429).json({ message: 'You are sending messages too quickly. Wait a moment.' });
    }

    // In support, "admin" means an admin replying to someone else's thread.
    // Everywhere else the sender is just a participant, and admins post under
    // their own name — so the role tracks who they are, not where they are.
    const isOwner = convo.type === 'support' && String(convo.userId) === String(req.user._id);
    const senderRole = convo.type === 'support'
      ? (isOwner ? 'user' : 'admin')
      : (req.user.isAdmin ? 'admin' : 'user');

    const message = await appendMessage({
      conversation:      convo,
      senderUserId:      req.user._id,
      senderRole,
      body,
      senderDisplayName: req.user.displayName ?? null,
    });

    res.json({ status: 'success', data: {
      message: serializeMessage(message.toObject(), {
        viewerIsAdmin:    Boolean(req.user.isAdmin),
        conversationType: convo.type,
      }),
    } });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// POST /api/chat/conversations/:id/read — mark conversation read
router.post('/conversations/:id/read', async (req, res) => {
  try {
    if (!isValidId(req.params.id)) return res.status(404).json({ message: 'Conversation not found' });

    const convo = await ChatConversation.findById(req.params.id);
    if (!convo) return res.status(404).json({ message: 'Conversation not found' });
    if (!canRead(convo, req.user)) return res.status(403).json({ message: 'Forbidden' });

    await markRead(req.user._id, convo._id);
    // Support keeps a shared team-wide read marker alongside the per-user one.
    if (convo.type === 'support' && req.user.isAdmin) {
      await ChatConversation.findByIdAndUpdate(convo._id, { adminLastReadAt: new Date() });
    }

    res.json({ status: 'success' });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// POST /api/chat/messages/:id/report — report a message to the admins.
// Lands in the same ProblemReport queue as bug reports, tagged kind
// 'chat_message' so Admin › Intel › Reports can filter it.
router.post('/messages/:id/report', async (req, res) => {
  try {
    if (!isValidId(req.params.id)) return res.status(404).json({ message: 'Message not found' });

    const reason = (req.body?.reason ?? '').toString().trim().slice(0, 500);

    const message = await ChatMessage.findById(req.params.id);
    if (!message) return res.status(404).json({ message: 'Message not found' });
    if (message.senderRole === 'system') {
      return res.status(400).json({ message: 'System messages cannot be reported.' });
    }
    if (String(message.senderUserId) === String(req.user._id)) {
      return res.status(400).json({ message: 'You cannot report your own message.' });
    }

    const convo = await ChatConversation.findById(message.conversationId);
    if (!convo || !canRead(convo, req.user)) return res.status(403).json({ message: 'Forbidden' });

    const where = convo.type === 'channel'
      ? `Chat channel: ${convo.channel?.name ?? 'unknown'}`
      : convo.type === 'dm' ? 'Chat direct message' : 'Chat support';

    // The reported body is copied into the description so the queue still shows
    // what was said even if a moderator soft-deletes the message afterwards.
    const description = [
      reason || '(no reason given)',
      '',
      `— Reported message from ${message.senderDisplayName || 'unknown'}:`,
      message.body,
    ].join('\n');

    try {
      await ProblemReport.create({
        kind:               'chat_message',
        userId:             req.user._id,
        reportedUserId:     message.senderUserId,
        chatMessageId:      message._id,
        chatConversationId: convo._id,
        pageReported:       where,
        description,
      });
    } catch (err) {
      // Already reported by this user — idempotent, not an error worth showing.
      if (!err || err.code !== 11000) throw err;
    }

    res.json({ status: 'success' });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// POST /api/chat/conversations/:id/close — user-initiated close (support only)
router.post('/conversations/:id/close', async (req, res) => {
  try {
    if (!isValidId(req.params.id)) return res.status(404).json({ message: 'Conversation not found' });

    const convo = await ChatConversation.findById(req.params.id);
    if (!convo) return res.status(404).json({ message: 'Conversation not found' });
    if (convo.type !== 'support') {
      return res.status(400).json({ message: 'Only support chats can be closed.' });
    }
    if (String(convo.userId) !== String(req.user._id)) {
      return res.status(403).json({ message: 'Forbidden' });
    }
    if (convo.status === 'closed') {
      return res.json({ status: 'success', data: { conversation: convo } });
    }

    const updated = await closeConversation(convo, {
      byRole: 'user', byUserId: req.user._id, body: 'User closed this chat',
    });
    res.json({ status: 'success', data: { conversation: updated } });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Shared by the user and admin close routes. Snaps both sides' read markers to
// the closing system message so neither is left with a dot pointing at a
// surface they can no longer act on.
async function closeConversation(convo, { byRole, byUserId, body }) {
  const sysMsg = await ChatMessage.create({
    conversationId: convo._id,
    senderUserId:   byUserId,
    senderRole:     'system',
    body,
  });
  const updated = await ChatConversation.findByIdAndUpdate(
    convo._id,
    {
      $set: {
        status:                'closed',
        closedAt:              sysMsg.createdAt,
        closedBy:              byRole,
        closedByUserId:        byUserId,
        lastMessageAt:         sysMsg.createdAt,
        lastMessageSenderRole: 'system',
        adminLastReadAt:       sysMsg.createdAt,
      },
      $inc: { messageCount: 1 },
    },
    { returnDocument: 'after' },
  );
  if (convo.userId) await markRead(convo.userId, convo._id, sysMsg.createdAt);
  if (byUserId)     await markRead(byUserId,     convo._id, sysMsg.createdAt);
  return updated;
}

// ── Admin: support queue (unchanged behaviour) ───────────────────────────────

// GET /api/chat/unread/admin — drives the admin navbar dot
router.get('/unread/admin', adminOnly, async (req, res) => {
  try {
    const [openExists, unreadCount] = await Promise.all([
      ChatConversation.exists({ type: 'support', status: 'open' }),
      ChatConversation.countDocuments({
        type: 'support',
        lastMessageSenderRole: 'user',
        $or: [
          { adminLastReadAt: null },
          { $expr: { $lt: ['$adminLastReadAt', '$lastMessageAt'] } },
        ],
      }),
    ]);
    res.json({ status: 'success', data: {
      hasAnyOpenChat:            Boolean(openExists),
      hasUnread:                 unreadCount > 0,
      totalUnreadConversations:  unreadCount,
    } });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// GET /api/chat/admin/conversations?status=&type=&userId=&page=&limit=
// `type` is the new filter powering the Support / Channels / DMs tabs in the
// admin rail; omitting it keeps the original support-only behaviour.
router.get('/admin/conversations', adminOnly, async (req, res) => {
  try {
    const status = req.query.status || 'all';
    const type   = req.query.type   || 'support';
    const filter = {};
    if (type !== 'all') filter.type = type;
    if (type === 'support' && (status === 'open' || status === 'closed')) filter.status = status;
    if (req.query.userId && isValidId(req.query.userId)) {
      filter.$or = [{ userId: req.query.userId }, { participantIds: req.query.userId }];
    }

    const page  = Math.max(1, parseInt(req.query.page,  10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 30));

    const [conversations, total] = await Promise.all([
      ChatConversation.find(filter)
        .sort({ lastMessageAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .populate('userId', 'agentNumber email isAdmin displayName')
        .populate('participantIds', 'agentNumber email displayName')
        .lean(),
      ChatConversation.countDocuments(filter),
    ]);

    const enriched = conversations.map(c => ({
      ...c,
      title: c.type === 'channel' ? channelTitle(c) : null,
      hasAdminUnread:
        c.type === 'support' &&
        c.lastMessageSenderRole === 'user' &&
        (!c.adminLastReadAt || new Date(c.adminLastReadAt) < new Date(c.lastMessageAt)),
    }));

    res.json({ status: 'success', data: {
      conversations: enriched,
      total,
      page,
      totalPages: Math.ceil(total / limit),
    } });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// GET /api/chat/admin/users/:userId/conversations — every thread a user is in,
// support and DMs alike, so "show me everything this person has said" is one click.
router.get('/admin/users/:userId/conversations', adminOnly, async (req, res) => {
  try {
    if (!isValidId(req.params.userId)) return res.status(400).json({ message: 'Invalid user id' });

    const conversations = await ChatConversation
      .find({ $or: [
        { userId: req.params.userId },
        { participantIds: req.params.userId },
      ] })
      .sort({ lastMessageAt: -1 })
      .populate('userId', 'agentNumber email displayName')
      .populate('participantIds', 'agentNumber email displayName')
      .lean();

    const enriched = conversations.map(c => ({
      ...c,
      title: c.type === 'channel' ? channelTitle(c) : null,
      hasAdminUnread:
        c.type === 'support' &&
        c.lastMessageSenderRole === 'user' &&
        (!c.adminLastReadAt || new Date(c.adminLastReadAt) < new Date(c.lastMessageAt)),
    }));

    res.json({ status: 'success', data: { conversations: enriched } });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// GET /api/chat/admin/users/:userId/messages — flat transcript of everything a
// user has posted, across every channel and DM. The moderation view.
router.get('/admin/users/:userId/messages', adminOnly, async (req, res) => {
  try {
    if (!isValidId(req.params.userId)) return res.status(400).json({ message: 'Invalid user id' });

    const limit = Math.min(200, Math.max(1, parseInt(req.query.limit, 10) || 100));
    const messages = await ChatMessage.find({ senderUserId: req.params.userId })
      .sort({ createdAt: -1 })
      .limit(limit)
      .lean();

    const convoIds = [...new Set(messages.map(m => String(m.conversationId)))];
    const convos = await ChatConversation.find({ _id: { $in: convoIds } })
      .select('type channel participantIds userId').lean();
    const byId = new Map(convos.map(c => [String(c._id), c]));

    res.json({ status: 'success', data: {
      messages: messages.map(m => {
        const c = byId.get(String(m.conversationId));
        return {
          ...serializeMessage(m, { viewerIsAdmin: true, conversationType: c?.type }),
          conversationType:  c?.type ?? null,
          conversationTitle: c?.type === 'channel' ? channelTitle(c) : null,
        };
      }),
    } });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// POST /api/chat/admin/conversations { userId } — start (or coalesce) a support chat
router.post('/admin/conversations', adminOnly, async (req, res) => {
  try {
    const { userId } = req.body || {};
    if (!isValidId(userId)) return res.status(400).json({ message: 'Invalid user id' });

    const target = await User.findById(userId).select('_id');
    if (!target) return res.status(404).json({ message: 'User not found' });

    let convo = await ChatConversation.findOne({ type: 'support', userId, status: 'open' });
    let created = false;
    if (!convo) {
      try {
        convo = await ChatConversation.create({ type: 'support', userId, startedByRole: 'admin' });
        created = true;
        await AdminAction.create({
          userId:       req.user._id,
          actionType:   'chat_start',
          reason:       'Admin started a help chat with the user',
          targetUserId: userId,
        });
      } catch (err) {
        if (err && err.code === 11000) {
          convo = await ChatConversation.findOne({ type: 'support', userId, status: 'open' });
        } else {
          throw err;
        }
      }
    }

    res.json({ status: 'success', data: { conversation: convo, created } });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// POST /api/chat/admin/conversations/:id/close — admin-initiated close
router.post('/admin/conversations/:id/close', adminOnly, async (req, res) => {
  try {
    if (!isValidId(req.params.id)) return res.status(404).json({ message: 'Conversation not found' });

    const convo = await ChatConversation.findById(req.params.id);
    if (!convo) return res.status(404).json({ message: 'Conversation not found' });
    if (convo.type !== 'support') {
      return res.status(400).json({ message: 'Only support chats can be closed.' });
    }
    if (convo.status === 'closed') {
      return res.json({ status: 'success', data: { conversation: convo } });
    }

    const updated = await closeConversation(convo, {
      byRole: 'admin', byUserId: req.user._id, body: 'Admin closed this chat',
    });

    await AdminAction.create({
      userId:       req.user._id,
      actionType:   'chat_close',
      reason:       'Admin closed the help chat',
      targetUserId: convo.userId,
    });

    res.json({ status: 'success', data: { conversation: updated } });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// POST /api/chat/admin/conversations/:id/reopen — admin-only undo of a close
router.post('/admin/conversations/:id/reopen', adminOnly, async (req, res) => {
  try {
    if (!isValidId(req.params.id)) return res.status(404).json({ message: 'Conversation not found' });

    const convo = await ChatConversation.findById(req.params.id);
    if (!convo) return res.status(404).json({ message: 'Conversation not found' });
    if (convo.status === 'open') {
      return res.json({ status: 'success', data: { conversation: convo } });
    }

    const sysMsg = await ChatMessage.create({
      conversationId: convo._id,
      senderUserId:   req.user._id,
      senderRole:     'system',
      body:           'Admin reopened this chat',
    });
    const updated = await ChatConversation.findByIdAndUpdate(
      convo._id,
      {
        $set: {
          status:                'open',
          closedAt:              null,
          closedBy:              null,
          closedByUserId:        null,
          lastMessageAt:         sysMsg.createdAt,
          lastMessageSenderRole: 'system',
          adminLastReadAt:       sysMsg.createdAt,
        },
        $inc: { messageCount: 1 },
      },
      { returnDocument: 'after' },
    );
    await markRead(req.user._id, convo._id, sysMsg.createdAt);

    await AdminAction.create({
      userId:       req.user._id,
      actionType:   'chat_reopen',
      reason:       'Admin reopened the help chat',
      targetUserId: convo.userId,
    });

    res.json({ status: 'success', data: { conversation: updated } });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// ── Admin: channels ──────────────────────────────────────────────────────────

// GET /api/chat/admin/channels?includeArchived=true
router.get('/admin/channels', adminOnly, async (req, res) => {
  try {
    const filter = { type: 'channel' };
    if (req.query.includeArchived !== 'true') filter.isArchived = false;

    const channels = await ChatConversation.find(filter)
      .sort({ isArchived: 1, 'channel.order': 1, 'channel.name': 1 })
      .lean();

    res.json({ status: 'success', data: {
      channels: channels.map(c => ({
        _id:           c._id,
        name:          c.channel?.name ?? '',
        slug:          c.channel?.slug ?? '',
        description:   c.channel?.description ?? '',
        emoji:         c.channel?.emoji ?? null,
        order:         c.channel?.order ?? 0,
        isArchived:    Boolean(c.isArchived),
        archivedAt:    c.archivedAt ?? null,
        messageCount:  c.messageCount ?? 0,
        lastMessageAt: c.lastMessageAt,
      })),
    } });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// POST /api/chat/admin/channels — create a channel
router.post('/admin/channels', adminOnly, async (req, res) => {
  try {
    const name = (req.body?.name ?? '').toString().trim();
    if (!name) return res.status(400).json({ message: 'Channel name is required' });
    if (name.length > 40) return res.status(400).json({ message: 'Channel name must be 40 characters or fewer' });

    const slug = slugify(name);
    if (!slug) return res.status(400).json({ message: 'Channel name must contain letters or numbers' });

    const channel = {
      name,
      slug,
      description: (req.body?.description ?? '').toString().trim().slice(0, 200),
      emoji:       (req.body?.emoji ?? '').toString().trim().slice(0, 8) || null,
      order:       Number.isFinite(Number(req.body?.order)) ? Number(req.body.order) : 0,
      adminOnly:   req.body?.adminOnly === true,
    };

    // Explicit check first so the answer is deterministic, then the unique
    // index as the race backstop for two admins creating the same name at once.
    const clash = await ChatConversation.exists({
      type: 'channel', isArchived: false, 'channel.slug': slug,
    });
    if (clash) return res.status(409).json({ message: 'A channel with that name already exists.' });

    let created;
    try {
      created = await ChatConversation.create({ type: 'channel', channel, isArchived: false });
    } catch (err) {
      if (err && err.code === 11000) {
        return res.status(409).json({ message: 'A channel with that name already exists.' });
      }
      throw err;
    }

    await AdminAction.create({
      userId:     req.user._id,
      actionType: 'chat_channel_create',
      reason:     `Created chat channel "${name}"`,
    });

    res.json({ status: 'success', data: { channel: created } });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// PATCH /api/chat/admin/channels/:id — rename / re-describe / reorder
router.patch('/admin/channels/:id', adminOnly, async (req, res) => {
  try {
    if (!isValidId(req.params.id)) return res.status(404).json({ message: 'Channel not found' });

    const convo = await ChatConversation.findById(req.params.id);
    if (!convo || convo.type !== 'channel') return res.status(404).json({ message: 'Channel not found' });

    const set = {};
    if (req.body?.name !== undefined) {
      const name = String(req.body.name).trim();
      if (!name) return res.status(400).json({ message: 'Channel name is required' });
      if (name.length > 40) return res.status(400).json({ message: 'Channel name must be 40 characters or fewer' });
      const slug = slugify(name);
      if (!slug) return res.status(400).json({ message: 'Channel name must contain letters or numbers' });
      const clash = await ChatConversation.exists({
        type: 'channel', isArchived: false, 'channel.slug': slug, _id: { $ne: convo._id },
      });
      if (clash) return res.status(409).json({ message: 'A channel with that name already exists.' });
      set['channel.name'] = name;
      set['channel.slug'] = slug;
    }
    if (req.body?.description !== undefined) {
      set['channel.description'] = String(req.body.description).trim().slice(0, 200);
    }
    if (req.body?.emoji !== undefined) {
      set['channel.emoji'] = String(req.body.emoji).trim().slice(0, 8) || null;
    }
    if (req.body?.order !== undefined && Number.isFinite(Number(req.body.order))) {
      set['channel.order'] = Number(req.body.order);
    }
    if (req.body?.adminOnly !== undefined) {
      set['channel.adminOnly'] = req.body.adminOnly === true;
    }

    let updated;
    try {
      updated = await ChatConversation.findByIdAndUpdate(
        convo._id, { $set: set }, { returnDocument: 'after' },
      );
    } catch (err) {
      if (err && err.code === 11000) {
        return res.status(409).json({ message: 'A channel with that name already exists.' });
      }
      throw err;
    }

    await AdminAction.create({
      userId:     req.user._id,
      actionType: 'chat_channel_edit',
      reason:     `Edited chat channel "${updated.channel?.name}"`,
    });

    res.json({ status: 'success', data: { channel: updated } });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// POST /api/chat/admin/channels/:id/archive — hide from users, keep transcripts.
// This is what "delete a channel" does in the admin UI; the permanent purge
// below is a separate, deliberate second step.
router.post('/admin/channels/:id/archive', adminOnly, async (req, res) => {
  try {
    if (!isValidId(req.params.id)) return res.status(404).json({ message: 'Channel not found' });

    const convo = await ChatConversation.findById(req.params.id);
    if (!convo || convo.type !== 'channel') return res.status(404).json({ message: 'Channel not found' });

    const updated = await ChatConversation.findByIdAndUpdate(
      convo._id,
      { $set: { isArchived: true, archivedAt: new Date(), archivedByUserId: req.user._id } },
      { returnDocument: 'after' },
    );

    await AdminAction.create({
      userId:     req.user._id,
      actionType: 'chat_channel_archive',
      reason:     `Archived chat channel "${convo.channel?.name}" (transcripts retained)`,
    });

    res.json({ status: 'success', data: { channel: updated } });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// POST /api/chat/admin/channels/:id/unarchive
router.post('/admin/channels/:id/unarchive', adminOnly, async (req, res) => {
  try {
    if (!isValidId(req.params.id)) return res.status(404).json({ message: 'Channel not found' });

    const convo = await ChatConversation.findById(req.params.id);
    if (!convo || convo.type !== 'channel') return res.status(404).json({ message: 'Channel not found' });

    const clash = await ChatConversation.exists({
      type: 'channel', isArchived: false, 'channel.slug': convo.channel?.slug,
    });
    if (clash) {
      return res.status(409).json({ message: 'A live channel already uses that name. Rename it first.' });
    }

    let updated;
    try {
      updated = await ChatConversation.findByIdAndUpdate(
        convo._id,
        { $set: { isArchived: false, archivedAt: null, archivedByUserId: null } },
        { returnDocument: 'after' },
      );
    } catch (err) {
      // A live channel has taken the slug in the meantime.
      if (err && err.code === 11000) {
        return res.status(409).json({ message: 'A live channel already uses that name. Rename it first.' });
      }
      throw err;
    }

    await AdminAction.create({
      userId:     req.user._id,
      actionType: 'chat_channel_unarchive',
      reason:     `Restored chat channel "${convo.channel?.name}"`,
    });

    res.json({ status: 'success', data: { channel: updated } });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// DELETE /api/chat/admin/channels/:id — permanent purge.
// Only allowed on an already-archived channel, so destroying a transcript is
// always two deliberate steps rather than one misclick.
router.delete('/admin/channels/:id', adminOnly, async (req, res) => {
  try {
    if (!isValidId(req.params.id)) return res.status(404).json({ message: 'Channel not found' });

    const convo = await ChatConversation.findById(req.params.id);
    if (!convo || convo.type !== 'channel') return res.status(404).json({ message: 'Channel not found' });
    if (!convo.isArchived) {
      return res.status(400).json({
        message: 'Archive the channel before deleting it permanently.',
      });
    }

    const { deletedCount } = await ChatMessage.deleteMany({ conversationId: convo._id });
    await ChatRead.deleteMany({ conversationId: convo._id });
    await ChatConversation.findByIdAndDelete(convo._id);

    await AdminAction.create({
      userId:     req.user._id,
      actionType: 'chat_channel_delete',
      reason:     `Permanently deleted chat channel "${convo.channel?.name}" and ${deletedCount} message(s)`,
    });

    res.json({ status: 'success', data: { deletedMessages: deletedCount } });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// ── Admin: announcements ─────────────────────────────────────────────────────

// POST /api/chat/admin/channels/:id/draft-updates
// Reads recent GitHub commits and returns short player-facing update notes for
// the admin to approve, edit or discard. Deliberately posts NOTHING — see the
// note at the top of utils/announcementDrafts.js.
router.post('/admin/channels/:id/draft-updates', adminOnly, async (req, res) => {
  try {
    if (!isValidId(req.params.id)) return res.status(404).json({ message: 'Channel not found' });

    const convo = await ChatConversation.findById(req.params.id);
    if (!convo || convo.type !== 'channel') return res.status(404).json({ message: 'Channel not found' });

    if (!process.env.GITHUB_REPO || !process.env.GITHUB_TOKEN) {
      return res.status(503).json({
        message: 'GitHub is not configured on the server (GITHUB_REPO / GITHUB_TOKEN).',
      });
    }

    // Everything this channel has already announced, so a second run offers new
    // material rather than repeating itself.
    const announced = await ChatMessage.find({
      conversationId: convo._id,
      announcedCommitShas: { $exists: true, $ne: [] },
    }).select('announcedCommitShas').lean();
    const excludeShas = announced.flatMap(m => m.announcedCommitShas ?? []);

    const result = await generateAnnouncementDrafts({ excludeShas });

    res.json({ status: 'success', data: result });
  } catch (err) {
    res.status(502).json({ message: err.message });
  }
});

// POST /api/chat/admin/channels/:id/announce { body, shas }
// Publishes one approved note. Separate from the generic message endpoint
// because it also records which commits the note covered.
router.post('/admin/channels/:id/announce', adminOnly, async (req, res) => {
  try {
    if (!isValidId(req.params.id)) return res.status(404).json({ message: 'Channel not found' });

    const body = (req.body?.body ?? '').toString().trim();
    if (!body) return res.status(400).json({ message: 'Message body is required' });
    if (body.length > 4000) return res.status(400).json({ message: 'Message too long (max 4000 chars)' });

    const convo = await ChatConversation.findById(req.params.id);
    if (!convo || convo.type !== 'channel') return res.status(404).json({ message: 'Channel not found' });
    if (convo.isArchived) return res.status(400).json({ message: 'This channel has been archived.' });

    const shas = Array.isArray(req.body?.shas)
      ? req.body.shas.filter(s => typeof s === 'string').slice(0, 50)
      : [];

    const message = await appendMessage({
      conversation:      convo,
      senderUserId:      req.user._id,
      senderRole:        'admin',
      body,
      senderDisplayName: req.user.displayName ?? null,
    });

    if (shas.length) {
      await ChatMessage.findByIdAndUpdate(message._id, { $set: { announcedCommitShas: shas } });
    }

    res.json({ status: 'success', data: {
      message: serializeMessage(message.toObject(), {
        viewerIsAdmin: true, conversationType: 'channel',
      }),
    } });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// ── Admin: moderation ────────────────────────────────────────────────────────

// DELETE /api/chat/admin/messages/:id — soft delete.
// The body is kept so the transcript still records what was said; users see a
// placeholder instead.
router.delete('/admin/messages/:id', adminOnly, async (req, res) => {
  try {
    if (!isValidId(req.params.id)) return res.status(404).json({ message: 'Message not found' });

    const message = await ChatMessage.findById(req.params.id);
    if (!message) return res.status(404).json({ message: 'Message not found' });
    if (message.deletedAt) {
      return res.json({ status: 'success', data: { message } });
    }

    const updated = await ChatMessage.findByIdAndUpdate(
      message._id,
      { $set: { deletedAt: new Date(), deletedByUserId: req.user._id } },
      { returnDocument: 'after' },
    );

    await AdminAction.create({
      userId:       req.user._id,
      actionType:   'chat_message_delete',
      reason:       'Removed a chat message',
      targetUserId: message.senderUserId ?? undefined,
    });

    res.json({ status: 'success', data: {
      message: serializeMessage(updated.toObject(), { viewerIsAdmin: true }),
    } });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// POST /api/chat/admin/users/:id/chat-ban { reason }
router.post('/admin/users/:id/chat-ban', adminOnly, async (req, res) => {
  try {
    if (!isValidId(req.params.id)) return res.status(400).json({ message: 'Invalid user id' });

    const target = await User.findById(req.params.id).select('_id isAdmin');
    if (!target) return res.status(404).json({ message: 'User not found' });
    if (target.isAdmin) return res.status(400).json({ message: 'Admins cannot be chat-banned.' });

    const reason = (req.body?.reason ?? '').toString().trim().slice(0, 300) || null;
    await User.findByIdAndUpdate(target._id, { $set: {
      chatBannedAt:       new Date(),
      chatBannedByUserId: req.user._id,
      chatBanReason:      reason,
    } });

    await AdminAction.create({
      userId:       req.user._id,
      actionType:   'chat_ban',
      reason:       reason ? `Banned from chat: ${reason}` : 'Banned from chat',
      targetUserId: target._id,
    });

    res.json({ status: 'success' });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// DELETE /api/chat/admin/users/:id/chat-ban
router.delete('/admin/users/:id/chat-ban', adminOnly, async (req, res) => {
  try {
    if (!isValidId(req.params.id)) return res.status(400).json({ message: 'Invalid user id' });

    const target = await User.findById(req.params.id).select('_id');
    if (!target) return res.status(404).json({ message: 'User not found' });

    await User.findByIdAndUpdate(target._id, { $set: {
      chatBannedAt: null, chatBannedByUserId: null, chatBanReason: null,
    } });

    await AdminAction.create({
      userId:       req.user._id,
      actionType:   'chat_unban',
      reason:       'Lifted chat ban',
      targetUserId: target._id,
    });

    res.json({ status: 'success' });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

module.exports = router;

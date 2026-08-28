const router = require('express').Router();
const mongoose = require('mongoose');
const { protect, adminOnly } = require('../middleware/auth');
const ChatConversation = require('../models/ChatConversation');
const ChatMessage      = require('../models/ChatMessage');
const ChatRead         = require('../models/ChatRead');
const ChatGuide        = require('../models/ChatGuide');
const AppSettings      = require('../models/AppSettings');
const AdminAction      = require('../models/AdminAction');
const ProblemReport    = require('../models/ProblemReport');
const User             = require('../models/User');
const { generateAnnouncementDrafts } = require('../utils/announcementDrafts');
const { resolveSelectedBadges } = require('../utils/selectedBadge');
const { PRESENCE_WINDOW_MS, PRESENCE_LIST_LIMIT } = require('../constants/presence');
const { medalsForUsers } = require('../utils/cbatMedalHolders');
const BotKnowledge = require('../models/BotKnowledge');
const { parseGuideUpload, renderGuideCorpus } = require('../utils/cbatGuideParser');

const {
  generateBotReply, screenChannelMention, stripMention, looksHostile, REFUSALS,
} = require('../utils/chatBot');
const chatStream = require('../utils/chatStream');
const { LOUNGE_SLUG } = require('../seeds/seedCbatLounge');
const { resolveMentions, MENTION_LIMIT } = require('../utils/chatMentions');
const { selectGuideSlice } = require('../utils/cbatGuideRetrieval');
const { overDailyBudget, noteBotSpend } = require('../utils/chatBotBudget');

// One knowledge document for now. A second bot would key off its own slug.
const BOT_KNOWLEDGE_SLUG = 'cbat-guide';

const POST_POLICIES = ['everyone', 'admin', 'bot'];

// Fixed reaction set. Deliberately small: a picker people can scan beats an
// emoji keyboard, and a whitelist keeps arbitrary text out of a channel whose
// whole point is that users cannot post text into it.
const REACTION_EMOJI = ['👍', '🎉', '🔥', '👏', '😮', '❤️'];

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
// collapse every admin to one "SkyWatch Support" identity; in channels and DMs
// admins speak under their own display name like anyone else.
const SUPPORT_LABEL = 'SkyWatch Support';

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
    // Second gate on bot DMs — see POST /dm. A thread that outlives someone's
    // admin rights must stop accepting messages, not keep working.
    if (convo.botUserId && !user.isAdmin) {
      return { status: 403, body: { message: 'That agent is not accepting direct messages.' } };
    }
  }

  if (convo.type === 'channel') {
    if (convo.isArchived) return { status: 400, body: { message: 'This channel has been archived.' } };
    const policy = convo.channel?.postPolicy ?? 'everyone';
    // A bot feed. Only the one bot writes here — not admins either, so a stray
    // human message can never appear in what reads as an automated record.
    if (policy === 'bot' && String(convo.channel?.postBotUserId ?? '') !== String(user._id)) {
      return {
        status: 403,
        body: { code: 'CHANNEL_READ_ONLY', message: 'This channel is a feed. React to a message instead of replying.' },
      };
    }
    if (policy === 'admin' && !user.isAdmin) {
      return {
        status: 403,
        body: { code: 'CHANNEL_READ_ONLY', message: 'Only the SkyWatch team can post in this channel.' },
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
async function appendMessage({
  conversation, senderUserId, senderRole, body, senderDisplayName = null, replyTo = null,
  mentions = [],
}) {
  const message = await ChatMessage.create({
    conversationId: conversation._id,
    senderUserId,
    senderRole,
    body,
    senderDisplayName,
    ...(replyTo ? { replyTo } : {}),
    ...(mentions.length ? { mentions } : {}),
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

  // Push to anyone holding a live stream on this conversation. Done here rather
  // than at each call site so every writer — a user, the guide bot, the medal
  // feed — pushes without having to remember to.
  //
  // The payload is the NON-ADMIN view, deliberately: a stream carries one
  // rendering to every listener, so it must be the one that is safe for all of
  // them. In practice that only matters in a support thread, where the admin
  // who replied stays behind the shared support identity.
  chatStream.publish(conversation._id, 'message', {
    _id:               String(message._id),
    conversationId:    String(conversation._id),
    senderUserId:      senderUserId ? String(senderUserId) : null,
    senderRole,
    senderDisplayName: conversation.type === 'support' && senderRole === 'admin'
      ? SUPPORT_LABEL
      : senderDisplayName,
    body,
    createdAt:         message.createdAt,
    mentions:          mentions.map(String),
    // The reply snapshot rides along, or a reply arriving live would render
    // without the quote it is answering until the next full refetch. Safe for
    // every listener for the same reason the snapshot exists: it is a copy
    // taken at send time, not a live read of the parent.
    replyTo:           replyTo ? {
      messageId:   String(replyTo.messageId),
      displayName: replyTo.displayName ?? null,
      excerpt:     replyTo.excerpt ?? null,
    } : null,
    // A brand new message has none, but the field has to exist: clients render
    // reactions straight off the message and would otherwise special-case the
    // streamed copy.
    reactions:         [],
  });

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
  // Admin-disabled notifications for this channel. A feed that badges the
  // navbar on every message trains people to ignore the dot, which would cost
  // it its meaning everywhere else too.
  if (convo.type === 'channel' && convo.channel?.notifyMembers === false) return false;
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

// How many unread messages in each conversation are addressed to THIS user.
//
// The dot and the number answer two different questions, deliberately:
//
//   dot    — "something happened in Community"
//   number — "N messages are waiting for you specifically"
//
// So a busy channel you are not part of never inflates the number. Only three
// things count: a message that @mentions you, a message that replies to one of
// yours, and any message in a one-to-one thread (a DM or your support thread),
// where every message is by definition addressed to you.
//
// Returns a Map of conversation id → count, with conversations at zero left
// out. One aggregation for the whole set: the per-conversation read cutoffs go
// into the $match as an $or of clauses rather than a query per row.
async function personalUnreadCounts(user, convos, reads) {
  const clauses = [];
  for (const c of convos) {
    if (!c.messageCount) continue;
    // A channel the admin has silenced does not badge, dot or number.
    if (c.type === 'channel' && c.channel?.notifyMembers === false) continue;
    const readRow = reads.get(String(c._id));
    clauses.push({
      conversationId: c._id,
      ...(readRow ? { createdAt: { $gt: readRow.lastReadAt } } : {}),
      // In a channel, only what names you. In a DM or support thread the whole
      // conversation is addressed to you, so every message counts.
      ...(c.type === 'channel'
        ? { $or: [{ mentions: user._id }, { 'replyTo.userId': user._id }] }
        : {}),
    });
  }
  if (!clauses.length) return new Map();

  const rows = await ChatMessage.aggregate([
    { $match: {
      deletedAt: null,
      // Your own messages, and the "Admin closed this chat" system lines, are
      // not things waiting to be read.
      senderRole:   { $ne: 'system' },
      senderUserId: { $ne: user._id },
      $or: clauses,
    } },
    { $group: { _id: '$conversationId', count: { $sum: 1 } } },
  ]);
  return new Map(rows.map(r => [String(r._id), r.count]));
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
function serializeMessage(m, { viewerIsAdmin, conversationType, viewerId }) {
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
    // Shown to everyone, not just admins: a moderator quietly rewriting what
    // someone said and leaving no mark would be worse than leaving it alone.
    // The pre-edit text goes only to admins — it is the moderation record.
    edited:            Boolean(m.editedAt),
    editedAt:          m.editedAt ?? null,
    ...(viewerIsAdmin ? { originalBody: m.originalBody ?? null } : {}),
    createdAt:         m.createdAt,
    // Ids only. The client already has every sender's profile in `senders`, and
    // the highlight is driven by matching the literal "@Name" text in the body,
    // so all this has to answer is "was I one of them".
    mentions:          (m.mentions ?? []).map(id => String(id)),
    reactions:         (m.reactions ?? [])
      .filter(r => (r.userIds ?? []).length)
      .map(r => ({
        emoji: r.emoji,
        count: (r.userIds ?? []).length,
        mine:  (r.userIds ?? []).some(id => String(id) === String(viewerId)),
      })),
    replyTo:           m.replyTo?.messageId ? {
      messageId:   m.replyTo.messageId,
      displayName: m.replyTo.displayName ?? null,
      excerpt:     m.replyTo.excerpt ?? null,
    } : null,
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
// In a support thread every admin reply presents as one "SkyWatch Support"
// identity, so admins are omitted here — their personal badge is not the
// support team's face, and exposing it would leak which staff member replied.
async function senderProfiles(messages, { conversationType, viewerIsAdmin }) {
  const collapseAdmins = conversationType === 'support' && !viewerIsAdmin;

  const ids = [...new Set([
    ...messages
      .filter(m => m.senderUserId && m.senderRole !== 'system')
      .filter(m => !(collapseAdmins && m.senderRole === 'admin'))
      .map(m => String(m.senderUserId)),
    // Mentioned users too, even if they have never posted here. The client
    // renders an @mention by matching the mentioned person's display name
    // against the body, so without their name in this map the highlight would
    // silently not happen for anyone who has not spoken in the thread.
    ...messages.flatMap(m => (m.mentions ?? []).map(String)),
  ])];
  if (!ids.length) return {};

  const users = await User.find({ _id: { $in: ids } })
    .select('displayName agentNumber selectedBadgeBriefId rank isBot botKey cbatPassed')
    .populate('rank', 'rankNumber rankAbbreviation')
    .lean();

  const [badges, medals] = await Promise.all([
    resolveSelectedBadges(users.map(u => u.selectedBadgeBriefId)),
    // Podium places on the CBAT boards, hung off the avatar in chat. Resolved
    // for the whole thread in one cached sweep — see utils/cbatMedalHolders.js.
    medalsForUsers(users.map(u => u._id)),
  ]);

  const out = {};
  for (const u of users) {
    out[String(u._id)] = {
      _id:           u._id,
      displayName:   u.displayName ?? null,
      agentNumber:   u.agentNumber ?? null,
      // Shape matches what <ProfileBadge> expects, so the chat avatar renders
      // through exactly the same precedence as everywhere else in the app:
      // bot mark → cutout → rank badge → rank abbreviation.
      selectedBadge: badges.get(String(u.selectedBadgeBriefId)) ?? null,
      rank:          u.rank ?? null,
      isBot:         Boolean(u.isBot),
      // Drives the "Passed" mark beside the name. Chat is signed-in only, so
      // there is no logged-out case to withhold it from here.
      cbatPassed:    Boolean(u.cbatPassed),
      // Picks which bot avatar to draw. A bot has no rank and no aircraft
      // badge, so without this it would fall all the way through to the "AC"
      // text every unranked account shows.
      botKey:        u.botKey ?? null,
      medals:        medals[String(u._id)] ?? [],
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
    const reads = await readMap(req.user._id, ids);
    const [personal, previews, dmUsers, guides] = await Promise.all([
      // Same helper the navbar count uses, so the rail explains the number
      // rather than merely agreeing with it.
      personalUnreadCounts(req.user, convos, reads),
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
      // Off-site reading, curated by the team. Same call as everything else in
      // the rail so the section costs no extra round trip.
      ChatGuide.find({ isHidden: false }).sort({ order: 1, title: 1 }).lean(),
    ]);

    const decorate = (c) => {
      const preview = previews.get(String(c._id));
      return {
        _id:           c._id,
        type:          c.type,
        lastMessageAt: c.lastMessageAt,
        messageCount:  c.messageCount ?? 0,
        unread:        isUnread(c, reads.get(String(c._id))),
        // Unread messages in here that name this user. Zero in a channel you
        // are simply behind on.
        personalUnread: personal.get(String(c._id)) ?? 0,
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
        postPolicy:  c.channel?.postPolicy ?? 'everyone',
        // Derived, never stored: "not everyone can post here".
        adminOnly:   (c.channel?.postPolicy ?? 'everyone') !== 'everyone',
        notifyMembers: c.channel?.notifyMembers !== false,
      }))
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

    // Bots are admin-only for now, and a bot you have never messaged has no
    // conversation to list — so they are advertised separately from `dms`,
    // with the thread id when one exists and null when it does not. The client
    // opens the id or calls POST /dm to create it.
    let bots = [];
    if (req.user.isAdmin) {
      // Only bots you can actually talk to. A poster like the medal bot has no
      // conversational role, so listing it as a DM target would promise a
      // reply it has no way to give.
      const botUsers = await User.find({
        isBot: true, isBanned: { $ne: true }, botAnswersDms: true,
      }).select('displayName agentNumber botDescription botKey').lean();
      bots = botUsers.map(b => {
        const thread = convos.find(c => String(c.botUserId) === String(b._id));
        return {
          userId:         b._id,
          botKey:         b.botKey ?? null,
          title:          b.displayName || 'Bot',
          description:    b.botDescription || null,
          conversationId: thread?._id ?? null,
          unread:         thread ? isUnread(thread, reads.get(String(thread._id))) : false,
          personalUnread: thread ? (personal.get(String(thread._id)) ?? 0) : 0,
          lastMessageAt:  thread?.lastMessageAt ?? null,
        };
      });
    }

    res.json({ status: 'success', data: {
      support: supportConvo
        ? { ...decorate(supportConvo), title: SUPPORT_LABEL, status: supportConvo.status }
        : null,
      guides: guides.map(g => ({
        _id:         g._id,
        title:       g.title,
        url:         g.url,
        description: g.description ?? '',
        emoji:       g.emoji ?? null,
      })),
      channels,
      // A bot DM is listed under `bots`, not here — it is a tool, not a person
      // you are talking to, and mixing them would bury real conversations.
      dms: dms.filter(d => !convos.find(c => String(c._id) === String(d._id))?.botUserId),
      bots,
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

// GET /api/chat/lounge — everything the mini chat on the CBAT hub needs to
// start, in one request: which conversation it is, whether this user may post
// in it, and whether there is anything new since they last looked.
//
// A named endpoint rather than the widget hunting for the slug in /overview:
// the widget wants one small answer, and /overview is the whole rail.
router.get('/lounge', async (req, res) => {
  try {
    const convo = await ChatConversation.findOne({
      type: 'channel', 'channel.slug': LOUNGE_SLUG, isArchived: false,
    });
    // Archived or deleted by an admin. Not an error — the widget simply does
    // not render, and the CBAT hub carries on without it.
    if (!convo) return res.status(404).json({ status: 'error', message: 'The lounge is not available.' });

    const [readRow, bot] = await Promise.all([
      ChatRead.findOne({ userId: req.user._id, conversationId: convo._id }).lean(),
      User.findOne({ isBot: true, botAnswersDms: true, isBanned: { $ne: true } })
        .select('displayName').lean(),
    ]);

    // The widget's own dot, computed here rather than read off isUnread():
    // this channel is muted for the Community badge on purpose (see
    // seeds/seedCbatLounge.js), and isUnread() honours that. The panel's own
    // dot is a different signal and must ignore it.
    const unread = Boolean(convo.messageCount)
      && (!readRow || new Date(readRow.lastReadAt) < new Date(convo.lastMessageAt));

    const refusal = postRefusal(convo, req.user);
    const code = refusal?.body?.code ?? null;

    res.json({ status: 'success', data: {
      conversationId:      convo._id,
      title:               channelTitle(convo),
      unread,
      lastMessageAt:       convo.lastMessageAt,
      canPost:             !refusal,
      displayNameRequired: code === 'DISPLAY_NAME_REQUIRED',
      chatBanned:          code === 'CHAT_BANNED',
      postBlockedMessage:  refusal && !code ? refusal.body.message : null,
      botName:             bot?.displayName ?? null,
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
      .select('displayName agentNumber isAdmin isBanned isBot botKey cbatPassed').lean();
    if (!target || target.isBanned) return res.status(404).json({ message: 'User not found' });

    res.json({ status: 'success', data: { user: {
      _id:         target._id,
      displayName: target.displayName ?? null,
      agentNumber: target.agentNumber ?? null,
      isAdmin:     Boolean(target.isAdmin),
      isBot:       Boolean(target.isBot),
      cbatPassed:  Boolean(target.cbatPassed),
      botKey:      target.botKey ?? null,
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

    const target = await User.findById(userId)
      .select('_id isBanned isBot botAnswersDms').lean();
    if (!target || target.isBanned) return res.status(404).json({ message: 'User not found' });

    // Bots are admin-only for now. Enforced here AND in postRefusal: this stops
    // the thread being created, that stops anyone posting into one that already
    // exists (or was created while they were still an admin).
    if (target.isBot && !req.user.isAdmin) {
      return res.status(403).json({ message: 'That agent is not accepting direct messages.' });
    }
    // A poster bot has nothing to say back, so a thread with one would just sit
    // there unanswered.
    if (target.isBot && !target.botAnswersDms) {
      return res.status(400).json({ message: 'That bot posts to a channel and does not take messages.' });
    }

    const participantKey = ChatConversation.dmKey(req.user._id, userId);
    let convo = await ChatConversation.findOne({ type: 'dm', participantKey });
    if (!convo) {
      // Same ordering as ChatConversation.dmKey, so participantIds and
      // participantKey can never disagree about which id comes first.
      const participantIds = [req.user._id, target._id]
        .map(String).sort().map(id => new mongoose.Types.ObjectId(id));
      try {
        convo = await ChatConversation.create({
          type: 'dm',
          participantIds,
          participantKey,
          botUserId: target.isBot ? target._id : null,
        });
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
    const personal = await personalUnreadCounts(req.user, convos, reads);
    const personalUnread = [...personal.values()].reduce((a, b) => a + b, 0);

    // Opted out of the Community dot. Zeroed here rather than left to the
    // client so the badge cannot come back through any other caller, and so a
    // stale frontend can't keep showing it.
    const muted = req.user.communityNotificationsEnabled === false;

    res.json({ status: 'success', data: {
      hasAnyOpenChat,
      hasUnread:   !muted && unread.length > 0,
      totalUnread: muted ? 0 : unread.length,
      // What the navbar puts a NUMBER on: messages aimed at this user. Channel
      // chatter is left to `hasUnread` and its quiet dot — see
      // personalUnreadCounts for why the two are separated.
      personalUnread: muted ? 0 : personalUnread,
      muted,
    } });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// ── Live stream ──────────────────────────────────────────────────────────────

// How often to write a comment line down an idle stream. Proxies and load
// balancers close connections that say nothing; 25s is comfortably inside the
// usual 30-60s idle timeouts, and a comment is two bytes of nothing.
const STREAM_HEARTBEAT_MS = 25_000;

// GET /api/chat/conversations/:id/stream — server-sent events for one
// conversation. Read access is the same gate as the messages themselves.
//
// Push, not polling, because the CBAT lounge is meant to read as a room with
// people in it. See utils/chatStream.js for why SSE rather than websockets, and
// for the single-instance caveat.
router.get('/conversations/:id/stream', async (req, res) => {
  try {
    if (!isValidId(req.params.id)) return res.status(404).json({ message: 'Conversation not found' });

    const convo = await ChatConversation.findById(req.params.id).lean();
    if (!convo) return res.status(404).json({ message: 'Conversation not found' });
    if (!canRead(convo, req.user)) return res.status(403).json({ message: 'Forbidden' });

    // No socket timeout: this response is meant to stay open.
    res.setTimeout?.(0);
    res.writeHead(200, {
      'Content-Type':      'text/event-stream',
      // no-transform matters as much as no-cache: a proxy that "helpfully"
      // buffers or gzips the body would hold every event until it closed.
      'Cache-Control':     'no-cache, no-transform',
      Connection:          'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    res.write(': open\n\n');

    const send = (event, data) => {
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    };

    const unsubscribe = chatStream.subscribe(convo._id, {
      userId: req.user._id,
      send,
      close: () => res.end(),
    });

    // Every slot taken. Tell the client rather than dropping it silently, so it
    // can fall back to polling instead of sitting on a stream that never
    // delivers anything.
    if (!unsubscribe) {
      send('unavailable', { reason: 'too-many-connections' });
      return res.end();
    }

    send('ready', { conversationId: String(convo._id) });

    const heartbeat = setInterval(() => {
      try { res.write(': ping\n\n'); } catch { /* closing */ }
    }, STREAM_HEARTBEAT_MS);
    heartbeat.unref?.();

    const stop = () => { clearInterval(heartbeat); unsubscribe(); };
    req.on('close', stop);
    req.on('error', stop);
  } catch (err) {
    // Headers may already be out, in which case there is nothing to say but
    // goodbye — the client's EventSource will reconnect on its own.
    if (res.headersSent) res.end();
    else res.status(500).json({ message: err.message });
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

    // Read state as it was BEFORE this visit. The client marks the
    // conversation read in a separate call once it has rendered, so this still
    // describes where the viewer got to last time — which is exactly what the
    // "new messages" divider and the mention jump need.
    const [senders, readRow] = await Promise.all([
      senderProfiles(items, {
        conversationType: convo.type,
        viewerIsAdmin:    Boolean(req.user.isAdmin),
      }),
      ChatRead.findOne({ userId: req.user._id, conversationId: convo._id }).lean(),
    ]);

    // The oldest message since then that mentions the viewer. Answered by a
    // query rather than by scanning `items`, because the mention may well be
    // older than the 50 messages on screen — which is the entire reason the
    // client offers to scroll up to it.
    const mentionFilter = {
      conversationId: convo._id,
      mentions:       req.user._id,
      deletedAt:      null,
      ...(readRow ? { createdAt: { $gt: readRow.lastReadAt } } : {}),
    };
    const [firstMention, unreadMentions, dmTitle] = await Promise.all([
      ChatMessage.findOne(mentionFilter).sort({ createdAt: 1 }).select('_id createdAt').lean(),
      ChatMessage.countDocuments(mentionFilter),
      // Name the other person, because the rail cannot always do it: the
      // overview hides DMs with no messages, so a thread opened from the admin
      // search would sit under a header reading "Chat" until the first reply.
      (async () => {
        if (convo.type !== 'dm') return null;
        const otherId = (convo.participantIds ?? [])
          .find(id => String(id) !== String(req.user._id));
        if (!otherId) return null;
        const other = await User.findById(otherId).select('displayName agentNumber').lean();
        if (!other) return null;
        return other.displayName
          || (other.agentNumber ? `Agent #${other.agentNumber}` : null);
      })(),
    ]);

    res.json({ status: 'success', data: {
      messages: items.map(m => serializeMessage(m, {
        viewerIsAdmin:    Boolean(req.user.isAdmin),
        conversationType: convo.type,
        viewerId:         req.user._id,
      })),
      senders,
      hasMore,
      // Where this viewer got up to last time, and whether anything since then
      // was addressed to them. Null lastReadAt means "never opened", which
      // draws no divider — a first visit is not a pile of unread messages.
      // Drives "Guide Bot is typing…". Picked up by the 5s poll, so it can lag
      // by a poll — the sender's own client shows it immediately from
      // botWillReply on the send response instead.
      botTyping:           botTypingName(convo._id),
      lastReadAt:          readRow?.lastReadAt ?? null,
      unreadMentionCount:  unreadMentions,
      firstUnreadMention:  firstMention
        ? { _id: firstMention._id, createdAt: firstMention.createdAt }
        : null,
      conversation: {
        _id:        convo._id,
        type:       convo.type,
        status:     convo.status,
        isArchived: convo.isArchived,
        postPolicy: convo.channel?.postPolicy ?? 'everyone',
        adminOnly:  (convo.channel?.postPolicy ?? 'everyone') !== 'everyone',
        title:      convo.type === 'channel' ? channelTitle(convo) : dmTitle,
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

    // Reply target. Snapshotted at send time rather than joined on read, so the
    // quote survives the parent being deleted or scrolled out of the page.
    let replyTo = null;
    const replyToId = req.body?.replyToId;
    if (replyToId && isValidId(replyToId)) {
      const parent = await ChatMessage.findOne({
        _id: replyToId, conversationId: convo._id, deletedAt: null,
      }).select('senderDisplayName senderRole senderUserId body').lean();
      if (parent) {
        replyTo = {
          messageId:   parent._id,
          displayName: convo.type === 'support' && parent.senderRole === 'admin'
            ? SUPPORT_LABEL
            : parent.senderDisplayName,
          excerpt: (parent.body ?? '').slice(0, 160),
          // Never shown — this is what makes the reply countable for the person
          // being replied to. See the note on the field in ChatMessage.
          userId:  parent.senderUserId ?? null,
        };
      }
    }

    // Resolved from the body rather than trusted from the client — typing a
    // name by hand and picking it from the autocomplete are the same thing.
    // Support threads are excluded: there is nobody to mention in a private
    // thread with staff, and the bot has no business in one.
    const mentioned = convo.type === 'support'
      ? []
      : await resolveMentions(body, { findUsers: findMentionableByName });

    const message = await appendMessage({
      conversation:      convo,
      senderUserId:      req.user._id,
      senderRole,
      body,
      senderDisplayName: req.user.displayName ?? null,
      replyTo,
      mentions:          mentioned.map(u => u._id),
    });

    // In a channel the bot speaks only when @mentioned — never on its own, and
    // never in a thread it was not addressed in. A bot that mentions itself
    // cannot start a loop for the same reason.
    const mentionedBot = mentioned.find(u => u.isBot && u.botAnswersDms);
    const dmBotReplying = Boolean(convo.botUserId)
      && String(convo.botUserId) !== String(req.user._id);
    const channelBotReplying = convo.type === 'channel' && Boolean(mentionedBot) && !req.user.isBot;

    // The name is wanted before the response goes out so the sender's typing
    // indicator can say who. In a channel it is already resolved; in a bot DM
    // it costs one indexed lookup, and only on a bot DM.
    let botReplyingName = null;
    if (channelBotReplying) botReplyingName = mentionedBot.displayName ?? null;
    else if (dmBotReplying) {
      botReplyingName = (await User.findById(convo.botUserId).select('displayName').lean())
        ?.displayName ?? null;
    }

    res.json({ status: 'success', data: {
      message: serializeMessage(message.toObject(), {
        viewerIsAdmin:    Boolean(req.user.isAdmin),
        conversationType: convo.type,
        viewerId:         req.user._id,
      }),
      // So the sender sees "Guide Bot is typing…" the instant they hit send,
      // rather than up to a poll later. It names a bot that has been ASKED,
      // not one that will definitely answer — screening may still decide to
      // ignore this one, and the next poll is what takes the indicator down.
      botReplyingName,
    } });

    // Answer AFTER responding, never before: a model call takes seconds, and
    // making the sender wait for it would leave their own message hanging in
    // the composer. The client's 5s poll picks the reply up.
    if (dmBotReplying) {
      replyAsBot(convo, botReplyingName).catch(err => {
        console.error('[chat] bot reply failed:', err?.message);
      });
    }

    if (channelBotReplying) {
      replyAsBotInChannel(convo, message, mentionedBot, req.user).catch(err => {
        console.error('[chat] channel bot reply failed:', err?.message);
      });
    }
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// What the bot answers from, for one question.
//
// Re-rendered from the stored `sections` rather than served from the stored
// `corpus` string. Both are saved at upload time, but the corpus is a SNAPSHOT
// of how renderGuideCorpus worked that day — so improving the renderer would do
// nothing at all until somebody happened to re-upload the guide. That is a
// silent failure: the bot keeps giving the old answer and the change looks
// broken. Rendering on read is a few string joins next to a model call.
//
// Rendering per question is also what makes retrieval possible. The whole guide
// is ~15,000 tokens and was going out on every question — about $0.015 of input
// per reply, ~95% of the measured $0.0168 cost, to answer something about one
// test. selectGuideSlice picks the sections the question actually needs; across
// a realistic mix that is ~39% of the tokens.
//
// Falls back to the stored string for a document uploaded before sections were
// kept.
async function loadBotCorpus(question) {
  const doc = await BotKnowledge.findOne({ slug: BOT_KNOWLEDGE_SLUG })
    .select('corpus sections').lean();
  if (!doc) return '';
  if (doc.sections && (doc.sections.TESTS ?? []).length) {
    try {
      const { tests, full } = selectGuideSlice(doc.sections, question);
      return renderGuideCorpus(doc.sections, { tests: full ? null : tests });
    } catch {
      // A malformed sections blob must not silence the bot entirely.
      return doc.corpus ?? '';
    }
  }
  return doc.corpus ?? '';
}

// Who an "@name" may resolve to. Bots are included (that is how Guide Bot gets
// addressed); banned accounts are not, so a removed user's name stops pinging.
function findMentionableByName(lowerNames) {
  return User.find({
    displayNameLower: { $in: lowerNames },
    isBanned: { $ne: true },
  }).select('displayName displayNameLower isBot botAnswersDms').lean();
}

// ── Guide bot in a channel ───────────────────────────────────────────────────
//
// Budgets, enforced before the model is called. A channel bot is a shared,
// paid-for resource sitting in a room full of strangers, so the question is not
// "is this person allowed to ask" but "how much can any one person spend".
//
// In-process, like the send rate limiter above, and for the same reason: this
// guards against a person holding down Enter on a single-instance backend, not
// against a distributed attacker. Revisit if the backend is ever scaled out.
const BOT_USER_MAX      = 5;            // answers per user...
const BOT_USER_WINDOW   = 10 * 60_000;  // ...per 10 minutes
const BOT_CHANNEL_GAP   = 10_000;       // minimum quiet time between answers
const botUserHits    = new Map();       // userId  -> number[]
const botChannelLast = new Map();       // convoId -> timestamp

// How much of the conversation the bot is shown in a channel. Enough for a
// follow-up ("and how long does that last?") to make sense, short enough that
// it cannot be filled with someone else's agenda.
const CHANNEL_HISTORY_TURNS = 6;
const DM_HISTORY_TURNS = 12;

// ...and how far back that reaches. A conversation is a session: someone who
// asked about FLAG this morning and comes back tonight with an unrelated
// question is starting again, not continuing. Replaying the morning makes the
// bot answer as though they were connected, and pays input tokens for the
// privilege. Counted from now rather than from the last message, so a thread
// that has gone quiet goes cold on its own.
const HISTORY_WINDOW_MS = 30 * 60_000;

const historySince = () => new Date(Date.now() - HISTORY_WINDOW_MS);

// ── "Guide Bot is typing…" ───────────────────────────────────────────────────
//
// A model call takes seconds. Without this the channel just sits there and it
// is impossible to tell whether the bot is thinking or has decided to ignore
// you — and since ignoring you IS a real outcome here, that ambiguity matters
// more than it would elsewhere.
//
// In-process and expiring, like the rate limiters: a flag that outlived the
// process would leave a bot permanently "typing" after a restart. The expiry
// is the backstop for a generation that dies without running its finally.
const BOT_TYPING_TTL = 60_000;
const botTyping = new Map();            // convoId -> { name, expiresAt }

// Pushed as well as stored: a poller picks the flag up on its next tick, but a
// panel holding a live stream should see "Guide Bot is typing…" the moment the
// generation starts, including for the people who did not ask.
const markBotTyping  = (id, name) => {
  botTyping.set(String(id), { name: name || 'Guide Bot', expiresAt: Date.now() + BOT_TYPING_TTL });
  chatStream.publish(id, 'typing', { name: name || 'Guide Bot' });
};
const clearBotTyping = (id) => {
  botTyping.delete(String(id));
  chatStream.publish(id, 'typing', { name: null });
};
// Returns the NAME of the bot composing a reply, or null. The name rather than
// a boolean so the indicator can say which bot, without the client having to
// guess or hardcode one.
const botTypingName  = (id) => {
  const row = botTyping.get(String(id));
  return row && row.expiresAt > Date.now() ? row.name : null;
};

function botBudgetRefusal(userId, conversationId) {
  const now = Date.now();

  const last = botChannelLast.get(String(conversationId)) ?? 0;
  if (now - last < BOT_CHANNEL_GAP) return 'channel-cooldown';

  const key = String(userId);
  const recent = (botUserHits.get(key) ?? []).filter(t => now - t < BOT_USER_WINDOW);
  if (recent.length >= BOT_USER_MAX) {
    botUserHits.set(key, recent);
    return 'user-quota';
  }

  recent.push(now);
  botUserHits.set(key, recent);
  botChannelLast.set(String(conversationId), now);
  return null;
}

// Keep both maps from growing without bound on a long-lived process.
setInterval(() => {
  const now = Date.now();
  for (const [key, times] of botUserHits) {
    const live = times.filter(t => now - t < BOT_USER_WINDOW);
    if (live.length) botUserHits.set(key, live); else botUserHits.delete(key);
  }
  for (const [key, at] of botChannelLast) {
    if (now - at > BOT_USER_WINDOW) botChannelLast.delete(key);
  }
  for (const [key, expires] of botTyping) {
    if (expires.expiresAt < now) botTyping.delete(key);
  }
}, BOT_USER_WINDOW).unref?.();

// Answer an @mention in a channel.
//
// Every rejection path here is SILENT — no message, no refusal, no tombstone.
// See the note at the top of utils/chatBot.js: in a public room a refusal
// confirms the attack landed and hands anyone a way to fill the channel with
// bot messages. Screening runs before the API call, so silence is also free.
async function replyAsBotInChannel(convo, triggerMessage, bot, asker) {
  const question = stripMention(triggerMessage.body, bot.displayName);

  const screen = screenChannelMention(question);
  if (!screen.ok) return null;

  if (botBudgetRefusal(asker._id, convo._id)) return null;

  // The day's ceiling. Silent in a channel like every other refusal here —
  // announcing "I have hit my spending limit" to a public room is an invitation
  // to check whether it is true.
  if (await overDailyBudget()) return null;

  const key = String(convo._id);
  if (botReplyInFlight.has(key)) return null;
  botReplyInFlight.add(key);
  markBotTyping(convo._id, bot.displayName);
  try {
    const [freshBot, knowledge, recent, otherBots] = await Promise.all([
      User.findById(bot._id).select('displayName botAnswersDms isBanned').lean(),
      loadBotCorpus(question),
      ChatMessage.find({
        conversationId: convo._id,
        _id:            { $ne: triggerMessage._id },
        deletedAt:      null,
        senderRole:     { $ne: 'system' },
        createdAt:      { $gte: historySince() },
      }).sort({ createdAt: -1 }).limit(CHANNEL_HISTORY_TURNS).lean(),
      User.find({ isBot: true }).select('_id').lean(),
    ]);
    if (!freshBot || freshBot.isBanned || !freshBot.botAnswersDms) return null;

    const botIds = new Set(otherBots.map(b => String(b._id)));

    // Recent channel traffic, so a follow-up like "and how long does it last?"
    // has something to attach to.
    //
    // A channel is not a DM, though: everything here was written by people who
    // are not the one asking. Two rules make that safe enough to use.
    //   • Anything hostile is DROPPED rather than passed through, so a
    //     bystander cannot plant an instruction for someone else's question to
    //     pick up. The <message> wrapper would already mark it as data; this
    //     means the model never sees it at all.
    //   • Speakers are named inside the wrapper, so the bot can tell whose
    //     question it is answering rather than reading the room as one voice.
    const history = recent
      .reverse()
      .filter(m => !looksHostile(m.body))
      // Other bots' output is not conversation — the medals feed would just be
      // noise in the context window.
      .filter(m => String(m.senderUserId ?? '') === String(freshBot._id)
        || !botIds.has(String(m.senderUserId)))
      .map(m => ({
        fromBot: String(m.senderUserId ?? '') === String(freshBot._id),
        body:    `${m.senderDisplayName || 'Someone'}: ${(m.body ?? '').slice(0, 400)}`,
      }));

    const { text, costUsd } = await generateBotReply({
      question,
      corpus:  knowledge,
      history,
      // Channel mode: a refusal becomes null and nothing is posted.
      silent:  true,
      // The lounge is a ten-line panel on the CBAT hub, not a full-height
      // thread. The bot answers in a sentence there and points at the General
      // channel for anything longer.
      brief:   convo.channel?.slug === LOUNGE_SLUG,
    });
    noteBotSpend(costUsd);
    if (!text) return null;

    const fresh = await ChatConversation.findById(convo._id);
    if (!fresh || fresh.isArchived) return null;

    return appendMessage({
      conversation:      fresh,
      senderUserId:      freshBot._id,
      senderRole:        'user',
      body:              text,
      senderDisplayName: freshBot.displayName ?? 'Guide Bot',
      // Quote the question, so an answer arriving after other messages is not
      // left floating with no visible subject.
      replyTo: {
        messageId:   triggerMessage._id,
        displayName: triggerMessage.senderDisplayName ?? null,
        excerpt:     (triggerMessage.body ?? '').slice(0, 160),
        userId:      triggerMessage.senderUserId ?? null,
      },
    });
  } finally {
    botReplyInFlight.delete(key);
    clearBotTyping(convo._id);
  }
}

// Generate and post the bot's answer to the latest message in a bot DM.
//
// Never throws into the request path — it runs detached, so a failure has to
// surface as a visible message in the thread rather than a silent nothing.
// One reply at a time per conversation, so a burst of messages cannot start
// several overlapping generations.
const botReplyInFlight = new Set();

async function replyAsBot(convo, botName) {
  const key = String(convo._id);
  if (botReplyInFlight.has(key)) return;
  botReplyInFlight.add(key);
  markBotTyping(convo._id, botName);
  try {
    const [bot, recent] = await Promise.all([
      User.findById(convo.botUserId).select('displayName botAnswersDms').lean(),
      ChatMessage.find({
        conversationId: convo._id,
        deletedAt:      null,
        // The message being answered is the newest, so it is always inside the
        // window — this only ever trims context, never the question.
        createdAt:      { $gte: historySince() },
      }).sort({ createdAt: -1 }).limit(DM_HISTORY_TURNS).lean(),
    ]);
    // Belt and braces alongside the POST /dm gate: a thread that predates the
    // flag must not start answering.
    if (!bot || !bot.botAnswersDms) return;

    const ordered = recent.reverse();
    const question = ordered[ordered.length - 1]?.body ?? '';
    const history  = ordered.slice(0, -1).map(m => ({
      fromBot: String(m.senderUserId) === String(convo.botUserId),
      body:    m.body,
    }));

    // Sequential rather than alongside the fetch above: which slice of the
    // guide to load depends on the question, and the question comes out of
    // that fetch. One extra round trip is nothing next to the model call.
    const knowledge = await loadBotCorpus(question);

    // In a DM the ceiling is spoken rather than silent: bot DMs are admin-only,
    // and an admin needs to tell "switched off for the day" from "broken".
    if (await overDailyBudget()) {
      const fresh = await ChatConversation.findById(convo._id);
      if (!fresh) return;
      await appendMessage({
        conversation:      fresh,
        senderUserId:      convo.botUserId,
        senderRole:        'user',
        body:              REFUSALS.budget,
        senderDisplayName: bot.displayName ?? 'Guide Bot',
      });
      return;
    }

    const { text, costUsd } = await generateBotReply({
      question,
      corpus: knowledge,
      history,
    });
    noteBotSpend(costUsd);

    const fresh = await ChatConversation.findById(convo._id);
    if (!fresh) return;
    await appendMessage({
      conversation:      fresh,
      senderUserId:      convo.botUserId,
      senderRole:        'user',
      body:              text,
      senderDisplayName: bot.displayName ?? 'Guide Bot',
    });
  } finally {
    botReplyInFlight.delete(key);
    clearBotTyping(convo._id);
  }
}

// ── Admin: bot knowledge ─────────────────────────────────────────────────────

// GET /api/chat/admin/bot/knowledge — what the bot currently answers from
router.get('/admin/bot/knowledge', adminOnly, async (req, res) => {
  try {
    const doc = await BotKnowledge.findOne({ slug: BOT_KNOWLEDGE_SLUG })
      .select('-sections -corpus')
      .populate('uploadedByUserId', 'email displayName')
      .lean();
    res.json({ status: 'success', data: { knowledge: doc ?? null } });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// PUT /api/chat/admin/bot/knowledge { filename, text }
//
// The guide lives in a gitignored folder outside backend/, so it can never be
// on Railway's filesystem. Uploading it into Mongo is what makes the bot work
// in production at all — and it means refreshing the guide needs no deploy.
//
// Takes either the public guide HTML or the minified corpus .txt built from it
// (scripts/buildGuideCorpus.js). Both end up as the same `sections`, so the
// choice of file changes nothing about how the bot answers — in particular the
// .txt does NOT bypass retrieval, which is the trap parseGuideUpload avoids.
//
// `html` is still accepted as the body key so an older client keeps working.
router.put('/admin/bot/knowledge', adminOnly, async (req, res) => {
  try {
    const text = (req.body?.text ?? req.body?.html ?? '').toString();
    if (!text.trim()) return res.status(400).json({ message: 'No file contents received' });
    if (text.length > 5_000_000) return res.status(413).json({ message: 'That file is too large' });

    let parsed;
    try {
      parsed = parseGuideUpload(text);
    } catch (err) {
      return res.status(422).json({ message: err.message });
    }

    const corpus = renderGuideCorpus(parsed.sections);
    const tests  = (parsed.sections.TESTS ?? []).length;
    const facts  = (parsed.sections.TESTS ?? [])
      .reduce((sum, t) => sum + (t?.facts?.length ?? 0), 0);

    const doc = await BotKnowledge.findOneAndUpdate(
      { slug: BOT_KNOWLEDGE_SLUG },
      {
        $set: {
          title:            'CBAT community guide',
          corpus,
          sections:         parsed.sections,
          sourceFilename:   (req.body?.filename ?? '').toString().slice(0, 200) || null,
          sourceBytes:      text.length,
          uploadedByUserId: req.user._id,
          stats: {
            tests,
            facts,
            corpusChars:     corpus.length,
            sectionsFound:   parsed.found,
            sectionsMissing: parsed.missing,
          },
        },
      },
      { upsert: true, returnDocument: 'after' },
    );

    await AdminAction.create({
      userId:     req.user._id,
      actionType: 'chat_bot_knowledge_upload',
      reason:     `Uploaded the chat bot guide (${tests} tests, ${facts} facts)`,
    });

    res.json({ status: 'success', data: { knowledge: {
      slug: doc.slug, title: doc.title, stats: doc.stats,
      sourceFilename: doc.sourceFilename, updatedAt: doc.updatedAt,
    } } });
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

// GET /api/chat/conversations/:id/mention-suggestions?q= — the @ autocomplete.
//
// With no query it offers the bots and nobody else: "@" on its own is almost
// always someone reaching for Guide Bot, and a list of arbitrary strangers is
// not a useful default. Typing then searches real agents.
//
// Only accounts with a DISPLAY NAME are ever offered. An agent number is an
// account identifier, not a name someone chose to be known by, and putting
// "Agent #1234567" in an autocomplete would turn the picker into a directory
// of everyone who has ever signed up.
const MENTION_SUGGESTION_LIMIT = 8;

// Higher than the mention picker's: that one drops into a composer mid-sentence
// and wants one obvious answer, whereas the admin search is a directory you
// scroll to find the right "Alex".
const ADMIN_USER_SEARCH_LIMIT = 20;

router.get('/conversations/:id/mention-suggestions', async (req, res) => {
  try {
    if (!isValidId(req.params.id)) return res.status(404).json({ message: 'Conversation not found' });

    const convo = await ChatConversation.findById(req.params.id);
    if (!convo) return res.status(404).json({ message: 'Conversation not found' });
    if (!canRead(convo, req.user)) return res.status(403).json({ message: 'Forbidden' });

    const q = (req.query.q ?? '').toString().trim().slice(0, 20);

    // Bots that answer are always offered, and always first: the bot is the
    // reason most people type "@" at all.
    const bots = await User.find({
      isBot: true, botAnswersDms: true, isBanned: { $ne: true },
      displayName: { $ne: null },
      ...(q ? { displayNameLower: { $regex: `^${escapeRegex(q.toLowerCase())}` } } : {}),
    }).select('displayName agentNumber isBot botDescription').lean();

    let people = [];
    if (q) {
      people = await User.find({
        isBot: { $ne: true },
        isBanned: { $ne: true },
        chatBannedAt: null,
        displayNameLower: { $regex: `^${escapeRegex(q.toLowerCase())}` },
        _id: { $ne: req.user._id },
      })
        .select('displayName agentNumber isAdmin')
        .sort({ displayNameLower: 1 })
        .limit(MENTION_SUGGESTION_LIMIT)
        .lean();
    }

    res.json({ status: 'success', data: {
      suggestions: [...bots, ...people]
        .slice(0, MENTION_SUGGESTION_LIMIT)
        .map(u => ({
          _id:         u._id,
          displayName: u.displayName,
          isBot:       Boolean(u.isBot),
          isAdmin:     Boolean(u.isAdmin),
          description: u.botDescription ?? null,
        })),
    } });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Prefix search runs the query string into a regex, so it has to be neutralised
// first — otherwise typing "(" is a crash and ".*" is a full table scan.
function escapeRegex(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// GET /api/chat/reactions — the emoji a client may offer
router.get('/reactions', (req, res) => {
  res.json({ status: 'success', data: { emoji: REACTION_EMOJI } });
});

// POST /api/chat/messages/:id/reactions { emoji } — toggle your reaction.
//
// Reactions are the interaction model for read-only channels: you cannot reply
// in a bot feed, but you can respond to it. Restricted to a fixed set rather
// than free text — an open field would be a message box on a channel that is
// meant to be read-only, and it bounds the embedded array.
router.post('/messages/:id/reactions', async (req, res) => {
  try {
    if (!isValidId(req.params.id)) return res.status(404).json({ message: 'Message not found' });

    const emoji = (req.body?.emoji ?? '').toString();
    if (!REACTION_EMOJI.includes(emoji)) {
      return res.status(400).json({ message: 'That reaction is not available.' });
    }

    const message = await ChatMessage.findById(req.params.id);
    if (!message || message.deletedAt) return res.status(404).json({ message: 'Message not found' });

    const convo = await ChatConversation.findById(message.conversationId);
    if (!convo || !canRead(convo, req.user)) return res.status(403).json({ message: 'Forbidden' });
    // A chat ban silences reacting too, or it would just be a quieter way to
    // keep participating.
    if (isChatBanned(req.user)) {
      return res.status(403).json({ code: 'CHAT_BANNED', message: 'You cannot react in chat.' });
    }

    const existing = (message.reactions ?? []).find(r => r.emoji === emoji);
    const mine = existing?.userIds?.some(id => String(id) === String(req.user._id));

    // Positional $addToSet/$pull rather than read-modify-write, so two people
    // reacting at the same moment cannot clobber each other's entry.
    if (mine) {
      await ChatMessage.updateOne(
        { _id: message._id, 'reactions.emoji': emoji },
        { $pull: { 'reactions.$.userIds': req.user._id } },
      );
    } else if (existing) {
      await ChatMessage.updateOne(
        { _id: message._id, 'reactions.emoji': emoji },
        { $addToSet: { 'reactions.$.userIds': req.user._id } },
      );
    } else {
      await ChatMessage.updateOne(
        { _id: message._id, 'reactions.emoji': { $ne: emoji } },
        { $push: { reactions: { emoji, userIds: [req.user._id] } } },
      );
    }

    const fresh = await ChatMessage.findById(message._id).lean();

    // Tell live listeners to refetch rather than pushing the new counts.
    // `mine` is computed per viewer, so a single serialized payload would tell
    // everyone else that the reaction was theirs — and a refresh lets each
    // client resolve its own view. Reactions are rare enough that the extra
    // read costs nothing next to getting that wrong.
    chatStream.publish(message.conversationId, 'refresh', { reason: 'reaction' });

    res.json({ status: 'success', data: {
      message: serializeMessage(fresh, {
        viewerIsAdmin:    Boolean(req.user.isAdmin),
        conversationType: convo.type,
        viewerId:         req.user._id,
      }),
    } });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// How many readers the seen-by list will name before it stops counting them
// individually. A busy channel could have hundreds of rows; the list is a
// "who has seen this" reassurance, not a register.
const SEEN_BY_LIMIT = 200;

// GET /api/chat/messages/:id/seen-by — who has read one of YOUR messages.
//
// Derived from the existing ChatRead rows rather than a per-message receipt
// collection: a read marker already says "this user had the conversation open
// at time T", so everyone whose marker is at or past the message's timestamp
// has necessarily had it on screen. A receipt per (user × message) would be
// thousands of rows saying the same thing.
//
// Scoped to your OWN messages (admins excepted, who can already read every
// transcript). Letting anyone inspect anyone else's readership would turn a
// reassurance about your own post into a surveillance tool aimed at other
// people's.
//
// The sender is left out — appendMessage marks the conversation read for them
// as it writes, so they would otherwise always be the first name on the list.
router.get('/messages/:id/seen-by', async (req, res) => {
  try {
    if (!isValidId(req.params.id)) return res.status(404).json({ message: 'Message not found' });

    const message = await ChatMessage.findById(req.params.id)
      .select('conversationId senderUserId createdAt deletedAt').lean();
    if (!message) return res.status(404).json({ message: 'Message not found' });
    if (message.deletedAt && !req.user.isAdmin) {
      return res.status(404).json({ message: 'Message not found' });
    }

    const convo = await ChatConversation.findById(message.conversationId);
    if (!convo || !canRead(convo, req.user)) return res.status(403).json({ message: 'Forbidden' });

    const isMine = String(message.senderUserId ?? '') === String(req.user._id);
    if (!isMine && !req.user.isAdmin) {
      return res.status(403).json({ message: 'You can only see who has read your own messages.' });
    }

    const filter = {
      conversationId: convo._id,
      lastReadAt:     { $gte: message.createdAt },
      ...(message.senderUserId ? { userId: { $ne: message.senderUserId } } : {}),
    };

    const [rows, total] = await Promise.all([
      ChatRead.find(filter).sort({ lastReadAt: 1 }).limit(SEEN_BY_LIMIT).lean(),
      ChatRead.countDocuments(filter),
    ]);

    // Bots mark threads read as a side effect of posting into them; naming one
    // as a reader would be noise.
    const users = await User.find({ _id: { $in: rows.map(r => r.userId) }, isBot: { $ne: true } })
      .select('displayName agentNumber isAdmin').lean();
    const byId = new Map(users.map(u => [String(u._id), u]));

    const readers = rows
      .map(r => {
        const u = byId.get(String(r.userId));
        if (!u) return null;
        return {
          _id:         u._id,
          displayName: u.displayName ?? null,
          agentNumber: u.agentNumber ?? null,
          isAdmin:     Boolean(u.isAdmin),
          seenAt:      r.lastReadAt,
        };
      })
      .filter(Boolean);

    res.json({ status: 'success', data: {
      readers,
      // `total` counts read markers; `readers` drops bots and deleted accounts,
      // so the client shows the length it can actually name and only mentions
      // the remainder when the limit truncated the list.
      total,
      truncated: total > rows.length,
    } });
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
          ...serializeMessage(m, { viewerIsAdmin: true, conversationType: c?.type, viewerId: req.user._id }),
          conversationType:  c?.type ?? null,
          conversationTitle: c?.type === 'channel' ? channelTitle(c) : null,
        };
      }),
    } });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// GET /api/chat/presence — who is online right now. Admin only.
//
// Reads the same `lastSeen` the heartbeat writes (POST /api/users/heartbeat) and
// the same window the dashboard's Users Online tile counts, so the two can never
// disagree. No new presence tracking: this is a view onto a signal the app has
// been recording all along.
//
// Admin-only by deliberate choice, not by oversight. Telling every member who
// else is currently online is a real disclosure about people — it says when
// someone is at their computer — and nobody has agreed to it. Until there is an
// appear-offline setting to opt out with, this stays behind adminOnly.
//
// `count` is the true total even when `online` has been capped, so a busy day
// reports "62 online" and lists the 50 most recent rather than quietly claiming
// there are 50.
router.get('/presence', adminOnly, async (req, res) => {
  try {
    const since = new Date(Date.now() - PRESENCE_WINDOW_MS);
    // Bots never heartbeat, so they cannot appear here anyway — excluded
    // explicitly so that stays true if one ever gets a client. Banned accounts
    // are dropped: an admin scanning who is around does not need them, and a DM
    // dot next to one would invite a conversation the ban already ended.
    const filter = { lastSeen: { $gte: since }, isBot: { $ne: true }, isBanned: { $ne: true } };

    const [users, count] = await Promise.all([
      User.find(filter)
        .select('displayName agentNumber isAdmin lastSeen lastLocation')
        .sort({ lastSeen: -1 })
        .limit(PRESENCE_LIST_LIMIT)
        .lean(),
      User.countDocuments(filter),
    ]);

    res.json({ status: 'success', data: {
      online: users.map(u => {
        // The viewer is reading this strip from Community, so telling them they
        // are in Community is the one row that carries no information. `isSelf`
        // lets the client mark the row instead.
        const isSelf = String(u._id) === String(req.user._id);
        return {
          _id:         u._id,
          displayName: u.displayName ?? null,
          agentNumber: u.agentNumber ?? null,
          isAdmin:     Boolean(u.isAdmin),
          isSelf,
          lastSeen:    u.lastSeen ?? null,
          location:    isSelf ? null : (u.lastLocation ?? null),
        };
      }),
      count,
      windowMs: PRESENCE_WINDOW_MS,
    } });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// GET /api/chat/admin/users/search?q= — find anyone to DM, from the rail.
//
// Deliberately looser than /conversations/:id/mention-suggestions, which only
// prefix-matches a display name: an admin is usually working from a support
// ticket or a report, so they half-remember an agent number or an email rather
// than the name someone chose. Substring match on all three, so typing "333"
// finds agent 333111666.
//
// Bots are omitted — the rail already lists the ones that answer, and a poster
// bot would only 400 on the way to a thread it can never reply in. Chat-banned
// users are *kept*: talking to someone is often the point of the ban.
router.get('/admin/users/search', adminOnly, async (req, res) => {
  try {
    const q = (req.query.q ?? '').toString().trim();
    if (!q) return res.json({ status: 'success', data: { users: [] } });

    const rx = new RegExp(escapeRegex(q), 'i');
    const users = await User.find({
      isBot:     { $ne: true },
      isBanned:  { $ne: true },
      _id:       { $ne: req.user._id },
      $or: [{ displayName: rx }, { agentNumber: rx }, { email: rx }],
    })
      .select('displayName agentNumber isAdmin chatBannedAt')
      .sort({ displayNameLower: 1 })
      .limit(ADMIN_USER_SEARCH_LIMIT)
      .lean();

    res.json({ status: 'success', data: {
      users: users.map(u => ({
        _id:         u._id,
        displayName: u.displayName ?? null,
        agentNumber: u.agentNumber ?? null,
        isAdmin:     Boolean(u.isAdmin),
        chatBanned:  Boolean(u.chatBannedAt),
      })),
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
        postPolicy:    c.channel?.postPolicy ?? 'everyone',
        postBotUserId: c.channel?.postBotUserId ?? null,
        notifyMembers: c.channel?.notifyMembers !== false,
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
      postPolicy:  POST_POLICIES.includes(req.body?.postPolicy) ? req.body.postPolicy : 'everyone',
      postBotUserId: isValidId(req.body?.postBotUserId) ? req.body.postBotUserId : null,
      notifyMembers: req.body?.notifyMembers !== false,
    };
    if (channel.postPolicy === 'bot' && !channel.postBotUserId) {
      return res.status(400).json({ message: 'Pick which bot posts in this channel.' });
    }

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
    if (POST_POLICIES.includes(req.body?.postPolicy)) {
      set['channel.postPolicy'] = req.body.postPolicy;
      if (req.body.postPolicy !== 'bot') set['channel.postBotUserId'] = null;
    }
    if (req.body?.postBotUserId !== undefined) {
      set['channel.postBotUserId'] = isValidId(req.body.postBotUserId) ? req.body.postBotUserId : null;
    }
    if (req.body?.notifyMembers !== undefined) {
      set['channel.notifyMembers'] = req.body.notifyMembers !== false;
    }
    const nextPolicy = set['channel.postPolicy'] ?? convo.channel?.postPolicy;
    const nextBot = 'channel.postBotUserId' in set
      ? set['channel.postBotUserId'] : convo.channel?.postBotUserId;
    if (nextPolicy === 'bot' && !nextBot) {
      return res.status(400).json({ message: 'Pick which bot posts in this channel.' });
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

// ── Admin: guides ────────────────────────────────────────────────────────────
//
// Links out to the best CBAT reading, shown above Channels in the rail.
//
// The URL is admin-entered and becomes a real anchor in every user's browser,
// so it is validated on the way IN rather than trusted on the way out: only
// http/https, and only with a hostname. Without that check a `javascript:` URL
// stored here would run in the reader's page the moment they clicked it.
//
// A site-relative path is allowed too, and is how the guide page on SkyWatch
// itself is linked ("/cbat-guide"). The rail routes those through react-router
// rather than opening a tab. `//evil.com` is rejected with everything else: it
// looks relative and is not — the browser reads it as protocol-relative and
// leaves the site.

// Returns the normalised URL, or null if it is not one we will render.
function safeGuideUrl(value) {
  const raw = String(value ?? '').trim();
  if (!raw || raw.length > 500) return null;

  if (raw.startsWith('/')) {
    if (raw.startsWith('//')) return null;
    if (/[\s\\]/.test(raw)) return null;
    return raw;
  }

  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    return null;
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
  if (!parsed.hostname) return null;
  return parsed.toString();
}

const serializeGuide = (g) => ({
  _id:         g._id,
  title:       g.title,
  url:         g.url,
  description: g.description ?? '',
  emoji:       g.emoji ?? null,
  order:       g.order ?? 0,
  isHidden:    Boolean(g.isHidden),
  updatedAt:   g.updatedAt,
});

// GET /api/chat/admin/guides — every guide, hidden ones included
router.get('/admin/guides', adminOnly, async (_req, res) => {
  try {
    const guides = await ChatGuide.find({}).sort({ isHidden: 1, order: 1, title: 1 }).lean();
    res.json({ status: 'success', data: { guides: guides.map(serializeGuide) } });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// POST /api/chat/admin/guides — add a link
router.post('/admin/guides', adminOnly, async (req, res) => {
  try {
    const title = (req.body?.title ?? '').toString().trim();
    if (!title) return res.status(400).json({ message: 'Guide title is required' });
    if (title.length > 60) return res.status(400).json({ message: 'Guide title must be 60 characters or fewer' });

    const url = safeGuideUrl(req.body?.url);
    if (!url) return res.status(400).json({ message: 'Enter a full web address starting with http:// or https://' });

    const created = await ChatGuide.create({
      title,
      url,
      description: (req.body?.description ?? '').toString().trim().slice(0, 200),
      emoji:       (req.body?.emoji ?? '').toString().trim().slice(0, 8) || null,
      order:       Number.isFinite(Number(req.body?.order)) ? Number(req.body.order) : 0,
      isHidden:    req.body?.isHidden === true,
    });

    await AdminAction.create({
      userId:     req.user._id,
      actionType: 'chat_guide_create',
      reason:     `Added community guide "${title}"`,
    });

    res.json({ status: 'success', data: { guide: serializeGuide(created) } });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// PATCH /api/chat/admin/guides/:id — retitle / repoint / reorder / hide
router.patch('/admin/guides/:id', adminOnly, async (req, res) => {
  try {
    if (!isValidId(req.params.id)) return res.status(404).json({ message: 'Guide not found' });
    const guide = await ChatGuide.findById(req.params.id);
    if (!guide) return res.status(404).json({ message: 'Guide not found' });

    if (req.body?.title !== undefined) {
      const title = String(req.body.title).trim();
      if (!title) return res.status(400).json({ message: 'Guide title is required' });
      if (title.length > 60) return res.status(400).json({ message: 'Guide title must be 60 characters or fewer' });
      guide.title = title;
    }
    if (req.body?.url !== undefined) {
      const url = safeGuideUrl(req.body.url);
      if (!url) return res.status(400).json({ message: 'Enter a full web address starting with http:// or https://' });
      guide.url = url;
    }
    if (req.body?.description !== undefined) {
      guide.description = String(req.body.description).trim().slice(0, 200);
    }
    if (req.body?.emoji !== undefined) {
      guide.emoji = String(req.body.emoji).trim().slice(0, 8) || null;
    }
    if (req.body?.order !== undefined && Number.isFinite(Number(req.body.order))) {
      guide.order = Number(req.body.order);
    }
    if (req.body?.isHidden !== undefined) {
      guide.isHidden = req.body.isHidden === true;
    }
    guide.updatedAt = new Date();
    await guide.save();

    await AdminAction.create({
      userId:     req.user._id,
      actionType: 'chat_guide_edit',
      reason:     `Edited community guide "${guide.title}"`,
    });

    res.json({ status: 'success', data: { guide: serializeGuide(guide) } });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// DELETE /api/chat/admin/guides/:id — remove the link.
// No archive step: a guide holds no transcript, so there is nothing to lose
// beyond the URL itself, and hiding is already offered for that.
router.delete('/admin/guides/:id', adminOnly, async (req, res) => {
  try {
    if (!isValidId(req.params.id)) return res.status(404).json({ message: 'Guide not found' });
    const guide = await ChatGuide.findByIdAndDelete(req.params.id);
    if (!guide) return res.status(404).json({ message: 'Guide not found' });

    await AdminAction.create({
      userId:     req.user._id,
      actionType: 'chat_guide_delete',
      reason:     `Removed community guide "${guide.title}"`,
    });

    res.json({ status: 'success' });
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

    // A moderated message must vanish from a live panel too, not linger until
    // its reader reloads. The event carries no body — the client refetches, so
    // there is one rule about what a non-admin may see and it lives in the
    // messages route.
    chatStream.publish(message.conversationId, 'refresh', { reason: 'moderated' });

    res.json({ status: 'success', data: {
      message: serializeMessage(updated.toObject(), { viewerIsAdmin: true, viewerId: req.user._id }),
    } });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// PATCH /api/chat/admin/messages/:id { body } — correct a message in place.
//
// The edit is never silent: `editedAt` puts an "(edited)" marker on the message
// for every reader, and the pre-edit text is kept in `originalBody` so the
// moderation record still shows what was actually posted. Captured on the first
// edit only, so a second pass cannot launder the original away.
//
// Deleted and system messages are off limits — one has already been removed,
// and the other is written by the server rather than by anyone.
//
// The reply-quote snapshots on any children are deliberately NOT rewritten:
// they record what the replier was answering, which is the point of
// snapshotting them at send time in the first place.
router.patch('/admin/messages/:id', adminOnly, async (req, res) => {
  try {
    if (!isValidId(req.params.id)) return res.status(404).json({ message: 'Message not found' });

    const body = (req.body?.body ?? '').toString().trim();
    if (!body) return res.status(400).json({ message: 'Message body is required' });
    if (body.length > 4000) return res.status(400).json({ message: 'Message too long (max 4000 chars)' });

    const message = await ChatMessage.findById(req.params.id);
    if (!message) return res.status(404).json({ message: 'Message not found' });
    if (message.deletedAt) {
      return res.status(400).json({ message: 'That message has been removed.' });
    }
    if (message.senderRole === 'system') {
      return res.status(400).json({ message: 'System messages cannot be edited.' });
    }
    if (body === message.body) {
      return res.json({ status: 'success', data: {
        message: serializeMessage(message.toObject(), {
          viewerIsAdmin: true, viewerId: req.user._id,
        }),
      } });
    }

    const updated = await ChatMessage.findByIdAndUpdate(
      message._id,
      {
        $set: {
          body,
          editedAt:       new Date(),
          editedByUserId: req.user._id,
          ...(message.originalBody ? {} : { originalBody: message.body }),
        },
      },
      { returnDocument: 'after' },
    );

    await AdminAction.create({
      userId:       req.user._id,
      actionType:   'chat_message_edit',
      reason:       'Edited a chat message',
      targetUserId: message.senderUserId ?? undefined,
    });

    chatStream.publish(message.conversationId, 'refresh', { reason: 'edited' });

    const convo = await ChatConversation.findById(message.conversationId).select('type').lean();
    res.json({ status: 'success', data: {
      message: serializeMessage(updated.toObject(), {
        viewerIsAdmin:    true,
        conversationType: convo?.type,
        viewerId:         req.user._id,
      }),
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

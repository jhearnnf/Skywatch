// The write primitives every chat writer shares: append a message, mark a
// conversation read, close and reopen a support thread.
//
// These lived in routes/chat.js until support tickets. A problem report now
// opens a support thread from routes/users.js, and an admin reply from the
// Reports tab lands in one from routes/admin.js, so the primitives have to be
// reachable from outside the chat router. Behaviour is unchanged; the chat
// router requires them from here.

const ChatConversation = require('../models/ChatConversation');
const ChatMessage      = require('../models/ChatMessage');
const ChatRead         = require('../models/ChatRead');
const chatStream       = require('./chatStream');

// Who a message is from, as far as other users are concerned. Support threads
// collapse every admin to one "SkyWatch Support" identity; in channels and DMs
// admins speak under their own display name like anyone else.
const SUPPORT_LABEL = 'SkyWatch Support';

function markRead(userId, conversationId, at = new Date()) {
  return ChatRead.findOneAndUpdate(
    { userId, conversationId },
    { $set: { lastReadAt: at } },
    { upsert: true },
  );
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

// A system line that flips a support thread's status. Marks it read for
// whoever did it — their own action is not news to them — and for nobody
// else: the reply that came with "resolved" is exactly what the other side
// still has to read, and a resolved ticket stays in their rail until they do.
// (Before tickets a closed chat was a dead end, so the close used to snap the
// user's marker too; now replying reopens it, so there is nothing to spare
// them from.)
async function setSupportStatus(convo, status, { byRole, byUserId, body }) {
  const sysMsg = await ChatMessage.create({
    conversationId: convo._id,
    senderUserId:   byUserId ?? null,
    senderRole:     'system',
    body,
  });
  const closing = status === 'closed';
  const updated = await ChatConversation.findByIdAndUpdate(
    convo._id,
    {
      $set: {
        status,
        closedAt:              closing ? sysMsg.createdAt : null,
        closedBy:              closing ? byRole : null,
        closedByUserId:        closing ? (byUserId ?? null) : null,
        lastMessageAt:         sysMsg.createdAt,
        lastMessageSenderRole: 'system',
        adminLastReadAt:       sysMsg.createdAt,
      },
      $inc: { messageCount: 1 },
    },
    { returnDocument: 'after' },
  );
  if (byUserId) await markRead(byUserId, convo._id, sysMsg.createdAt);
  return updated;
}

function closeConversation(convo, opts) {
  return setSupportStatus(convo, 'closed', opts);
}

function reopenConversation(convo, opts) {
  return setSupportStatus(convo, 'open', opts);
}

module.exports = { SUPPORT_LABEL, markRead, appendMessage, closeConversation, reopenConversation };

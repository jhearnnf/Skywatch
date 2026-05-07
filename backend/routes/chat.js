const router = require('express').Router();
const mongoose = require('mongoose');
const { protect, adminOnly } = require('../middleware/auth');
const ChatConversation = require('../models/ChatConversation');
const ChatMessage      = require('../models/ChatMessage');
const AppSettings      = require('../models/AppSettings');
const AdminAction      = require('../models/AdminAction');
const User             = require('../models/User');

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

// ── Helpers ──────────────────────────────────────────────────────────────────

// Append a message to a conversation, advancing lastMessageAt and snapping
// the sender's read timestamp (sending implies reading everything up to now).
async function appendMessage({ conversationId, senderUserId, senderRole, body }) {
  const message = await ChatMessage.create({
    conversationId, senderUserId, senderRole, body,
  });
  const update = {
    lastMessageAt:         message.createdAt,
    lastMessageSenderRole: senderRole,
  };
  if (senderRole === 'user')  update.userLastReadAt  = message.createdAt;
  if (senderRole === 'admin') update.adminLastReadAt = message.createdAt;
  await ChatConversation.findByIdAndUpdate(conversationId, update);
  return message;
}

// ── User endpoints ───────────────────────────────────────────────────────────

// POST /api/chat/conversations — start (or coalesce into) a help chat.
// Idempotent: returns existing open chat if one exists. Concurrent inserts are
// caught by the partial unique index and re-resolved via a follow-up findOne.
router.post('/conversations', async (req, res) => {
  try {
    let convo = await ChatConversation.findOne({
      userId: req.user._id,
      status: 'open',
    });
    if (!convo) {
      try {
        convo = await ChatConversation.create({
          userId:        req.user._id,
          startedByRole: 'user',
        });
      } catch (err) {
        if (err && err.code === 11000) {
          convo = await ChatConversation.findOne({ userId: req.user._id, status: 'open' });
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

// GET /api/chat/conversations/mine — list the current user's conversations
router.get('/conversations/mine', async (req, res) => {
  try {
    const conversations = await ChatConversation
      .find({ userId: req.user._id })
      .sort({ lastMessageAt: -1 });
    res.json({ status: 'success', data: { conversations } });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// GET /api/chat/unread/me — drives the user navbar dot + entry visibility
router.get('/unread/me', async (req, res) => {
  try {
    const [openConvo, unreadConvo] = await Promise.all([
      ChatConversation.exists({ userId: req.user._id, status: 'open' }),
      ChatConversation.exists({
        userId: req.user._id,
        status: 'open',
        lastMessageSenderRole: 'admin',
        $or: [
          { userLastReadAt: null },
          { $expr: { $lt: ['$userLastReadAt', '$lastMessageAt'] } },
        ],
      }),
    ]);
    res.json({ status: 'success', data: {
      hasAnyOpenChat: Boolean(openConvo),
      hasUnread:      Boolean(unreadConvo),
    } });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// GET /api/chat/conversations/:id/messages?before=<ISO>&limit=50
router.get('/conversations/:id/messages', async (req, res) => {
  try {
    if (!isValidId(req.params.id)) return res.status(404).json({ message: 'Conversation not found' });

    const convo = await ChatConversation.findById(req.params.id);
    if (!convo) return res.status(404).json({ message: 'Conversation not found' });

    const isOwner = convo.userId.toString() === req.user._id.toString();
    if (!isOwner && !req.user.isAdmin) {
      return res.status(403).json({ message: 'Forbidden' });
    }

    const limit  = Math.min(200, Math.max(1, parseInt(req.query.limit, 10) || 50));
    const before = req.query.before ? new Date(req.query.before) : null;
    const filter = { conversationId: convo._id };
    if (before && !isNaN(before.getTime())) filter.createdAt = { $lt: before };

    const messages = await ChatMessage
      .find(filter)
      .sort({ createdAt: -1 })
      .limit(limit + 1);

    const hasMore = messages.length > limit;
    const items   = (hasMore ? messages.slice(0, limit) : messages).reverse();

    res.json({ status: 'success', data: { messages: items, hasMore } });
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

    const isOwner = convo.userId.toString() === req.user._id.toString();
    const isAdmin = Boolean(req.user.isAdmin);
    if (!isOwner && !isAdmin) return res.status(403).json({ message: 'Forbidden' });

    if (convo.status === 'closed') {
      return res.status(400).json({ message: 'This chat has been closed.' });
    }

    const senderRole = isAdmin && !isOwner ? 'admin' : (isOwner ? 'user' : 'admin');
    const message = await appendMessage({
      conversationId: convo._id,
      senderUserId:   req.user._id,
      senderRole,
      body,
    });

    res.json({ status: 'success', data: { message } });
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

    const isOwner = convo.userId.toString() === req.user._id.toString();
    const isAdmin = Boolean(req.user.isAdmin);
    if (!isOwner && !isAdmin) return res.status(403).json({ message: 'Forbidden' });

    const update = {};
    if (isOwner) update.userLastReadAt  = new Date();
    if (isAdmin) update.adminLastReadAt = new Date();
    await ChatConversation.findByIdAndUpdate(convo._id, update);

    res.json({ status: 'success' });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// POST /api/chat/conversations/:id/close — user-initiated close.
// Inserts a system message "User closed this chat" so the admin sees it.
// Snaps both read timestamps so neither side keeps a stale red dot.
router.post('/conversations/:id/close', async (req, res) => {
  try {
    if (!isValidId(req.params.id)) return res.status(404).json({ message: 'Conversation not found' });

    const convo = await ChatConversation.findById(req.params.id);
    if (!convo) return res.status(404).json({ message: 'Conversation not found' });
    if (convo.userId.toString() !== req.user._id.toString()) {
      return res.status(403).json({ message: 'Forbidden' });
    }
    if (convo.status === 'closed') {
      return res.json({ status: 'success', data: { conversation: convo } });
    }

    const sysMsg = await ChatMessage.create({
      conversationId: convo._id,
      senderUserId:   req.user._id,
      senderRole:     'system',
      body:           'User closed this chat',
    });
    const updated = await ChatConversation.findByIdAndUpdate(
      convo._id,
      {
        status:                'closed',
        closedAt:              sysMsg.createdAt,
        closedBy:              'user',
        closedByUserId:        req.user._id,
        lastMessageAt:         sysMsg.createdAt,
        lastMessageSenderRole: 'system',
        userLastReadAt:        sysMsg.createdAt,
        adminLastReadAt:       sysMsg.createdAt,
      },
      { returnDocument: 'after' },
    );

    res.json({ status: 'success', data: { conversation: updated } });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// ── Admin endpoints ──────────────────────────────────────────────────────────

// GET /api/chat/unread/admin — drives admin navbar dot + entry visibility
router.get('/unread/admin', adminOnly, async (req, res) => {
  try {
    const [openExists, unreadCount] = await Promise.all([
      ChatConversation.exists({ status: 'open' }),
      ChatConversation.countDocuments({
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

// GET /api/chat/admin/conversations?status=open|closed|all&userId=&page=&limit=
router.get('/admin/conversations', adminOnly, async (req, res) => {
  try {
    const status = req.query.status || 'all';
    const filter = {};
    if (status === 'open' || status === 'closed') filter.status = status;
    if (req.query.userId && isValidId(req.query.userId)) filter.userId = req.query.userId;

    const page  = Math.max(1, parseInt(req.query.page,  10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 30));

    const [conversations, total] = await Promise.all([
      ChatConversation.find(filter)
        .sort({ lastMessageAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .populate('userId', 'agentNumber email isAdmin')
        .lean(),
      ChatConversation.countDocuments(filter),
    ]);

    // Tag each row with hasAdminUnread for the per-row red dot
    const enriched = conversations.map(c => ({
      ...c,
      hasAdminUnread:
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

// GET /api/chat/admin/users/:userId/conversations — list a user's chats (open + closed)
router.get('/admin/users/:userId/conversations', adminOnly, async (req, res) => {
  try {
    if (!isValidId(req.params.userId)) return res.status(400).json({ message: 'Invalid user id' });

    const conversations = await ChatConversation
      .find({ userId: req.params.userId })
      .sort({ lastMessageAt: -1 })
      .populate('userId', 'agentNumber email')
      .lean();

    const enriched = conversations.map(c => ({
      ...c,
      hasAdminUnread:
        c.lastMessageSenderRole === 'user' &&
        (!c.adminLastReadAt || new Date(c.adminLastReadAt) < new Date(c.lastMessageAt)),
    }));

    res.json({ status: 'success', data: { conversations: enriched } });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// POST /api/chat/admin/conversations { userId } — start (or coalesce) a chat with a user
router.post('/admin/conversations', adminOnly, async (req, res) => {
  try {
    const { userId } = req.body || {};
    if (!isValidId(userId)) return res.status(400).json({ message: 'Invalid user id' });

    const target = await User.findById(userId).select('_id');
    if (!target) return res.status(404).json({ message: 'User not found' });

    let convo = await ChatConversation.findOne({ userId, status: 'open' });
    let created = false;
    if (!convo) {
      try {
        convo = await ChatConversation.create({ userId, startedByRole: 'admin' });
        created = true;
        await AdminAction.create({
          userId:       req.user._id,
          actionType:   'chat_start',
          reason:       'Admin started a help chat with the user',
          targetUserId: userId,
        });
      } catch (err) {
        if (err && err.code === 11000) {
          // Concurrent start — another request just created the open chat.
          // Coalesce into it without logging a second AdminAction.
          convo = await ChatConversation.findOne({ userId, status: 'open' });
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
    if (convo.status === 'closed') {
      return res.json({ status: 'success', data: { conversation: convo } });
    }

    const sysMsg = await ChatMessage.create({
      conversationId: convo._id,
      senderUserId:   req.user._id,
      senderRole:     'system',
      body:           'Admin closed this chat',
    });
    const updated = await ChatConversation.findByIdAndUpdate(
      convo._id,
      {
        status:                'closed',
        closedAt:              sysMsg.createdAt,
        closedBy:              'admin',
        closedByUserId:        req.user._id,
        lastMessageAt:         sysMsg.createdAt,
        lastMessageSenderRole: 'system',
        userLastReadAt:        sysMsg.createdAt,
        adminLastReadAt:       sysMsg.createdAt,
      },
      { returnDocument: 'after' },
    );

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
        status:                'open',
        closedAt:              null,
        closedBy:              null,
        closedByUserId:        null,
        lastMessageAt:         sysMsg.createdAt,
        lastMessageSenderRole: 'system',
        adminLastReadAt:       sysMsg.createdAt,
      },
      { returnDocument: 'after' },
    );

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

module.exports = router;

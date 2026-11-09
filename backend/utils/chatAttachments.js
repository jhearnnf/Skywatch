// Photos and videos in chat: who may send them where, how an upload is
// signed, and how a stored attachment is served back.
//
// Where they are allowed at all:
//   • support tickets — every way a user can report a problem opens one
//   • DMs where one side is an admin and neither side is a bot
// Never in channels, the lounge, cohort groups, bot DMs, or DMs between two
// ordinary users.
//
// Who may send, inside an allowed thread:
//   • an admin, always
//   • the user, only once an admin has switched on "Allow user uploaded
//     content for this chat" (`convo.mediaAllowed`). Switching it off stops
//     new uploads; files already sent stay. In a DM the other side must STILL
//     be an admin when the user sends — demoting them stops new uploads too.
//
// Storage is the free Cloudinary plan, so everything is shrunk before it is
// kept. Photos are re-encoded on the device (which also strips EXIF/GPS) and
// capped again by an incoming transformation. Videos are trimmed to a minute,
// scaled to 720p and re-encoded on the way in, and the original is never
// stored. Cloudinary only transforms a video synchronously up to 40MB on the
// free plan, which is where the size cap comes from.

const crypto = require('crypto');
const { signedUrl, signedVideoUrl } = require('./cloudinary');

const MAX_ATTACHMENTS = 4;
// After on-device compression. A 1600px JPEG is a few hundred KB; this only
// catches a client that skipped the compression step.
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const MAX_VIDEO_BYTES = 40 * 1024 * 1024;
const MAX_VIDEO_SECONDS = 60;

const KIND_RULES = {
  image: {
    resourceType: 'image',
    transformation: 'c_limit,w_1600,h_1600/q_auto:good',
    format: null,
    maxBytes: MAX_IMAGE_BYTES,
  },
  video: {
    resourceType: 'video',
    transformation: `du_${MAX_VIDEO_SECONDS}/c_limit,w_1280,h_1280/q_auto:eco`,
    format: 'mp4',
    maxBytes: MAX_VIDEO_BYTES,
  },
};

const FOLDER = 'chat-attachments';
const folderFor = (conversationId) => `${FOLDER}/${conversationId}`;

// Ours, so a client can never choose a name — and the conversation is in the
// path, so a file signed for one thread can never be attached in another.
function newPublicId(conversationId, kind) {
  return `${folderFor(conversationId)}/${kind === 'video' ? 'vid' : 'img'}_${crypto.randomBytes(12).toString('hex')}`;
}

/**
 * What this viewer can do with media in this conversation.
 *
 * `participants` is the DM's two users with { _id, isAdmin, isBot }, looked up
 * by the caller; unused for support. Returns:
 *   eligible   — the thread is one where media can exist at all
 *   allowed    — an admin has switched uploads on for the user side
 *   canAttach  — this viewer may send a file right now
 *   canToggle  — this viewer may switch the user's permission on or off
 */
function mediaAccess(convo, viewer, participants = []) {
  const none = { eligible: false, allowed: false, canAttach: false, canToggle: false };
  if (!convo || !viewer) return none;
  const allowed = Boolean(convo.mediaAllowed?.at);
  const viewerIsAdmin = Boolean(viewer.isAdmin);

  if (convo.type === 'support') {
    const isOwner = String(convo.userId ?? '') === String(viewer._id);
    return {
      eligible:  true,
      allowed,
      // An admin replying in someone's ticket always may; the owner needs the
      // permission. (An admin's own ticket: they are an admin.)
      canAttach: viewerIsAdmin || (isOwner && allowed),
      canToggle: viewerIsAdmin,
    };
  }

  if (convo.type === 'dm') {
    if (convo.botUserId) return none;
    if (participants.some(p => p?.isBot)) return none;
    const isParticipant = (convo.participantIds ?? []).some(id => String(id) === String(viewer._id));
    const other = participants.find(p => p && String(p._id) !== String(viewer._id));
    const anyAdmin = participants.some(p => p?.isAdmin);
    if (!anyAdmin) return { ...none, allowed };
    return {
      eligible:  true,
      allowed,
      canAttach: isParticipant && (viewerIsAdmin || (allowed && Boolean(other?.isAdmin))),
      // Only the admin in the thread. Another admin reading the transcript
      // is moderating, not taking part.
      canToggle: isParticipant && viewerIsAdmin,
    };
  }

  return none;
}

// Rendered for any viewer allowed to see the message. Fresh signatures every
// read; the bytes are only reachable through a link we signed.
function serializeAttachments(list) {
  return (list ?? []).map((a) => {
    if (a.kind === 'video') {
      return {
        kind:        'video',
        width:       a.width ?? null,
        height:      a.height ?? null,
        durationSec: a.durationSec ?? null,
        url:         signedVideoUrl(a.publicId, { format: 'mp4' }),
        posterUrl:   signedVideoUrl(a.publicId, {
          format: 'jpg',
          transformation: [{ start_offset: 0, crop: 'limit', width: 640, height: 640 }],
        }),
      };
    }
    return {
      kind:     'image',
      width:    a.width ?? null,
      height:   a.height ?? null,
      url:      signedUrl(a.publicId),
      thumbUrl: signedUrl(a.publicId, {
        transformation: [{ crop: 'limit', width: 640, height: 640, quality: 'auto' }],
      }),
    };
  });
}

// What stands in for the text of an attachment-only message, wherever a line
// of text is wanted: the rail preview, a reply quote, a search snippet.
function attachmentLabel(list) {
  const items = list ?? [];
  if (!items.length) return '';
  const videos = items.filter(a => a.kind === 'video').length;
  const photos = items.length - videos;
  const parts = [];
  if (photos) parts.push(photos === 1 ? 'Photo' : `${photos} photos`);
  if (videos) parts.push(videos === 1 ? 'Video' : `${videos} videos`);
  return parts.join(' and ');
}

// The text to show for a message: its body, or the attachment label when
// there is none.
const displayText = (m) => (m?.body ? m.body : attachmentLabel(m?.attachments));

module.exports = {
  MAX_ATTACHMENTS, MAX_IMAGE_BYTES, MAX_VIDEO_BYTES, MAX_VIDEO_SECONDS, KIND_RULES,
  folderFor, newPublicId, mediaAccess, serializeAttachments, attachmentLabel, displayText,
};

// Must match REACTION_EMOJI in backend/routes/chat.js — the server rejects
// anything else, so an extra entry here would only fail on click.
//
// Deliberately short. A picker you can scan beats an emoji keyboard, and a
// whitelist keeps free text out of a channel whose whole point is that users
// cannot post text into it.
export const REACTION_EMOJI = ['👍', '🎉', '🔥', '👏', '😮', '❤️']

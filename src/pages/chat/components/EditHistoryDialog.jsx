import { formatTime } from '../format'
import Overlay from '../../../components/ui/Overlay'
import { senderName } from '../senderName'

// Every version a message has been through, oldest first. Admin-only, and the
// "(edited)" marker that opens it is only a button for admins — the history is
// a moderation record, not a public diff. Making it public would turn every
// correction into a permanent display of the mistake, which is the opposite of
// what letting people fix their own typos is for.
//
// No fetch: `edits` rides along on the message for admins already (see
// serializeMessage in backend/routes/chat.js), so opening this costs nothing.
// Each entry holds the body as it stood BEFORE that edit, so the last card is
// the live text rather than another revision.
export default function EditHistoryDialog({ message, senders = {}, onClose }) {
  const edits = message.edits ?? []

  // Oldest first: the posted version, then each superseded one, then what it
  // says now. Reading a history backwards is a puzzle nobody needs at the point
  // they are deciding whether someone rewrote something in bad faith.
  const versions = [
    ...edits.map((e, i) => ({
      key:   `e${i}`,
      body:  e.body,
      at:    e.editedAt,
      by:    e.editedByUserId,
      label: i === 0 ? 'As posted' : `Version ${i + 1}`,
    })),
    { key: 'now', body: message.body, at: message.editedAt, by: message.editedByUserId, label: 'Current' },
  ]

  // Who made an edit, where we can name them. The id is on the entry rather
  // than a name because display names change and the sender map is what knows
  // the current one — the same reason every other name here renders live.
  const editorName = (id) => (id ? senderName(id, senders, null) : null)

  return (
    <Overlay onDismiss={onClose} className="flex items-center justify-center px-4">
      <div className="w-full max-w-sm bg-surface rounded-2xl border border-slate-200 card-shadow overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-200">
          <p className="text-sm font-bold text-slate-700">Edit history</p>
          <p className="text-[11px] text-slate-400">
            {edits.length === 0
              ? 'No earlier versions were recorded.'
              : `${edits.length} ${edits.length === 1 ? 'edit' : 'edits'} since posting.`}
          </p>
        </div>

        <div className="max-h-72 overflow-y-auto px-4 py-2 space-y-2">
          {versions.map((v, i) => (
            <div
              key={v.key}
              className={`rounded-xl border px-3 py-2 ${
                i === versions.length - 1
                  ? 'border-brand-200 bg-brand-50'
                  : 'border-slate-200 bg-slate-100/50'
              }`}
            >
              <p className="flex items-baseline gap-2 text-[10px] font-semibold uppercase tracking-wide text-slate-400">
                <span>{v.label}</span>
                {v.at && <span className="font-normal normal-case tracking-normal">{formatTime(v.at)}</span>}
              </p>
              <p className="text-sm text-slate-800 whitespace-pre-wrap break-words mt-0.5">{v.body}</p>
              {/* Named only when someone other than the author made the change:
                  "edited by the person who wrote it" is the default and saying
                  it on every row buries the one row where a moderator did. */}
              {v.by && String(v.by) !== String(message.senderUserId ?? '') && (
                <p className="text-[10px] italic text-slate-400 mt-0.5">
                  Edited by {editorName(v.by) || 'a moderator'}
                </p>
              )}
            </div>
          ))}
        </div>

        <div className="px-4 py-3 border-t border-slate-200">
          <button
            type="button"
            onClick={onClose}
            className="w-full px-4 py-2 text-slate-600 hover:text-slate-700 border border-slate-200 hover:bg-slate-100 font-bold rounded-xl text-sm transition-colors"
          >
            Close
          </button>
        </div>
      </div>
    </Overlay>
  )
}

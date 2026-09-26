import { CaseFilesNavIcon } from './CaseFilesNav'

export default function CaseFilesOfflineNav({ mobile = false }) {
  return (
    <span
      data-nav="case-files"
      role="link"
      aria-disabled="true"
      title="Case Files requires an internet connection"
      className={mobile
        ? 'relative flex-1 flex flex-col items-center justify-center gap-0.5 text-slate-400 opacity-60 cursor-not-allowed'
        : 'flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-semibold border border-transparent text-slate-400 opacity-60 cursor-not-allowed'}
    >
      <CaseFilesNavIcon size={24} active={false} />
      <span className={mobile ? 'text-[10px] font-semibold' : ''}>{mobile ? 'Cases' : 'Case Files'}</span>
      <span className="text-[10px] font-semibold">Offline</span>
    </span>
  )
}

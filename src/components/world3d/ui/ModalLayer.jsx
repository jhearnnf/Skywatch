import { useSyncExternalStore } from 'react'
import { modal } from '../state/modalStore'
import AircraftActionMenu from './AircraftActionMenu'
import BriefPickerModal from './BriefPickerModal'

// Single mount point for in-world modals. Lives in the DOM tree (outside the
// Canvas) so children can render normal HTML. The store carries a spec that
// tells us which modal to render with which props.

export default function ModalLayer() {
  const current = useSyncExternalStore(modal.subscribe, modal.get, () => null)
  if (!current) return null
  if (current.kind === 'aircraft')    return <AircraftActionMenu {...current} onClose={modal.close} />
  if (current.kind === 'briefPicker') return <BriefPickerModal   {...current} onClose={modal.close} />
  return null
}

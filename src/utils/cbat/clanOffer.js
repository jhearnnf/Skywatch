// Whether to offer CLAN alongside FLAG.
//
// CLAN is the test the RAF replaced with FLAG in 2021 and that Canada's CFAST
// still sits. It rides on the FLAG tile (which becomes FLAG | CLAN, with a
// flag on each half saying whose battery sits which) and the two instructions
// cards link across. It is offered to EVERYONE, not only players in Canada:
// the two tests are the same three-task juggle, so it is useful practice for a
// FLAG sitter too; NZ still sits CLAN as well; and a region gate hides the
// game from exactly the people it is for whenever the IP lookup is missing or
// a VPN is on. The flags and the cards' copy are what stop an RAF applicant
// mistaking it for their test.
//
// The only thing that withdraws it is the admin toggle, which hides it from
// players (never from admins, who see every game whether or not it is on).
// The page itself is not gated: /cbat/clan is reachable by anyone signed in.

import { useAuth } from '../../context/AuthContext'
import { useAppSettings } from '../../context/AppSettingsContext'
import { isCbatGameEnabled } from './isCbatGameEnabled'

export function clanOffered({ isAdmin, cbatGameEnabled }) {
  if (isAdmin) return true
  return isCbatGameEnabled(cbatGameEnabled, 'clan')
}

export function useClanOffered() {
  const { user } = useAuth() ?? {}
  const { settings } = useAppSettings() ?? {}
  return clanOffered({ isAdmin: !!user?.isAdmin, cbatGameEnabled: settings?.cbatGameEnabled })
}

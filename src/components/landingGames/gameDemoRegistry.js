import CbatPlaneTurn     from '../../pages/CbatPlaneTurn'
import CbatVisualisation from '../../pages/CbatVisualisation'
import CbatSat           from '../../pages/CbatSat'
import CbatCut           from '../../pages/CbatCut'
import CbatSymbols       from '../../pages/CbatSymbols'
import CbatDpt           from '../../pages/CbatDpt'
import CbatFlag          from '../../pages/CbatFlag'
import CbatTarget        from '../../pages/CbatTarget'
import CbatAct           from '../../pages/CbatAct'
import CbatInstruments   from '../../pages/CbatInstruments'

// Which real page each pool entry mounts. These are the same components
// src/App.jsx routes to, which is why the live game wall costs nothing extra to
// ship — App already imports every one of them statically.
//
// Kept apart from gameDemoPool.js so the pool (and its picking logic) stays a
// plain data module.
export const COMPONENT_BY_ID = {
  'trace-2':          CbatPlaneTurn,
  'plane-turn-3d':    CbatPlaneTurn,
  'plane-turn-2d':    CbatPlaneTurn,
  'visualisation-2d': CbatVisualisation,
  sat:                CbatSat,
  cut:                CbatCut,
  symbols:            CbatSymbols,
  dpt:                CbatDpt,
  flag:               CbatFlag,
  target:             CbatTarget,
  act:                CbatAct,
  instruments:        CbatInstruments,
}

export const componentForDemo = (id) => COMPONENT_BY_ID[id] ?? null

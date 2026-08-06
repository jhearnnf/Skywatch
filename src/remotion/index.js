import { registerRoot } from 'remotion'
// Extensions are explicit: the repo is "type": "module", so Remotion's webpack
// bundler resolves these as fully-specified ESM requests.
import { RemotionRoot } from './Root.jsx'

// Bundled by clipper-agent/handlers/render.js via @remotion/bundler.
// Kept out of the app's own entry graph — nothing in src/main.jsx imports this,
// so it adds nothing to the site bundle.
registerRoot(RemotionRoot)

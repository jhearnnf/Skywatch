// "3(CUT), SAT" <-> [{ code: 'CUT', mult: 3 }, { code: 'SAT', mult: 1 }], the way the sheet writes it.
export function testsToText(tests) {
  return (tests ?? []).map(t => (t.mult > 1 ? `${t.mult}(${t.code})` : t.code)).join(', ')
}
export function textToTests(text) {
  return String(text ?? '').split(',').map(s => s.trim()).filter(Boolean).map(s => {
    const m = s.match(/^\(?(\d+)\s*\(?\s*([^()]+?)\s*\)?\)?$/)
    return m ? { code: m[2].trim(), mult: Number(m[1]) } : { code: s.replace(/[()]/g, '').trim(), mult: 1 }
  })
}

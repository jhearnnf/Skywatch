// Brief prompt shape helpers — pure string builders for the AI brief-generation
// prompts in backend/routes/admin.js. Kept in its own module so the logic can be
// unit-tested without importing the whole admin router.
//
// Shapes:
//   'raf-asset'          — subject IS an RAF asset (default)
//   'raf-asset-historic' — subject was an RAF asset, frame in its era
//   'actor'              — foreign / non-state leader
//   'threat'             — adversary capability
//   'treaty'             — treaty / alliance / agreement
//   'region-or-ally'     — region or partner nation / alliance

function getBriefShape({ category, subcategory, historic } = {}) {
  if (category === 'Actors') {
    if (subcategory === 'Historic RAF Personnel') return 'raf-asset-historic';
    return 'actor';
  }
  if (category === 'Threats')  return 'threat';
  if (category === 'Treaties') return 'treaty';
  if (category === 'AOR' || category === 'Allies') return 'region-or-ally';
  if (historic) return 'raf-asset-historic';
  const sub = subcategory || '';
  if (category === 'Missions'  && /World War|Post-War/.test(sub))     return 'raf-asset-historic';
  if (category === 'Aircrafts' && sub.startsWith('Historic'))          return 'raf-asset-historic';
  if (category === 'Squadrons' && sub === 'Historic')                  return 'raf-asset-historic';
  if (category === 'Bases'     && sub === 'UK Former')                 return 'raf-asset-historic';
  return 'raf-asset';
}

// Identity-sentence spec used as the subtitle field in every brief JSON shape.
// Supersedes "one factual sentence summarising the subject" — that wording caused
// Sonar to emit disclaimers like "No verifiable connection exists between Ali
// Khamenei and the RAF" for non-RAF subjects.
const SUBTITLE_SPEC = '"subtitle": "one factual identity sentence about the subject — who or what they are (role, position, organisation, region, nationality, dates, or equivalent defining context). Do NOT mention the RAF unless the subject is itself an RAF asset. Do NOT justify or deny any RAF connection. Do NOT evaluate relevance."';

function buildTopicUserGuidance(shape) {
  switch (shape) {
    case 'actor':
      return 'Using verified facts from published sources, produce a reference-style dossier on this named individual. Cover: position held and current title, appointment date and route to the role, chain of command and institutional authority, the forces / organisation / region they command or influence, notable operational decisions or actions, and their relevance to UK defence situational awareness. Do not force a direct RAF connection if none is documented — focus on who they are and what they control.';
    case 'threat':
      return 'Using verified facts from published sources, produce a reference-style threat assessment. Cover: origin and operator, technical specifications that matter operationally (range, speed, payload, seeker type where relevant), typical employment doctrine, and UK / NATO counter-response — which aircraft, weapons, tactics, or bases counter or mitigate it. Where no specific counter is documented, describe operational impact instead. Keep the focus on what a junior officer would need to recognise and respond to.';
    case 'treaty':
      return 'Using verified facts from published sources, produce a reference-style entry on this treaty, alliance, or agreement. Cover: signatories, date of signing, core obligations (especially mutual defence or basing / overflight rights), enforcement or triggering mechanism, current status, and specific UK implications — what RAF posture, basing, overflight rights, or operations this treaty enables or constrains.';
    case 'region-or-ally':
      return 'Using verified facts from published sources, produce a reference-style brief on this region or alliance. Cover: composition, membership, or geography — key states, forces, or locations within it, recent operational activity, and UK / RAF operational footprint or cooperation in this region — bases, deployments, exercises, or standing commitments where documented.';
    case 'raf-asset-historic':
      return 'Using verified facts from published sources, produce a reference-style brief suitable for someone building foundational knowledge of RAF history. Where relevant, cover: the subject\'s service era, the units, bases, and aircraft associated with it during its active period, key operations it participated in, and its legacy within the RAF. Frame everything in its era — not as modern-day operational context.';
    case 'raf-asset':
    default:
      return 'Using verified facts from published sources, produce a reference-style brief suitable for someone building foundational knowledge of the modern RAF — not a news story, but an in-depth informative overview. Where relevant, cover: training pathways and which training blocks/phases apply to this subject; RAF bases associated with this subject and which aircraft or squadrons are stationed there and what operations occur there; roles that interact with or are defined by this subject and how those roles relate to specific training pipelines; and the broader operational and modern-day RAF significance.';
  }
}

// strict=true  → generate-brief:      EXACTLY 4 sections, 220-word cap, "Section N" labels
// strict=false → generateBriefContent: 2–4 sections,       240-word cap, "Paragraph N" labels
function buildDescriptionSectionsSpec({ strict = true, shape = 'raf-asset' } = {}) {
  const label = strict ? 'Section' : 'Paragraph';
  const s4Omit = strict ? '' : ' (only include if genuinely needed — omit if not)';
  const s4BlindRule = 'CRITICAL: do NOT mention the subject\'s name, title, designation, or any unique identifier that would immediately reveal what this brief is about. The summary must be specific enough that a reader given a short list of 4–5 candidates could identify the correct one, but it must not name the subject directly.';

  let s1Intro, s2, s3, s4Focus;
  switch (shape) {
    case 'actor':
      s1Intro = 'Introduce the individual clearly for someone building situational awareness of the modern operating environment.';
      s2      = 'Position held, appointment date, route to the role, predecessors, and chain of command or institutional authority.';
      s3      = 'Forces, organisation, or region they command or influence — capability, remit, and geographic scope of their authority.';
      s4Focus = 'this individual\'s relevance to UK defence situational awareness (broader operating environment, not a forced RAF connection)';
      break;
    case 'threat':
      s1Intro = 'Introduce the threat clearly for someone building situational awareness of the modern operating environment.';
      s2      = 'Technical capability and typical employment doctrine — origin, operator, specifications that matter operationally, and how the threat is used.';
      s3      = 'UK / NATO counter-response where documented — aircraft, weapons, tactics, or bases that counter or mitigate it. Where no specific counter is documented, describe operational impact instead.';
      s4Focus = 'this threat\'s significance to UK / NATO air operations';
      break;
    case 'treaty':
      s1Intro = 'Introduce the treaty, alliance, or agreement clearly for someone building foundational knowledge of UK defence posture.';
      s2      = 'Signatories, date of signing, core obligations (especially mutual defence or basing / overflight rights), and enforcement or triggering mechanism.';
      s3      = 'UK implications and what RAF posture, basing, overflight rights, or operations this treaty enables or constrains. Current status.';
      s4Focus = 'this treaty\'s role in UK defence posture and RAF operational reach';
      break;
    case 'region-or-ally':
      s1Intro = 'Introduce this region or alliance clearly for someone building foundational knowledge of the modern operating environment.';
      s2      = 'Composition, membership, or geography — what the subject encompasses, key states / forces / locations within it, and recent operational activity.';
      s3      = 'UK / RAF operational footprint or cooperation — bases, deployments, exercises, or standing commitments in this region or alliance where documented.';
      s4Focus = 'this region or alliance\'s relevance to UK / RAF operational posture';
      break;
    case 'raf-asset-historic':
      s1Intro = 'Introduce the subject clearly for someone building foundational knowledge of RAF history.';
      s2      = 'Cover a different angle from its service era: roles, bases, or units associated with this subject during its active period.';
      s3      = 'Operational context and significance during its service — key operations, capabilities, or legacy in RAF history.';
      s4Focus = 'this subject\'s role and historical significance within the RAF';
      break;
    case 'raf-asset':
    default:
      s1Intro = 'Introduce the subject clearly for someone building foundational knowledge of the modern RAF.';
      s2      = 'Cover a different angle: training phases, roles, or bases associated with this subject.';
      s3      = 'Operational context, key capabilities, or RAF significance.';
      s4Focus = 'this subject\'s role and significance within the modern RAF';
      break;
  }

  const array = [
    `"${label} 1 — 50–80 words. Use clear, well-structured text. ${s1Intro}"`,
    `"${label} 2 — 50–80 words. ${s2}"`,
    `"${label} 3 — 50–80 words. ${s3}"`,
    `"${label} 4 — 1–2 sentences only${s4Omit}. A concise summary of ${s4Focus}. ${s4BlindRule}"`,
  ].join(',\n    ');

  const countRule = strict
    ? 'descriptionSections must be a JSON array of EXACTLY 4 strings — no more, no fewer. Total word count across sections 1–3 must not exceed 220 words.'
    : 'descriptionSections must be a JSON array of 2–4 strings. Total word count across all sections must not exceed 240 words.';

  const sharedRuleTail = 'Section 4 must be 1–2 sentences and must not contain the subject\'s name or any unique identifier. Write each section as readable prose or formatted text. IMPORTANT: when listing multiple items (features, roles, bases, capabilities, etc.) put each item on its own line using \\n escape sequences inside the JSON string, with each item prefixed by "- " (e.g. "Intro sentence:\\n- Item one\\n- Item two\\n- Item three"). Use "1." prefixes for ordered steps. Never use markdown bold/italic or headers. Plain prose is fine for flowing narrative — only use the list format when genuinely listing discrete items. DATE FORMAT: any dates written in prose must use UK format — day before month — e.g. "3rd March 2026" or "14 January 2025", never "March 3rd 2026" or "January 14, 2025".';

  return { array, countRule, sharedRuleTail };
}

module.exports = {
  getBriefShape,
  SUBTITLE_SPEC,
  buildTopicUserGuidance,
  buildDescriptionSectionsSpec,
};

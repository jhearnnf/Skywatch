// Where a user is, at country level, from the two signals the heartbeat
// carries: the country Vercel's edge worked out from their IP address (echoed
// back to the client by api/geo.js) and the IANA timezone their device reports.
//
// Neither is trusted alone. An IP places a VPN user in the wrong country and a
// holidaymaker in the right one for the wrong reason; a timezone is set by the
// device and follows the person home. The two disagreeing is itself the
// interesting fact, so it is kept rather than smoothed over — see
// resolveCountry() for the rule.
//
// Everything here comes straight off the wire and ends up rendered in Admin ›
// Users, so each value is pattern-checked and anything odd is dropped, never
// stored. Only the derived country is ever kept: the IP address itself is not.

const COUNTRY_PATTERN  = /^[A-Z]{2}$/;
const TIMEZONE_PATTERN = /^[A-Za-z][A-Za-z0-9_+-]*(\/[A-Za-z0-9_+-]+){0,2}$/;
const LANGUAGE_PATTERN = /^[A-Za-z]{2,3}(-[A-Za-z0-9]{1,8})*$/;

// IANA zone → ISO 3166-1 alpha-2. Deliberately a curated list rather than a
// dependency: the zones that cover the audiences we actually serve (UK, the
// Commonwealth air forces, Europe, North America) plus the bases and expat
// spots that show up. A zone missing from here simply gives no corroboration
// and the IP answer stands on its own.
//
// The Crown dependencies map to GB on purpose — someone in Jersey applying to
// the RAF is in the UK market for every question this data answers.
const TZ_COUNTRY = {
  'Europe/London': 'GB', 'Europe/Belfast': 'GB',
  'Europe/Jersey': 'GB', 'Europe/Guernsey': 'GB', 'Europe/Isle_of_Man': 'GB',
  'Europe/Gibraltar': 'GI', 'Atlantic/Stanley': 'FK', 'Atlantic/Bermuda': 'BM',
  'Asia/Nicosia': 'CY', 'Asia/Famagusta': 'CY', 'Europe/Nicosia': 'CY',
  'Indian/Diego_Garcia': 'IO', 'Atlantic/South_Georgia': 'GS',
  'Europe/Dublin': 'IE',

  'Pacific/Auckland': 'NZ', 'Pacific/Chatham': 'NZ',

  'America/Toronto': 'CA', 'America/Montreal': 'CA', 'America/Vancouver': 'CA',
  'America/Edmonton': 'CA', 'America/Calgary': 'CA', 'America/Winnipeg': 'CA',
  'America/Regina': 'CA', 'America/Halifax': 'CA', 'America/St_Johns': 'CA',
  'America/Moncton': 'CA', 'America/Yellowknife': 'CA', 'America/Whitehorse': 'CA',
  'America/Iqaluit': 'CA', 'America/Dawson': 'CA', 'America/Inuvik': 'CA',
  'America/Glace_Bay': 'CA', 'America/Goose_Bay': 'CA', 'America/Thunder_Bay': 'CA',
  'America/Nipigon': 'CA', 'America/Rainy_River': 'CA', 'America/Swift_Current': 'CA',
  'America/Cambridge_Bay': 'CA', 'America/Rankin_Inlet': 'CA', 'America/Resolute': 'CA',
  'America/Fort_Nelson': 'CA', 'America/Dawson_Creek': 'CA', 'America/Creston': 'CA',
  'America/Atikokan': 'CA', 'America/Blanc-Sablon': 'CA', 'America/Pangnirtung': 'CA',

  'America/New_York': 'US', 'America/Chicago': 'US', 'America/Denver': 'US',
  'America/Phoenix': 'US', 'America/Los_Angeles': 'US', 'America/Anchorage': 'US',
  'America/Detroit': 'US', 'America/Boise': 'US', 'America/Juneau': 'US',
  'America/Sitka': 'US', 'America/Nome': 'US', 'America/Adak': 'US',
  'America/Menominee': 'US', 'America/Metlakatla': 'US', 'America/Yakutat': 'US',
  'Pacific/Honolulu': 'US', 'Pacific/Guam': 'GU',

  'Europe/Paris': 'FR', 'Europe/Berlin': 'DE', 'Europe/Busingen': 'DE',
  'Europe/Madrid': 'ES', 'Atlantic/Canary': 'ES', 'Africa/Ceuta': 'ES',
  'Europe/Rome': 'IT', 'Europe/Amsterdam': 'NL', 'Europe/Brussels': 'BE',
  'Europe/Lisbon': 'PT', 'Atlantic/Madeira': 'PT', 'Atlantic/Azores': 'PT',
  'Europe/Zurich': 'CH', 'Europe/Vienna': 'AT', 'Europe/Stockholm': 'SE',
  'Europe/Oslo': 'NO', 'Europe/Copenhagen': 'DK', 'Atlantic/Faroe': 'FO',
  'Europe/Helsinki': 'FI', 'Europe/Warsaw': 'PL', 'Europe/Prague': 'CZ',
  'Europe/Athens': 'GR', 'Europe/Budapest': 'HU', 'Europe/Bucharest': 'RO',
  'Europe/Sofia': 'BG', 'Europe/Kyiv': 'UA', 'Europe/Kiev': 'UA',
  'Europe/Istanbul': 'TR', 'Europe/Malta': 'MT', 'Europe/Luxembourg': 'LU',
  'Europe/Bratislava': 'SK', 'Europe/Ljubljana': 'SI', 'Europe/Zagreb': 'HR',
  'Europe/Belgrade': 'RS', 'Europe/Sarajevo': 'BA', 'Europe/Skopje': 'MK',
  'Europe/Tirane': 'AL', 'Europe/Podgorica': 'ME', 'Europe/Vilnius': 'LT',
  'Europe/Riga': 'LV', 'Europe/Tallinn': 'EE', 'Atlantic/Reykjavik': 'IS',
  'Europe/Monaco': 'MC', 'Europe/Andorra': 'AD', 'Europe/Vaduz': 'LI',
  'Europe/Chisinau': 'MD', 'Europe/Minsk': 'BY', 'Europe/Moscow': 'RU',
  'Europe/Kaliningrad': 'RU', 'Europe/Samara': 'RU',

  'Asia/Dubai': 'AE', 'Asia/Qatar': 'QA', 'Asia/Bahrain': 'BH',
  'Asia/Kuwait': 'KW', 'Asia/Muscat': 'OM', 'Asia/Riyadh': 'SA',
  'Asia/Jerusalem': 'IL', 'Asia/Tel_Aviv': 'IL', 'Asia/Amman': 'JO',
  'Asia/Beirut': 'LB', 'Asia/Baghdad': 'IQ', 'Asia/Tehran': 'IR',
  'Asia/Singapore': 'SG', 'Asia/Hong_Kong': 'HK', 'Asia/Tokyo': 'JP',
  'Asia/Seoul': 'KR', 'Asia/Kolkata': 'IN', 'Asia/Calcutta': 'IN',
  'Asia/Karachi': 'PK', 'Asia/Dhaka': 'BD', 'Asia/Colombo': 'LK',
  'Asia/Kathmandu': 'NP', 'Asia/Bangkok': 'TH', 'Asia/Kuala_Lumpur': 'MY',
  'Asia/Manila': 'PH', 'Asia/Jakarta': 'ID', 'Asia/Shanghai': 'CN',
  'Asia/Taipei': 'TW', 'Asia/Ho_Chi_Minh': 'VN', 'Asia/Saigon': 'VN',
  'Asia/Brunei': 'BN', 'Asia/Kabul': 'AF', 'Asia/Tashkent': 'UZ',

  'Africa/Johannesburg': 'ZA', 'Africa/Nairobi': 'KE', 'Africa/Lagos': 'NG',
  'Africa/Cairo': 'EG', 'Africa/Accra': 'GH', 'Africa/Casablanca': 'MA',
  'Africa/Algiers': 'DZ', 'Africa/Tunis': 'TN', 'Africa/Addis_Ababa': 'ET',
  'Africa/Kampala': 'UG', 'Africa/Dar_es_Salaam': 'TZ', 'Africa/Harare': 'ZW',
  'Africa/Lusaka': 'ZM', 'Africa/Windhoek': 'NA', 'Africa/Maputo': 'MZ',
  'Africa/Freetown': 'SL', 'Indian/Mauritius': 'MU',

  'America/Mexico_City': 'MX', 'America/Sao_Paulo': 'BR', 'America/Bogota': 'CO',
  'America/Lima': 'PE', 'America/Santiago': 'CL', 'America/Caracas': 'VE',
  'America/Jamaica': 'JM', 'America/Barbados': 'BB', 'America/Nassau': 'BS',
  'America/Cayman': 'KY', 'America/Port_of_Spain': 'TT', 'America/Puerto_Rico': 'PR',
  'America/Tortola': 'VG', 'America/Anguilla': 'AI', 'America/Montserrat': 'MS',
  'America/Grand_Turk': 'TC', 'America/Belize': 'BZ', 'America/Panama': 'PA',
  'America/Costa_Rica': 'CR', 'America/Guatemala': 'GT',
};

// Whole zone families that belong to one country, so a zone we never listed
// (Australia has a dozen) still resolves.
const TZ_PREFIX_COUNTRY = [
  ['Australia/', 'AU'],
  ['Antarctica/Macquarie', 'AU'],
  ['America/Indiana/', 'US'],
  ['America/Kentucky/', 'US'],
  ['America/North_Dakota/', 'US'],
  ['America/Argentina/', 'AR'],
];

function countryFromTimeZone(tz) {
  if (!tz) return null;
  if (TZ_COUNTRY[tz]) return TZ_COUNTRY[tz];
  const hit = TZ_PREFIX_COUNTRY.find(([prefix]) => tz.startsWith(prefix));
  return hit ? hit[1] : null;
}

// Normalises a client-supplied `{ country, timeZone, language }` payload.
// `country` is what api/geo.js echoed from Vercel's IP lookup; the other two
// are what the device says about itself. Returns null when nothing in it is
// usable — a bad payload must never prevent the heartbeat from recording
// presence.
function sanitiseGeoInfo(raw) {
  if (!raw || typeof raw !== 'object') return null;

  const country  = String(raw.country ?? '').trim().toUpperCase();
  const timeZone = String(raw.timeZone ?? '').trim();
  const language = String(raw.language ?? '').trim();

  const out = {
    ipCountry: COUNTRY_PATTERN.test(country) ? country : null,
    timeZone:  timeZone.length <= 64 && TIMEZONE_PATTERN.test(timeZone) ? timeZone : null,
    language:  language.length <= 35 && LANGUAGE_PATTERN.test(language) ? language : null,
  };
  return out.ipCountry || out.timeZone || out.language ? out : null;
}

// Which country to write down, given the IP's answer, the device's timezone
// and what was stored last time.
//
//   - Both agree, or only one is known: take it (IP preferred when both exist).
//   - They disagree: the timezone is set by the device and stays put when the
//     person travels or tunnels, so on first contact it wins over the IP. After
//     that the stored answer is kept rather than flipped by every VPN session,
//     and `mismatch` is raised so the admin panel can show both.
//   - Nothing known: null, and the caller leaves the stored country alone.
//
// `previous` is the stored `{ country, source }`, if any.
function resolveCountry({ ipCountry, timeZone, previous }) {
  const tzCountry = countryFromTimeZone(timeZone);

  if (ipCountry && tzCountry && ipCountry !== tzCountry) {
    if (previous?.country) {
      return { country: previous.country, source: previous.source ?? 'ip', mismatch: true };
    }
    return { country: tzCountry, source: 'timezone', mismatch: true };
  }
  if (ipCountry) return { country: ipCountry, source: 'ip', mismatch: false };
  if (tzCountry) return { country: tzCountry, source: 'timezone', mismatch: false };
  return null;
}

module.exports = { COUNTRY_PATTERN, countryFromTimeZone, sanitiseGeoInfo, resolveCountry };

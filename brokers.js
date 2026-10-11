/**
 * brokers.js - data broker opt-out definitions
 *
 * Each entry describes one broker and HOW to automate its opt-out.
 *
 * method:
 *   'search-form'  - search for the person, extract listing URL, submit opt-out
 *   'direct-form'  - go straight to the opt-out URL and fill the form
 *   'email'        - send a removal-request email
 *   'manual'       - too complex to automate; added to the printed manual list
 *
 * captchaLikely    - true = pre-attempt CapSolver before submit
 * priority         - 1 = highest (most commonly searched / highest risk)
 * timeoutMs        - optional per-broker navigation timeout in ms (default: 15000)
 *
 * No personal info lives here - all values come from config.json at runtime.
 */

const _fs = require('fs');

let _cachedConfig = null;
function _getConfig() {
  if (_cachedConfig) return _cachedConfig;

  // Go through lib/config.js loadConfig() so an encrypted config works. A bare
  // require('./config.json') returns nothing once --encrypt-config has moved the
  // PII into config.json.enc, which used to blank every value interpolated below
  // and silently disable the whole browser opt-out path.
  //
  // loadConfig() calls process.exit(1) when no config exists at all, so only
  // call it once a config file is actually present: requiring this module must
  // stay safe on a fresh clone (setup, --list, the test suite).
  try {
    const { loadConfig, CONFIG_PATH, CONFIG_ENC_PATH } = require('./lib/config');
    if (_fs.existsSync(CONFIG_ENC_PATH) || _fs.existsSync(CONFIG_PATH)) {
      _cachedConfig = loadConfig();
      return _cachedConfig;
    }
  } catch (_) {
    // Missing lib/, unreadable envelope, or no passphrase. watcher.js reports
    // the real error on its own loadConfig() call; fall through so requiring
    // broker metadata never throws.
  }

  try {
    _cachedConfig = require('./config.json');
  } catch (_) {
    _cachedConfig = { person: {}, persons: [], email: {} };
  }
  return _cachedConfig;
}

const config = new Proxy({}, {
  get(_, prop) { return _getConfig()[prop]; },
});

/**
 * The person whose values the default export is built from.
 *
 * `config.person` is the historical single-person key. `config.persons` is the
 * multi-person format that lib/config.js getPersonsFromConfig() prefers; a
 * config using only `persons` has no `config.person`, so without this fallback
 * every interpolated value below became `undefined` - search URLs read
 * "?q=undefined" and every formFields value was undefined.
 */
function _primaryPerson() {
  const cfg = _getConfig();
  if (cfg.person) return cfg.person;
  if (Array.isArray(cfg.persons) && cfg.persons.length > 0) return cfg.persons[0];
  return {};
}

// Never interpolate the literal string "undefined" into a URL or a form value.
// A missing field becomes empty, which fails a lookup honestly (notFound)
// instead of searching brokers for a person named "undefined".
const enc = s => encodeURIComponent(s == null ? '' : s);

/**
 * Build the broker list for one person.
 *
 * These values must be resolved per person, not once at module load: watcher.js
 * loops `for (const person of persons)` and each iteration needs that person's
 * own name, city, state, zip and email in the search URLs and form fields.
 * Baking them once meant person B's run submitted person A's PII to the broker.
 *
 * @param {object} [person]  defaults to _primaryPerson()
 * @returns {object[]} a fresh array of fresh broker objects
 */
function buildBrokers(person) {
  const p = person || _primaryPerson();
  // Coerce missing fields to '' up front. Not every interpolation site below
  // goes through enc(), so this is what guarantees no template ever renders the
  // literal string "undefined" into a broker URL or form value.
  const s = (v) => (v == null ? '' : String(v));
  const F = s(p.firstName), L = s(p.lastName), N = s(p.fullName);
  const ST = s(p.state), C = s(p.city), E = s(p.email), Z = s(p.zip);

  return [

  // ═══ California residents only ═══
  {
    name: 'California DROP',
    method: 'manual',
    optOutUrl: 'https://privacy.ca.gov/drop/',
    states: ['CA'],
    priority: 1,
    notes: 'California DROP: one request reaches every data broker registered in California. Submit once at https://privacy.ca.gov/drop/',
  },

  // ═══ Priority 1 - High-traffic people-search sites ═══════════════════════

  {
    name: 'Spokeo',
    method: 'search-form',
    searchUrl: `https://www.spokeo.com/search?q=${enc(N)}&type=pp&state=${ST}`,
    listingPattern: /spokeo\.com\/[^/]+\/[^/]+\/[^/]+-p\d+/i,
    optOutUrl: 'https://www.spokeo.com/optout',
    formFields: { 'input[name="email"]': E },
    submitSelector: 'button[type="submit"],input[type="submit"]',
    captchaLikely: false,
    priority: 1,
    usOnly: true,
    expectedSender: 'optout@spokeo.com',
  },

  {
    name: 'WhitePages',
    method: 'search-form',
    searchUrl: `https://www.whitepages.com/name/${enc(F)}-${enc(L)}/${ST}`,
    listingPattern: /whitepages\.com\/people\//i,
    optOutUrl: 'https://www.whitepages.com/suppression-requests',
    formFields: { 'input[name="name"]': N, 'input[name="email"]': E },
    submitSelector: 'button[type="submit"]',
    captchaLikely: false,
    priority: 1,
    usOnly: true,
    expectedSender: 'noreply@whitepages.com',
  },

  {
    name: 'FastPeopleSearch',
    method: 'search-form',
    searchUrl: `https://www.fastpeoplesearch.com/name/${enc(F)}-${enc(L)}_${ST}`,
    listingPattern: /fastpeoplesearch\.com\/name\//i,
    optOutUrl: 'https://www.fastpeoplesearch.com/optout',
    formFields: { '#firstname': F, '#lastname': L, '#email': E, 'input[name="legal"]': 'on' },
    submitSelector: 'form button[type="submit"]',
    captchaLikely: true,
    priority: 1,
    usOnly: true,
  },

  {
    name: 'TruePeopleSearch',
    method: 'direct-form',
    optOutUrl: 'https://www.truepeoplesearch.com/removal',
    // Surveyed 2026-10-11. The page header has its own name search box, so
    // broad name selectors typed into that instead of the opt-out form.
    formFields: { '#FirstName': F, '#LastName': L, '#Email': E, '#AuthorizeContact': 'on' },
    submitSelector: 'button:has-text("Send Request")',
    captchaLikely: false,
    priority: 1,
    usOnly: true,
    expectedSender: 'noreply@truepeoplesearch.com',
  },

  {
    name: 'BeenVerified',
    method: 'manual',
    optOutUrl: 'https://www.beenverified.com/app/optout/search',
    priority: 1,
    usOnly: true,
    notes: 'Search your name and state at https://www.beenverified.com/app/optout/search, pick your own record from the results, then confirm with your alias email. The record has to be chosen by you.',
  },

  {
    name: 'PeopleConnect Suppression Center',
    method: 'manual',
    optOutUrl: 'https://suppression.peopleconnect.us/login',
    priority: 1,
    usOnly: true,
    notes: 'Intelius, TruthFinder and Instant Checkmate: sign in with your alias at https://suppression.peopleconnect.us/login, enter the emailed code, then suppress each record.',
  },

  {
    name: 'PeopleFinders',
    method: 'direct-form',
    optOutUrl: 'https://www.peoplefinders.com/opt-out',
    formFields: { 'input[name*="first" i]': F, 'input[name*="last" i]': L, 'input[type="email"]': E, 'input[name*="state" i]': ST },
    submitSelector: 'button[type="submit"],input[type="submit"]',
    captchaLikely: false,
    priority: 1,
    expectedSender: 'support@peoplefinders.com',
  },

  {
    name: 'MyLife',
    method: 'search-form',
    searchUrl: `https://www.mylife.com/find-people/results.pubview?searchtype=PEOPLE&firstname=${enc(F)}&lastname=${enc(L)}&state=${ST}`,
    listingPattern: /mylife\.com\/[^/]+\/[^/]+-\d+\.html/i,
    optOutUrl: 'https://www.mylife.com/privacyrequest',
    formFields: { 'input[type="email"]': E },
    submitSelector: 'button[type="submit"]',
    captchaLikely: true,
    priority: 1,
    expectedSender: 'support@mylife.com',
  },

  {
    name: 'FamilyTreeNow',
    method: 'direct-form',
    optOutUrl: 'https://www.familytreenow.com/optout',
    formFields: { '#FirstName': F, '#LastName': L, '#Email': E, '#AuthorizeContact': 'on' },
    submitSelector: 'button:has-text("Begin Privacy Request")',
    captchaLikely: true,
    priority: 1,
    expectedSender: 'noreply@familytreenow.com',
  },

  {
    name: 'CheckPeople',
    method: 'direct-form',
    // Their /opt-out page redirects - use the search-based removal flow instead
    optOutUrl: `https://checkpeople.com/opt-out?firstName=${enc(F)}&lastName=${enc(L)}&state=${ST}`,
    formFields: { 'input[name*="first" i]': F, 'input[name*="last" i]': L, 'input[type="email"]': E, 'select[name*="state" i]': ST },
    submitSelector: 'button[type="submit"]',
    captchaLikely: false,
    priority: 2,
  },

  // ═══ Priority 2 - Additional people-search sites ══════════════════════════

  {
    name: 'ThatsThem',
    method: 'direct-form',
    optOutUrl: 'https://thatsthem.com/optout',
    formFields: { 'input[name*="name" i]': N, 'input[name*="email" i]': E },
    submitSelector: 'button[type="submit"]',
    captchaLikely: false,
    priority: 2,
    // No SSN/DOB gate - safe to submit arbitrary name/email for noise mode
    acceptsBogus: true,
  },

  {
    name: 'USPhonebook',
    method: 'direct-form',
    optOutUrl: 'https://www.usphonebook.com/removal',
    formFields: { '#subject-firstname': F, '#subject-lastname': L, '#subject-email': E, '#agreement': 'on' },
    submitSelector: 'button:has-text("Begin Removal Process")',
    captchaLikely: true,
    priority: 2,
    usOnly: true,
  },

  {
    name: 'SmartBackgroundChecks',
    method: 'direct-form',
    optOutUrl: 'https://www.smartbackgroundchecks.com/remove',
    formFields: { '#subject_fn': F, '#subject_ln': L, '#subject_email': E, '#confirm_authorize': 'on' },
    submitSelector: 'form button:has-text("Submit")',
    captchaLikely: true,
    priority: 2,
  },

  {
    name: 'SearchPeopleFree',
    method: 'direct-form',
    optOutUrl: 'https://www.searchpeoplefree.com/opt-out',
    formFields: { '#o_first': F, '#o_last': L, '#o_email': E, '#o_terms': 'on' },
    submitSelector: 'button:has-text("Begin removal process")',
    captchaLikely: true,
    priority: 2,
    // No SSN/DOB gate - safe to submit arbitrary name/email for noise mode
    acceptsBogus: true,
  },

  {
    name: 'PeopleSearchNow',
    method: 'direct-form',
    optOutUrl: 'https://www.peoplesearchnow.com/opt-out',
    formFields: { '#subject-firstname': F, '#subject-lastname': L, '#subject-email': E, '#agreement': 'on' },
    submitSelector: 'button:has-text("Begin Removal Process")',
    captchaLikely: true,
    priority: 2,
    // No SSN/DOB gate - safe to submit arbitrary name/email for noise mode
    acceptsBogus: true,
  },

  {
    name: 'InfoTracer',
    method: 'manual',
    optOutUrl: 'https://infotracer.com/optout/',
    priority: 2,
    // No SSN/DOB gate - safe to submit arbitrary name/email for noise mode
    acceptsBogus: true,
    notes: 'The page asks you to prove you are human first: https://infotracer.com/optout/',
  },

  {
    name: 'SocialCatfish',
    method: 'direct-form',
    optOutUrl: 'https://socialcatfish.com/opt-out/?id=request_optout',
    formFields: { '#ccpa_state': ST, '#first-name': F, '#last-name': L, '#email': E },
    submitSelector: 'button:has-text("Submit Now")',
    captchaLikely: true,
    priority: 2,
  },

  {
    name: 'NationalPublicData',
    method: 'manual',
    optOutUrl: 'https://nationalpublicdata.com/optout.html',
    priority: 2,
    notes: 'Search for yourself on the site, copy your profile link, and paste it into "Your Profile Link" at https://nationalpublicdata.com/optout.html',
  },

  {
    name: 'PrivateRecords',
    method: 'direct-form',
    optOutUrl: 'https://www.privaterecords.net/api/helper/optOutLight/search',
    // The form also asks for a date of birth, which the tool does not hold;
    // without it the site refuses the request and it shows up as not submitted.
    formFields: { '#r-removal': 'on', '#first': F, '#last': L, '#city': C, '#zip': Z, '#state': ST, '#contact-email': E },
    submitSelector: '#submit-btn',
    captchaLikely: false,
    priority: 2,
  },

  // ═══ Priority 1 - Major upstream aggregators ══════════════════════════════
  // These feed many smaller sites - highest leverage opt-outs

  {
    name: 'Acxiom',
    method: 'manual',
    optOutUrl: 'https://www.acxiom.com/optout/',
    priority: 1,
    notes: 'The opt-out form is embedded from isapps.acxiom.com and cannot be automated: https://www.acxiom.com/optout/',
  },

  {
    name: 'LexisNexis',
    method: 'manual',
    optOutUrl: 'https://consumer.risk.lexisnexis.com/opt',
    priority: 1,
    notes: 'Multi-step request portal: https://consumer.risk.lexisnexis.com/opt',
  },

  {
    name: 'ZoomInfo',
    method: 'manual',
    optOutUrl: 'https://www.zoominfo.com/trust-center/your-privacy',
    priority: 1,
    notes: 'The old opt-out page is gone (404). Request deletion on the privacy page: https://www.zoominfo.com/trust-center/your-privacy',
  },

  {
    name: 'Clearbit',
    method: 'manual',
    optOutUrl: 'https://clearbit.com/privacy-policy',
    priority: 1,
    notes: 'The opt-out page is gone (404); the privacy policy says how to ask for deletion: https://clearbit.com/privacy-policy',
  },

  // ═══ Additional people-search / data broker sites ════════════════════════

  {
    name: 'Addresses.com',
    method: 'manual',
    optOutUrl: 'https://www.addresses.com/',
    priority: 2,
    notes: 'The old opt-out page is gone (404). Look for a privacy or opt-out link at https://www.addresses.com/',
  },

  {
    name: 'Spokeo (email)',
    method: 'email',
    emailTo: 'privacy@spokeo.com',
    priority: 2,
  },

  {
    name: 'Epsilon',
    method: 'manual',
    optOutUrl: 'https://legal.epsilon.com/dsr',
    priority: 2,
    notes: 'The request form has a CAPTCHA and multi-select fields: https://legal.epsilon.com/dsr',
  },

  {
    name: 'OptOutPrescreen (credit bureaus)',
    method: 'manual',
    optOutUrl: 'https://www.optoutprescreen.com/',
    priority: 2,
    usOnly: true,
    notes: 'Equifax, Experian, TransUnion and Innovis prescreened offers: opt out for 5 years online at https://www.optoutprescreen.com/ (permanent needs a signed form).',
  },

  {
    name: 'DataAxle',
    method: 'manual',
    optOutUrl: 'https://www.data-axle.com/privacy-rights-request/',
    priority: 2,
    notes: 'Use the Consumer Privacy Rights Request form: https://www.data-axle.com/privacy-rights-request/ (the email box on their privacy page is a newsletter signup, not an opt-out).',
  },

  // ═══ Email-based opt-outs ═════════════════════════════════════════════════

  {
    name: 'Pipl',
    method: 'email',
    emailTo: 'privacy@pipl.com',
    priority: 2,
  },

  // ═══ Manual-only (requires human interaction) ═════════════════════════════

  {
    name: 'Google - Results About You',
    method: 'manual',
    optOutUrl: 'https://myaccount.google.com/data-and-privacy',
    notes: 'Use "Results about you" to flag address/phone in search results.',
    priority: 1,
  },

  {
    name: 'Google - Outdated Content',
    method: 'manual',
    optOutUrl: 'https://search.google.com/search-console/remove-outdated-content',
    notes: 'Submit if any cached pages show your personal info.',
    priority: 3,
  },

  ];
}

// Default export stays an array so every existing `require('./brokers')` call
// site keeps working unchanged. `.forPerson(person)` is the per-person build
// used by watcher.js inside its persons loop.
const brokers = buildBrokers();
brokers.forPerson = buildBrokers;

module.exports = brokers;

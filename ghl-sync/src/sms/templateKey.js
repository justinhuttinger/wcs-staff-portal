const crypto = require('node:crypto');

// Identity for an automated SMS.
//
// GHL puts no workflow id or name on a message (verified 2026-08-19), so the
// body text is the only thing distinguishing one automation's text from
// another's. This normalizes away the per-recipient parts — merged first
// name, tracking links, phone numbers, times, staff name, whitespace — so
// every send of one template hashes to the same key.
//
// A copy edit produces a NEW key by design. sms_templates.label exists so an
// edited template can be given the same human label and stay grouped.
//
// Validated 2026-08-19 against a one-day, 1,450-message, all-location
// production sample (measured before this normalizer rewrite, so the exact
// figures will shift slightly): the original greeting-only rule (which only
// stripped a merged name when it followed "Hi/Hey/Hello") produced 982
// distinct "templates" — nearly one per message, because a large share of
// WCS templates open with the bare merged name and no greeting word
// ("Vickie, tried you again...", "Michael! Just called..."). A blanket
// punctuation-anchored rewrite fixed that (195 clusters) but introduced a new
// bug in the other direction: it merged templates that happen to share a
// leading "Word[,!]" shape regardless of what that word was ("Congrats!" and
// "Welcome!" both stripped down to the same remaining sentence), and it could
// walk past real template content to find punctuation several words in
// ("Your trial starts today, Michael!" stripped "Your trial starts today,").
//
// This version strips a leading personalization only when it is confidently
// personalization: an optional greeting word plus a following capitalized
// name token, or one-to-two LEADING capitalized tokens immediately followed
// by "," or "!" and not found on a stoplist of common non-name openers. That
// keeps "Congrats!"/"Welcome!" and "Last chance!"/"Today only!" distinct,
// still strips bare-name opens like "Vickie, tried you again" and
// "Hey Michael we tried calling you today...", and stops walking past real
// content to find punctuation that isn't actually part of a personalization.

const MAX_CHARS = 160;

// Common non-name openers. A name is virtually never one of these words, and
// several WCS templates intentionally open with one of them before real
// content ("Congrats! You are officially a member...", "Last chance! Our
// summer sale ends tonight"). Stripping these would over-merge templates that
// are meant to stay distinct. Matched case-insensitively against the leading
// one or two tokens.
const OPENER_STOPLIST = new Set([
  'congrats', 'congratulations', 'welcome', 'thanks', 'thank you',
  'reminder', 'urgent', 'heads up', 'last chance', 'today only',
  'good news', 'bad news', 'attention', 'oh no', 'yes', 'no', 'ok', 'okay',
  'team',
]);

// Small brand/common-word stoplist for the trailing-name rule (see
// stripTrailingNameBeforePunct below). Real WCS copy routinely ends its
// first sentence on one of these ("...to West Coast Strength.", "...gym is
// OPEN!"), and they must never be mistaken for a merged name.
const BRAND_STOPLIST = new Set([
  'strength', 'gym', 'today', 'tonight', 'now', 'here', 'open', 'wcs',
  'west', 'coast', 'family',
]);

const GREETING_RE = /^\s*(hi|hey|hello|good morning|good afternoon)\b[,!]*\s*/i;
// Unicode-aware: \p{Lu} matches any uppercase letter in any script (real
// production data includes names like "Фаина"), not just ASCII A-Z — an
// ASCII-only [A-Z] test would fail to strip those and reintroduce
// per-recipient clusters for non-Latin names.
//
// Captures ONE TO THREE capitalized tokens (people have two-word first
// names, hyphenated names, and occasionally a middle name — "Jon Michael",
// "Lindsay Belle"). The repeated group is optional and greedy, but each
// repetition still requires \p{Lu} on the NEXT token to continue, so on an
// unpunctuated body ("Hey Michael we tried calling...") it naturally
// backtracks down to just "Michael" once it hits the lowercase "we" — it
// does not walk into real sentence content.
const NAME_TOKEN_RE = /^((?:\p{Lu}[\p{L}'-]*\s+){0,2}\p{Lu}[\p{L}'-]*)[,!]*\s+/u;
const LEADING_TOKENS_RE = /^\s*(\p{L}[\p{L}'-]*)(?:\s+(\p{L}[\p{L}'-]*))?[,!]\s+/u;
const TRAILING_PUNCT_RE = /[.!?]/;
const TRAILING_WORD_RE = /(\p{L}[\p{L}'-]*)\s*$/u;
const isCapitalized = tok => /^\p{Lu}/u.test(tok);

// Case A helper: does the captured name phrase look like a real non-name
// opener rather than a name? Checked against the whole phrase and its first
// word, same as Case B below, so "Hey Team," doesn't lose "Team".
function isStoplistedOpener(nameTokens) {
  const lower = nameTokens.toLowerCase();
  if (OPENER_STOPLIST.has(lower)) return true;
  const firstWord = nameTokens.split(/\s+/)[0].toLowerCase();
  return OPENER_STOPLIST.has(firstWord);
}

// Strip a leading personalization from the ORIGINAL (not-yet-lowercased)
// body, so capitalization is still available to distinguish a real name from
// an ordinary sentence-initial word.
function stripLeadingPersonalization(body) {
  // Case A: an optional greeting word ("Hi", "Hey", "Hello", "Good morning",
  // "Good afternoon"), plus one to three following capitalized name tokens
  // if present. This is what restores the "Hey Michael we tried calling..."
  // shape — no comma or bang follows the name, so the punctuation-anchored
  // rule below never fires, but the greeting word itself is an unambiguous
  // signal.
  const greeting = body.match(GREETING_RE);
  if (greeting) {
    const rest = body.slice(greeting[0].length);
    const name = rest.match(NAME_TOKEN_RE);
    if (!name) return rest;
    if (isStoplistedOpener(name[1])) return rest;
    return rest.slice(name[0].length);
  }

  // Case B: one or two LEADING capitalized tokens immediately followed by
  // "," or "!", unless those tokens are a known non-name opener. Real names
  // in WCS's data are capitalized; ordinary sentence openers that precede a
  // comma/bang within the first two words are rare enough that the stoplist
  // covers the ones actually seen in production copy.
  const m = body.match(LEADING_TOKENS_RE);
  if (m) {
    const [full, t1, t2] = m;
    if (!isCapitalized(t1)) return body;
    const onePhrase = t1.toLowerCase();
    const twoPhrase = t2 ? `${t1} ${t2}`.toLowerCase() : null;
    if (OPENER_STOPLIST.has(onePhrase)) return body;
    if (twoPhrase && OPENER_STOPLIST.has(twoPhrase)) return body;
    return body.slice(full.length);
  }

  return body;
}

// Strip a capitalized token that sits immediately before the FIRST terminal
// punctuation ("!", ".", or "?") of the message, when it isn't a known
// stoplisted/brand word. Handles merge fields WCS drops mid-clause instead of
// up front — "Thank you for booking a tour with us Joshua!",
// "Happy Birthday MATTHEW!" — where no leading rule ever fires because the
// name isn't at the start. Runs on the (already leading-stripped) ORIGINAL
// body, before lowercasing, so ALL-CAPS names ("MATTHEW") still test
// positive for capitalization via their first letter.
function stripTrailingNameBeforePunct(body) {
  const idx = body.search(TRAILING_PUNCT_RE);
  if (idx === -1) return body;

  const prefix = body.slice(0, idx);
  const m = prefix.match(TRAILING_WORD_RE);
  if (!m) return body;

  const word = m[1];
  if (!isCapitalized(word)) return body;

  const lower = word.toLowerCase();
  if (OPENER_STOPLIST.has(lower) || BRAND_STOPLIST.has(lower)) return body;

  const start = m.index;
  return body.slice(0, start) + body.slice(start + word.length);
}

function stripPersonalization(body) {
  const leadingStripped = stripLeadingPersonalization(body);
  return stripTrailingNameBeforePunct(leadingStripped);
}

function normalizeBody(body) {
  if (typeof body !== 'string') return '';

  let s = stripPersonalization(body);
  s = s.toLowerCase();

  // Links: a tracking short link differs per recipient, and stripping it
  // before punctuation removal keeps its fragments from surviving as junk
  // words once the slashes/colons are gone.
  s = s.replace(/https?:\/\/\S+/g, ' ');

  // Generalize the staff name: "this is kenny from" and "this is steve from"
  // are the same template read by different salespeople. Collapse the token
  // right after "this is" to a constant placeholder. Note this also turns
  // "this is the team from ..." into "this is x team from ...", which stays
  // a DIFFERENT cluster from "this is x from ..." — correct, since one is a
  // location-open blast and the other is a 1:1 sales text.
  s = s.replace(/\bthis is \S+/g, 'this is x');

  // Every remaining non-letter, non-space character in one pass: digits
  // (phone numbers, times, dollar amounts, session counts), punctuation, and
  // emoji all collapse to a space together.
  s = s.replace(/[^a-z\s]/g, ' ');

  // Collapse whitespace runs (including the newlines GHL sends) to one space.
  s = s.replace(/\s+/g, ' ').trim();

  return s.slice(0, MAX_CHARS);
}

function templateKey(body) {
  const norm = normalizeBody(body);
  if (!norm) return null;
  return crypto.createHash('sha256').update(norm).digest('hex').slice(0, 16);
}

module.exports = { normalizeBody, templateKey, MAX_CHARS };

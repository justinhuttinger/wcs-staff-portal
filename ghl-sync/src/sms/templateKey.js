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
]);

const GREETING_RE = /^\s*(hi|hey|hello|good morning|good afternoon)\b[,!]*\s*/i;
// Unicode-aware: \p{Lu} matches any uppercase letter in any script (real
// production data includes names like "Фаина"), not just ASCII A-Z — an
// ASCII-only [A-Z] test would fail to strip those and reintroduce
// per-recipient clusters for non-Latin names.
const NAME_TOKEN_RE = /^(\p{Lu}\S*?)[,!]*\s+/u;
const LEADING_TOKENS_RE = /^\s*(\p{L}[\p{L}'-]*)(?:\s+(\p{L}[\p{L}'-]*))?[,!]\s+/u;
const isCapitalized = tok => /^\p{Lu}/u.test(tok);

// Strip a leading personalization from the ORIGINAL (not-yet-lowercased)
// body, so capitalization is still available to distinguish a real name from
// an ordinary sentence-initial word.
function stripLeadingPersonalization(body) {
  // Case A: an optional greeting word ("Hi", "Hey", "Hello", "Good morning",
  // "Good afternoon"), plus a following capitalized name token if present.
  // This is what restores the "Hey Michael we tried calling..." shape — no
  // comma or bang follows the name, so the punctuation-anchored rule below
  // never fires, but the greeting word itself is an unambiguous signal.
  const greeting = body.match(GREETING_RE);
  if (greeting) {
    const rest = body.slice(greeting[0].length);
    const name = rest.match(NAME_TOKEN_RE);
    return name ? rest.slice(name[0].length) : rest;
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

function normalizeBody(body) {
  if (typeof body !== 'string') return '';

  let s = stripLeadingPersonalization(body);
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

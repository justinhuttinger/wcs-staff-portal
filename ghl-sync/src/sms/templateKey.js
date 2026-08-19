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
// Validated 2026-08-19 against a one-day, 1,437-message, all-location
// production sample: the previous rule (which only stripped a merged name
// when it followed "Hi/Hey/Hello") produced 982 distinct "templates" — nearly
// one per message, because a large share of WCS templates open with the bare
// merged name and no greeting word ("Vickie, tried you again...",
// "Michael! Just called..."). This rule collapses that sample to 190
// clusters with no observed over-merging.

const MAX_CHARS = 160;

function normalizeBody(body) {
  if (typeof body !== 'string') return '';
  let s = body.toLowerCase();

  // Links first: a tracking short link differs per recipient, and stripping
  // it before punctuation removal keeps its fragments from surviving as junk
  // words once the slashes/colons are gone.
  s = s.replace(/https?:\/\/\S+/g, ' ');

  // Strip leading personalization: everything up to and including the first
  // "," or "!" within roughly the first four words. WCS templates open in
  // several different shapes — "Hi Andrea!", "Hey Angel,", a bare "Vickie,",
  // a bare "Michael!" — and all of them put the merged name (and nothing but
  // the merged name) before that first comma/bang. The outer group is
  // non-greedy so it stops at the EARLIEST qualifying punctuation rather than
  // swallowing extra words. This is deliberately broader than a greeting-only
  // rule: it also trims a leading "Today only!" from a template, which is
  // harmless since it happens identically for every send of that template.
  s = s.replace(/^\s*(?:\S+\s+){0,3}?\S*[,!]\s+/, '');

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

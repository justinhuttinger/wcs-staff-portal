const crypto = require('node:crypto');

// Identity for an automated SMS.
//
// GHL puts no workflow id or name on a message (verified 2026-08-19), so the
// body text is the only thing distinguishing one automation's text from
// another's. This normalizes away the per-recipient parts — merged first name,
// tracking links, phone numbers, times, whitespace — so every send of one
// template hashes to the same key.
//
// A copy edit produces a NEW key by design. sms_templates.label exists so an
// edited template can be given the same human label and stay grouped.

const MAX_CHARS = 160;

function normalizeBody(body) {
  if (typeof body !== 'string') return '';
  let s = body.toLowerCase();

  // Links first: a tracking short link differs per recipient.
  s = s.replace(/https?:\/\/\S+/g, ' ');

  // A leading greeting carries the merged first name. Keep the greeting word
  // (so "hey" and "hi" variants of a template stay distinct, which matches how
  // staff actually author them) and drop the token after it.
  s = s.replace(/^\s*(hi|hey|hello)\b[\s,!]+\S+/, '$1 ');

  // Every digit run: phone numbers, times, dollar amounts, session counts.
  s = s.replace(/\d+/g, ' ');

  // Collapse all punctuation and whitespace to single spaces.
  s = s.replace(/[^a-z\s]/g, ' ').replace(/\s+/g, ' ').trim();

  return s.slice(0, MAX_CHARS);
}

function templateKey(body) {
  const norm = normalizeBody(body);
  if (!norm) return null;
  return crypto.createHash('sha256').update(norm).digest('hex').slice(0, 16);
}

module.exports = { normalizeBody, templateKey, MAX_CHARS };

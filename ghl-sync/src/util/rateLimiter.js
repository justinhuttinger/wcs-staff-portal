// Convert a 429 `Retry-After` header into milliseconds. GHL sends integer
// seconds; the HTTP spec also allows an HTTP-date, so handle both. Returns null
// when unparseable (caller falls back to its own backoff), 0 for a past date.
function parseRetryAfter(headerVal, now = Date.now()) {
  if (headerVal == null) return null;
  const s = String(headerVal).trim();
  if (/^\d+$/.test(s)) return parseInt(s, 10) * 1000;
  const when = Date.parse(s);
  if (!Number.isNaN(when)) return Math.max(0, when - now);
  return null;
}

const realSleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Token bucket per key. Each credential (GHL location key, or the single shared
// ABC key) gets its own bucket, so concurrency across keys adds no rate pressure
// while each key stays under its own ceiling.
class RateLimiter {
  constructor({ capacity = 10, refillPerSec = 10, now = () => Date.now(), sleep = realSleep } = {}) {
    this.capacity = capacity;
    this.refillPerSec = refillPerSec;
    this.now = now;
    this.sleep = sleep;
    this.buckets = new Map(); // key -> { tokens, last, until }
    this.chains = new Map();  // key -> Promise (serializes acquire per key)
  }

  _bucket(key) {
    let b = this.buckets.get(key);
    if (!b) { b = { tokens: this.capacity, last: this.now(), until: 0 }; this.buckets.set(key, b); }
    return b;
  }

  _refill(b) {
    const t = this.now();
    const elapsed = (t - b.last) / 1000;
    if (elapsed > 0) {
      b.tokens = Math.min(this.capacity, b.tokens + elapsed * this.refillPerSec);
      b.last = t;
    }
  }

  // Block a key until now()+ms (e.g. after a 429 Retry-After) and zero its tokens.
  penalize(key, ms) {
    const b = this._bucket(key);
    const until = this.now() + ms;
    if (until > b.until) b.until = until;
    b.tokens = 0;
  }

  // Resolve once a token is available for `key`, consuming it. Per-key calls are
  // chained so two concurrent acquires can't both consume the last token.
  async acquire(key) {
    const prev = this.chains.get(key) || Promise.resolve();
    const run = prev.then(() => this._acquireOne(key), () => this._acquireOne(key));
    this.chains.set(key, run);
    return run;
  }

  async _acquireOne(key) {
    const b = this._bucket(key);
    const penaltyWait = b.until - this.now();
    if (penaltyWait > 0) await this.sleep(penaltyWait);
    while (true) {
      this._refill(b);
      if (b.tokens >= 1) { b.tokens -= 1; return; }
      const needMs = ((1 - b.tokens) / this.refillPerSec) * 1000;
      await this.sleep(Math.max(needMs, 1));
    }
  }
}

module.exports = { RateLimiter, parseRetryAfter };

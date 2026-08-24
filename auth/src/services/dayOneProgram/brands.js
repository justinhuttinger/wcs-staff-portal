'use strict'

// Day One programs ship under one of two brands. WCS is the default; ESAC
// (Eastside Athletic Club) is selected by a GHL custom field on the intake and
// is deliberately black-and-white — every accent that is WCS red becomes black.
const BRANDS = {
  wcs: {
    key: 'wcs',
    name: 'West Coast Strength',
    headline: 'WEST COAST STRENGTH',
    accent: '#E31E24',
    accentSoft: 'rgba(227,30,36,.35)',
    accentGlow: 'rgba(227,30,36,.12)',
    // Success/confirmation green on the trainer's build screen.
    success: '#2e7d32',
    successGlow: 'rgba(46,125,50,.12)',
    logoFile: 'logo.png',
    // Square badge: the header sits to its right, and the rule under the header
    // extends back across the logo gutter by this same width.
    logoWidth: 70,
    logoHeight: 70,
    headerOffset: 90,
    // Club name is appended for WCS ("West Coast Strength - Keizer").
    perClub: true,
  },
  esac: {
    key: 'esac',
    name: 'Eastside Athletic Club',
    headline: 'EASTSIDE ATHLETIC CLUB',
    accent: '#000000',
    accentSoft: 'rgba(0,0,0,.30)',
    accentGlow: 'rgba(0,0,0,.10)',
    // Black-and-white: even the success state drops the green.
    success: '#000000',
    successGlow: 'rgba(0,0,0,.10)',
    logoFile: 'logo-esac.png',
    // Wide wordmark (~4:1), so it needs more gutter than the WCS badge.
    logoWidth: 170,
    logoHeight: 42,
    headerOffset: 190,
    // ESAC is a single club, so the club name is never appended.
    perClub: false,
  },
}

const DEFAULT_BRAND = 'wcs'

function getBrand(key) {
  return BRANDS[String(key || '').toLowerCase()] || BRANDS[DEFAULT_BRAND]
}

const ESAC_PATTERN = /\b(esac|east\s?side)\b/i
// Only these fields decide the brand. Scanning every value would let a client's
// free-text answer ("I train at Eastside") silently rebrand the program.
const BRAND_KEY_PATTERN = /brand|esac|east\s?side|club|program\s*type/i
const TRUTHY = /^(yes|true|1|on|checked|esac|east\s?side)$/i

// Decide the brand from a GHL webhook body. Two shapes both work:
//   1. a field whose VALUE names the brand   -> { "Brand": "ESAC" }
//   2. a checkbox NAMED for the brand        -> { "ESAC": "Yes" }
function resolveBrandKey(body = {}) {
  for (const [rawKey, rawVal] of Object.entries(body)) {
    if (rawVal == null || typeof rawVal === 'object' && !Array.isArray(rawVal)) continue
    const key = String(rawKey)
    if (!BRAND_KEY_PATTERN.test(key)) continue
    const val = (Array.isArray(rawVal) ? rawVal.join(' ') : String(rawVal)).trim()
    if (!val) continue
    if (ESAC_PATTERN.test(val)) return 'esac'
    if (ESAC_PATTERN.test(key) && TRUTHY.test(val)) return 'esac'
  }
  return DEFAULT_BRAND
}

module.exports = { BRANDS, DEFAULT_BRAND, getBrand, resolveBrandKey }

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { isDownscalable, downscaleImage, BACKGROUND_MAX_DIMENSION } from './downscaleImage.js'

test('isDownscalable rejects non-images', () => {
  assert.equal(isDownscalable({ type: 'application/pdf', size: 900000 }), false)
})

test('isDownscalable rejects gif', () => {
  assert.equal(isDownscalable({ type: 'image/gif', size: 900000 }), false)
})

test('isDownscalable rejects svg', () => {
  assert.equal(isDownscalable({ type: 'image/svg+xml', size: 900000 }), false)
})

test('isDownscalable rejects small files', () => {
  assert.equal(isDownscalable({ type: 'image/jpeg', size: 1000 }), false)
})

test('isDownscalable accepts a large jpeg', () => {
  assert.equal(isDownscalable({ type: 'image/jpeg', size: 900000 }), true)
})

test('isDownscalable accepts a large png', () => {
  assert.equal(isDownscalable({ type: 'image/png', size: 900000 }), true)
})

test('BACKGROUND_MAX_DIMENSION is 2560', () => {
  assert.equal(BACKGROUND_MAX_DIMENSION, 2560)
})

test('downscaleImage returns the original file when createImageBitmap is unavailable', async () => {
  const file = { type: 'image/jpeg', size: 900000, name: 'photo.jpg' }
  const result = await downscaleImage(file, { maxDimension: BACKGROUND_MAX_DIMENSION })
  assert.equal(result, file)
})

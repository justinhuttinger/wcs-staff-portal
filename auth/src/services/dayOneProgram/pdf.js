'use strict'

const fs = require('fs')
const path = require('path')

// Read template and logo at module load time (cached)
const templatePath = path.join(__dirname, '../../templates/day-one/program-template.html')
const logoPath = path.join(__dirname, '../../templates/day-one/logo.png')

const template = fs.readFileSync(templatePath, 'utf8')
const logoBuffer = fs.readFileSync(logoPath)
const logoBase64 = logoBuffer.toString('base64')

/**
 * Pure function: render program to HTML for PDF (no network calls).
 * @param {Object} contactData - { firstName, lastName, ... }
 * @param {Object} programContent - { basicExplanation, progressionNotes, terminology, principles, importantNotes, weekTemplate: { workouts: [] } }
 * @returns {string} - HTML ready for PDF conversion
 */
function formatProgramHTML(contactData, programContent) {
  const {
    basicExplanation = '',
    progressionNotes = '',
    terminology = '',
    principles = '',
    importantNotes = '',
    weekTemplate = { workouts: [] },
  } = programContent

  const { workouts = [] } = weekTemplate

  // Overview page
  let html = `
<div class="page">
  <img src="data:image/png;base64,${logoBase64}" class="logo-image" alt="Day One Logo">
  <div class="page-header">
    <div class="header-left">
      <h1>TRAINING PROGRAM</h1>
      <h2>DAY 1</h2>
    </div>
    <div class="header-right">
      <p>${contactData.firstName || ''} ${contactData.lastName || ''}</p>
    </div>
  </div>

  <div class="core-concepts">
    <h3>YOUR PROGRAM</h3>
    <div class="core-concepts-content">
      ${basicExplanation ? `<p>${escapeHtml(basicExplanation)}</p>` : ''}
      ${progressionNotes ? `<p><strong>Progression:</strong> ${escapeHtml(progressionNotes)}</p>` : ''}
      ${principles ? `<p><strong>Principles:</strong> ${escapeHtml(principles)}</p>` : ''}
      ${importantNotes ? `<p><strong>Important Notes:</strong> ${escapeHtml(importantNotes)}</p>` : ''}
    </div>
  </div>
</div>
`

  // Workout pages (one per day)
  workouts.forEach((workout, idx) => {
    const dayNum = workout.day || (idx + 1)
    const title = workout.title || `Day ${dayNum}`
    const focus = workout.focus || ''
    const exercises = workout.exercises || []

    html += `
<div class="page">
  <img src="data:image/png;base64,${logoBase64}" class="logo-image" alt="Day One Logo">
  <div class="page-header">
    <div class="header-left">
      <h1>${escapeHtml(focus)}</h1>
      <h2>DAY ${dayNum} - ${escapeHtml(title.toUpperCase())}</h2>
    </div>
    <div class="header-right">
      <p>${contactData.firstName || ''} ${contactData.lastName || ''}</p>
    </div>
  </div>

  <table class="workout-table">
    <tbody>
`

    exercises.forEach(ex => {
      const exerciseName = ex.name || ''
      const sets = ex.sets || ''
      const reps = ex.reps || ''
      const notes = ex.notes || ''
      const variations = ex.variations || ''

      let cellContent = `<strong>${escapeHtml(exerciseName)}</strong>`
      if (sets || reps) {
        cellContent += `<br>${escapeHtml(sets)} x ${escapeHtml(reps)}`
      }
      if (notes) {
        cellContent += `<br><em>${escapeHtml(notes)}</em>`
      }
      if (variations) {
        cellContent += `<br>Variations: ${escapeHtml(variations)}`
      }

      const details = `${sets} x ${reps}${notes ? ` - ${notes}` : ''}`

      html += `
      <tr>
        <td>${cellContent}</td>
        <td>${escapeHtml(details)}</td>
      </tr>
`
    })

    html += `
    </tbody>
  </table>
</div>
`
  })

  // Terminology page (if present)
  if (terminology) {
    html += `
<div class="page">
  <img src="data:image/png;base64,${logoBase64}" class="logo-image" alt="Day One Logo">
  <div class="page-header">
    <div class="header-left">
      <h1>REFERENCE</h1>
      <h2>TERMINOLOGY</h2>
    </div>
    <div class="header-right">
      <p>${contactData.firstName || ''} ${contactData.lastName || ''}</p>
    </div>
  </div>

  <div class="core-concepts">
    <div class="core-concepts-content">
      ${escapeHtml(terminology).replace(/\n/g, '<br>')}
    </div>
  </div>
</div>
`
  }

  return html
}

/**
 * HTML escape helper
 */
function escapeHtml(text) {
  if (!text) return ''
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;')
}

/**
 * Build PDF via PDFShift API (async).
 * @param {Object} contactData - { firstName, lastName, ... }
 * @param {Object} programContent - program structure
 * @returns {Promise<Buffer>} - PDF binary data
 */
async function buildProgramPdf(contactData, programContent) {
  const html = formatProgramHTML(contactData, programContent)
  const fullHtml = template.replace('{{programContent}}', html)

  const apiKey = process.env.PDFSHIFT_API_KEY
  if (!apiKey) {
    throw new Error('PDFSHIFT_API_KEY not set')
  }

  const credentials = Buffer.from(`api:${apiKey}`).toString('base64')

  const response = await fetch('https://api.pdfshift.io/v3/documents/convert', {
    method: 'POST',
    headers: {
      'Authorization': `Basic ${credentials}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      source: {
        html: fullHtml,
      },
      sandbox: false,
    }),
  })

  if (!response.ok) {
    const errorText = await response.text()
    throw new Error(`PDFShift API error ${response.status}: ${errorText}`)
  }

  return Buffer.from(await response.arrayBuffer())
}

module.exports = { formatProgramHTML, buildProgramPdf }

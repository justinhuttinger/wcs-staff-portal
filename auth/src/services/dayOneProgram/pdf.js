'use strict'

const fs = require('fs').promises
const path = require('path')

const TEMPLATE_DIR = path.join(__dirname, '..', '..', 'templates', 'day-one')

function formatTerminology(text) {
  if (!text) return ''
  return text
    .replace(/([A-Za-z\s]+):/g, '<strong>$1</strong>:')
    .replace(/([A-Za-z]+)\s*-\s+/g, '<strong>$1</strong> - ')
}

// Build the inner program HTML (same markup as the standalone service).
function formatProgramHTML(contactData, programContent) {
  if (!programContent.weekTemplate && !programContent.weeks) {
    return `<div class="program-text">${programContent.programText || 'Program content'}</div>`
  }
  const name = `${contactData.firstName} ${contactData.lastName}`
  let html = `
    <div class="page">
      <img src="data:image/png;base64,{{logoBase64}}" class="logo-image" alt="WCS Logo">
      <div class="page-header" style="margin-bottom: 10px;">
        <div class="header-left"><h1>WEST COAST STRENGTH</h1><h2>PROGRAM OVERVIEW</h2></div>
        <div class="header-right" style="padding-top: 30px;"><p>CLIENT: ${name}</p></div>
      </div>
      <div class="core-concepts" style="margin-top: 5px;">
        <h3 style="margin-bottom: 3px;">BASIC EXPLANATION:</h3>
        <div class="core-concepts-content" style="margin-bottom: 10px;"><p style="margin: 0;">${programContent.basicExplanation || ''}</p></div>
        <h3 style="margin-bottom: 3px;">PROGRESSION:</h3>
        <div class="core-concepts-content" style="margin-bottom: 10px;"><p style="margin: 0;">${programContent.progressionNotes || ''}</p></div>
        <h3 style="margin-bottom: 3px;">TERMINOLOGY:</h3>
        <div class="core-concepts-content" style="margin-bottom: 10px;"><p style="margin: 0;">${formatTerminology(programContent.terminology) || ''}</p></div>
        <h3 style="margin-bottom: 3px;">PRINCIPLES:</h3>
        <div class="core-concepts-content" style="margin-bottom: 10px;"><p style="margin: 0;">${programContent.principles || ''}</p></div>
        <h3 style="margin-bottom: 3px;">IMPORTANT NOTES:</h3>
        <div class="core-concepts-content" style="margin-bottom: 10px;"><p style="margin: 0;">${programContent.importantNotes || ''}</p></div>
      </div>
    </div>`

  const workouts = programContent.weekTemplate?.workouts || programContent.weeks?.[0]?.workouts || []
  workouts.forEach(workout => {
    html += `
      <div class="page">
        <img src="data:image/png;base64,{{logoBase64}}" class="logo-image" alt="WCS Logo">
        <div class="page-header">
          <div class="header-left"><h1>WEST COAST STRENGTH</h1><h2>DAY ${workout.day} - ${String(workout.title || '').toUpperCase()}</h2></div>
          <div class="header-right" style="padding-top: 30px;"><p>CLIENT: ${name}</p></div>
        </div>
        <table style="width: 100%; border-collapse: collapse; border: 1px solid #000;">
          <thead><tr>
            <th style="text-align: left; padding: 8px; border: 1px solid #000;">EXERCISE</th>
            <th style="text-align: center; padding: 8px; border: 1px solid #000; width: 100px;"></th>
            <th style="text-align: left; padding: 8px; border: 1px solid #000; width: 180px;">VARIATIONS</th>
          </tr></thead>
          <tbody>`
    ;(workout.exercises || []).forEach(ex => {
      const setsReps = `${ex.sets} x ${ex.reps}`
      const notes = ex.notes || ''
      const variations = ex.variations || ex.variation || ''
      html += `
        <tr>
          <td style="padding: 8px; border: 1px solid #000;"><strong>${ex.name}</strong>${notes ? `<br><span style="font-size: 11px; color: #666;">${notes}</span>` : ''}</td>
          <td style="text-align: center; padding: 8px; border: 1px solid #000; width: 100px;">${setsReps}</td>
          <td style="padding: 8px; border: 1px solid #000; width: 180px; font-size: 11px;">${variations}</td>
        </tr>`
    })
    html += `</tbody></table></div>`
  })
  return html
}

async function buildProgramPdf(contactData, programContent) {
  const htmlTemplate = await fs.readFile(path.join(TEMPLATE_DIR, 'program-template.html'), 'utf8')
  const logoBase64 = (await fs.readFile(path.join(TEMPLATE_DIR, 'logo.png'))).toString('base64')

  let programHTML = formatProgramHTML(contactData, programContent).replace(/{{logoBase64}}/g, logoBase64)
  const finalHtml = htmlTemplate.replace(/{{programContent}}/g, programHTML)

  const apiKey = process.env.PDFSHIFT_API_KEY
  if (!apiKey) throw new Error('PDFSHIFT_API_KEY not set')

  const resp = await fetch('https://api.pdfshift.io/v3/convert/pdf', {
    method: 'POST',
    headers: {
      Authorization: 'Basic ' + Buffer.from('api:' + apiKey).toString('base64'),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      source: finalHtml,
      landscape: false,
      use_print: true,
      margin: { top: '0.5in', bottom: '0.5in', left: '0.5in', right: '0.5in' },
    }),
  })
  if (!resp.ok) throw new Error(`PDFShift error ${resp.status}: ${await resp.text()}`)
  return Buffer.from(await resp.arrayBuffer())
}

module.exports = { buildProgramPdf, formatProgramHTML }

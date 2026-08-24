'use strict'

const sgMail = require('@sendgrid/mail')
const { getBrand } = require('./brands')
if (process.env.SENDGRID_API_KEY) sgMail.setApiKey(process.env.SENDGRID_API_KEY)

const FROM_EMAIL = process.env.FROM_EMAIL || 'programs@westcoaststrength.com'
const ADMIN_EMAIL = process.env.DAY_ONE_ADMIN_EMAIL || 'justin@westcoaststrength.com'

// ABC silently drops uploads whose filename has disallowed chars (parens etc.).
function safeFilename(contactData) {
  const base = `Training_Program_${contactData.firstName}_${contactData.lastName}`
  return base.replace(/[^A-Za-z0-9_\-]/g, '') + '.pdf'
}

// Sender/brand name on the client email. ESAC is a single club, so it is never
// suffixed with the club name the way the WCS clubs are.
function clubFromName(club, brandKey) {
  const brand = getBrand(brandKey)
  if (!brand.perClub) return brand.name
  const name = club?.name || brand.name
  return name.includes(brand.name) ? name : `${brand.name} - ${name}`
}

// The copy the client reads. Pulled out of the send so the wording can be
// tested without SendGrid, and so there is one obvious place to change it.
function programEmail(contactData, fromName) {
  const greeting = `Hi ${contactData.firstName},`
  const body = `Your customized training program from ${fromName} is attached. `
    + 'Please review it carefully and reach out if you have any questions.'
  return {
    subject: `Your Personalized Training Program - ${contactData.firstName}`,
    text: `${greeting}\n\n${body}\n\n${fromName}`,
    html: `<p>${greeting}</p><p>Your customized training program from `
      + `<strong>${fromName}</strong> is attached. Please review it carefully `
      + `and reach out if you have any questions.</p><p>${fromName}</p>`,
  }
}

async function sendProgramEmail(contactData, club, pdfBuffer, brandKey) {
  const fromName = clubFromName(club, brandKey)
  const { subject, text, html } = programEmail(contactData, fromName)
  await sgMail.send({
    to: contactData.email,
    from: { email: FROM_EMAIL, name: fromName },
    subject,
    text,
    html,
    attachments: [{
      content: pdfBuffer.toString('base64'),
      filename: safeFilename(contactData),
      type: 'application/pdf',
      disposition: 'attachment',
    }],
  })
}

async function uploadToABC(memberId, clubCode, pdfBuffer, contactData) {
  const payload = {
    document: pdfBuffer.toString('base64'),
    documentName: safeFilename(contactData),
    documentType: 'pdf',
    imageType: 'member_document',
    memberId,
  }
  const resp = await fetch(`https://api.abcfinancial.com/rest/${clubCode}/members/documents/${memberId}`, {
    method: 'POST',
    headers: {
      app_id: process.env.ABC_APP_ID,
      app_key: process.env.ABC_APP_KEY,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  })
  if (!resp.ok) throw new Error(`ABC upload error ${resp.status}: ${await resp.text()}`)
  return resp.json().catch(() => ({}))
}

async function sendErrorNotification(error, contactId, club) {
  if (!process.env.SENDGRID_API_KEY) return
  try {
    await sgMail.send({
      to: ADMIN_EMAIL,
      from: FROM_EMAIL,
      subject: `PT Program Generator Error - ${club?.name || 'unknown'}`,
      text: `Error generating program for contact ${contactId} at ${club?.name} (${club?.clubCode}):\n\n${error.message}\n\n${error.stack || ''}`,
    })
  } catch (e) {
    console.error('[DayOne] Failed to send error notification:', e.message)
  }
}

module.exports = {
  clubFromName, programEmail, sendProgramEmail, uploadToABC, sendErrorNotification, safeFilename,
}

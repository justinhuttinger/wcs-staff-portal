import { useState } from 'react'

const REFERENCES = [
  {
    category: 'Webhooks',
    items: [
      { label: 'Day One — Appointment Booked', value: 'POST https://wcs-auth-api.onrender.com/webhooks/ghl-appointment' },
      { label: 'Day One — Form Completed', value: 'POST https://wcs-auth-api.onrender.com/webhooks/ghl-form-complete' },
      { label: 'Sync All Data (hourly cron target)', value: 'POST https://wcs-auth-api.onrender.com/sync/all' },
      { label: 'Sync Contacts Only', value: 'POST https://wcs-auth-api.onrender.com/sync/contacts' },
      { label: 'Sync Opportunities Only', value: 'POST https://wcs-auth-api.onrender.com/sync/opportunities' },
      { label: 'Full Sync (all contacts, not incremental)', value: 'POST https://wcs-auth-api.onrender.com/sync/contacts?full=true' },
    ],
  },
  {
    category: 'Webhook Payloads',
    items: [
      {
        label: 'GHL Appointment Booked',
        value: JSON.stringify({
          staff_email: '{{appointment.user.email}}',
          contact_name: '{{contact.first_name}} {{contact.last_name}}',
          appointment_id: '{{appointment.id}}',
          appointment_type: 'DAYONE',
          appointment_time: '{{appointment.start_time}}',
          contact_id: '{{contact.id}}',
          form_id: 'cZRn6boL8YRmlbnrMO1m',
        }, null, 2),
      },
      {
        label: 'GHL Form Completed',
        value: JSON.stringify({
          appointment_id: '{{appointment.id}}',
          contact_id: '{{contact.id}}',
          sale_result: '{{contact.day_one_sale}}',
        }, null, 2),
      },
    ],
  },
  {
    category: 'Services',
    items: [
      { label: 'Portal (Frontend)', value: 'https://wcs-staff-portal.onrender.com' },
      { label: 'Auth API (Backend)', value: 'https://wcs-auth-api.onrender.com' },
      { label: 'Auth API Health Check', value: 'https://wcs-auth-api.onrender.com/health' },
      { label: 'Supabase Dashboard', value: 'https://supabase.com/dashboard/project/ybopxxydsuwlbwxiuzve' },
    ],
  },
  {
    category: 'GitHub',
    items: [
      { label: 'Repository', value: 'https://github.com/justinhuttinger/wcs-staff-portal' },
    ],
  },
]

function CopyButton({ text }) {
  const [copied, setCopied] = useState(false)

  function handleCopy() {
    navigator.clipboard.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <button
      onClick={handleCopy}
      className="shrink-0 px-2 py-1 rounded text-xs font-medium border border-border text-text-muted hover:text-text-primary transition-colors"
    >
      {copied ? 'Copied!' : 'Copy'}
    </button>
  )
}

export default function AdminReferencesTab() {
  return (
    <div className="space-y-6">
      <h3 className="text-lg font-semibold text-text-primary">References & Links</h3>
      <p className="text-sm text-text-muted">Quick reference for webhook URLs, service links, and payloads.</p>

      {REFERENCES.map(section => (
        <div key={section.category} className="bg-surface border border-border rounded-xl overflow-hidden">
          <div className="px-4 py-3 bg-bg border-b border-border">
            <h4 className="text-sm font-semibold text-text-primary">{section.category}</h4>
          </div>
          <div className="divide-y divide-border">
            {section.items.map((item, i) => (
              <div key={i} className="px-4 py-3 flex items-start gap-3">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-text-primary">{item.label}</p>
                  <pre className="text-xs text-text-muted mt-1 whitespace-pre-wrap break-all font-mono bg-bg rounded px-2 py-1.5 overflow-x-auto">
                    {item.value}
                  </pre>
                </div>
                <CopyButton text={item.value} />
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}

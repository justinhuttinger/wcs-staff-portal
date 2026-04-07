const STATUS_STYLES = {
  pending: 'bg-yellow-50 text-yellow-700 border-yellow-200',
  completed: 'bg-green-50 text-green-700 border-green-200',
  dismissed: 'bg-gray-50 text-gray-500 border-gray-200',
}

const STATUS_LABELS = {
  pending: 'Pending',
  completed: 'Completed',
  dismissed: 'Dismissed',
}

function formatTime(dateStr) {
  if (!dateStr) return ''
  const d = new Date(dateStr)
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }) +
    ' at ' + d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
}

export default function AppointmentCard({ appointment, onClick }) {
  const statusStyle = STATUS_STYLES[appointment.status] || STATUS_STYLES.pending

  return (
    <button
      onClick={onClick}
      disabled={appointment.status !== 'pending'}
      className={`w-full text-left rounded-xl border p-5 transition-all duration-200 ${
        appointment.status === 'pending'
          ? 'bg-surface border-border hover:-translate-y-[1px] hover:shadow-[0_8px_32px_rgba(0,0,0,0.08)] cursor-pointer'
          : 'bg-bg border-border opacity-75 cursor-default'
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <h3 className="text-base font-semibold text-text-primary truncate">
            {appointment.contact_name}
          </h3>
          <p className="text-sm text-text-muted mt-1">
            {formatTime(appointment.appointment_time)}
          </p>
          {appointment.staff_email && (
            <p className="text-xs text-text-muted mt-1">
              Trainer: {appointment.staff_email}
            </p>
          )}
          {appointment.sale_result && (
            <p className="text-xs text-text-muted mt-1">
              Result: {appointment.sale_result}
            </p>
          )}
        </div>
        <span className={`shrink-0 px-2.5 py-1 rounded-full text-xs font-medium border ${statusStyle}`}>
          {STATUS_LABELS[appointment.status]}
        </span>
      </div>
    </button>
  )
}

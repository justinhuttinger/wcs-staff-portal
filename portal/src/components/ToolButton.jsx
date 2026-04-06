export default function ToolButton({ label, icon, url }) {
  const openTool = () => {
    const popup = window.open(
      url,
      label,
      'width=1400,height=900,toolbar=0,menubar=0,location=0'
    )
    if (!popup) {
      // Fallback if popup is blocked in kiosk mode
      window.location.href = url
      return
    }
    const timer = setInterval(() => {
      if (popup.closed) {
        clearInterval(timer)
      }
    }, 500)
  }

  return (
    <button
      onClick={openTool}
      className="flex flex-col items-center justify-center gap-3 rounded-2xl bg-white/10 p-6 transition hover:bg-wcs-red/80 hover:scale-105 cursor-pointer"
    >
      <span className="text-4xl">{icon}</span>
      <span className="text-lg font-semibold text-white">{label}</span>
    </button>
  )
}

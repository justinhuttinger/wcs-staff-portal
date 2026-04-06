import { useState, useEffect, useCallback } from 'react'

export default function useIdleTimer(timeoutMs = 10 * 60 * 1000) {
  const [isIdle, setIsIdle] = useState(false)

  const resetTimer = useCallback(() => {
    setIsIdle(false)
  }, [])

  useEffect(() => {
    let timer = setTimeout(() => setIsIdle(true), timeoutMs)

    const handleActivity = () => {
      clearTimeout(timer)
      setIsIdle(false)
      timer = setTimeout(() => setIsIdle(true), timeoutMs)
    }

    const events = ['mousemove', 'mousedown', 'keydown', 'touchstart', 'scroll']
    events.forEach((e) => window.addEventListener(e, handleActivity))

    return () => {
      clearTimeout(timer)
      events.forEach((e) => window.removeEventListener(e, handleActivity))
    }
  }, [timeoutMs])

  return { isIdle, resetTimer }
}

import { useEffect } from 'react'

// Keeps the window exactly as tall as the form inside it.
export function useFit() {
  useEffect(() => {
    const el = document.querySelector('.win')
    if (!el) return
    const send = () => window.gdm.fit?.((el as HTMLElement).offsetHeight)
    const ro = new ResizeObserver(send)
    ro.observe(el)
    send()
    return () => ro.disconnect()
  })
}

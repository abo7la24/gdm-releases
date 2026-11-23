import type { ReactNode } from 'react'

// Turns <b>bold</b> in a translated sentence into real bold text, so each language can place the bold part where it belongs.
export function rich(text: string): ReactNode[] {
  return text.split(/(<b>.*?<\/b>)/g).filter(Boolean).map((part, i) => {
    const m = /^<b>(.*)<\/b>$/.exec(part)
    return m ? <strong key={i}>{m[1]}</strong> : part
  })
}

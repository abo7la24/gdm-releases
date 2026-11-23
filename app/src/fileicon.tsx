import { File } from 'lucide-react'

// The icon Windows shows for this kind of file (a video, a zip, a document...). A plain file symbol if it has none.
export function FileIcon({ src }: { src?: string | null }) {
  return (
    <span className="fileicon" aria-hidden="true">
      {src ? <img src={src} alt="" width={32} height={32} /> : <File size={30} />}
    </span>
  )
}

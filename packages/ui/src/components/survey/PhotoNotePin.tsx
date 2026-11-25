import { Pin, StickyNote } from 'lucide-react';

export default function PhotoNotePin() {
  return (
    <span aria-hidden="true" style={{ position: 'relative', display: 'inline-block', width: 32, height: 32, filter: 'drop-shadow(0 2px 2px #0005)' }}>
      <StickyNote fill="#ffed91" color="#946b15" strokeWidth={1.5} style={{ position: 'absolute', left: 1, bottom: 0, width: 29, height: 29 }} />
      <Pin fill="#e25d4a" color="#802b22" strokeWidth={1.8} style={{ position: 'absolute', top: 0, left: 9, width: 16, height: 16, transform: 'rotate(22deg)' }} />
    </span>
  );
}

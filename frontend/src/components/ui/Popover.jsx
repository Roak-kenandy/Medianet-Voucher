import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

const GAP = 6;
const VIEWPORT_MARGIN = 8;
const SHEET_QUERY = '(max-width: 640px)';

export function useMediaQuery(query) {
  const [matches, setMatches] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const media = window.matchMedia(query);
    const update = () => setMatches(media.matches);
    update();
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, [query]);
  return matches;
}

/**
 * Floating panel anchored to a trigger, rendered in <body> so modals and tables never clip it.
 * On phones it becomes a bottom sheet over a backdrop.
 */
export default function Popover({ anchorRef, open, onClose, children, className = '' }) {
  const panelRef = useRef(null);
  const sheet = useMediaQuery(SHEET_QUERY);
  const [position, setPosition] = useState(null);

  const place = useCallback(() => {
    if (sheet) return;
    const anchor = anchorRef.current;
    const panel = panelRef.current;
    if (!anchor || !panel) return;
    const rect = anchor.getBoundingClientRect();
    const width = panel.offsetWidth;
    const height = panel.offsetHeight;
    let left = Math.min(rect.left, window.innerWidth - width - VIEWPORT_MARGIN);
    left = Math.max(VIEWPORT_MARGIN, left);
    const spaceBelow = window.innerHeight - rect.bottom - GAP - VIEWPORT_MARGIN;
    const spaceAbove = rect.top - GAP - VIEWPORT_MARGIN;
    let top;
    if (height <= spaceBelow || spaceBelow >= spaceAbove) {
      top = rect.bottom + GAP;
    } else {
      top = Math.max(VIEWPORT_MARGIN, rect.top - GAP - height);
    }
    setPosition({ top, left });
  }, [anchorRef, sheet]);

  useLayoutEffect(() => {
    if (open) place();
    else setPosition(null);
  }, [open, place]);

  useEffect(() => {
    if (!open) return undefined;
    const handlePointer = (event) => {
      if (panelRef.current?.contains(event.target) || anchorRef.current?.contains(event.target)) return;
      onClose();
    };
    const handleKey = (event) => {
      if (event.key === 'Escape') onClose();
    };
    const handleScroll = (event) => {
      if (panelRef.current?.contains(event.target)) return;
      place();
    };
    document.addEventListener('pointerdown', handlePointer);
    document.addEventListener('keydown', handleKey);
    window.addEventListener('resize', place);
    window.addEventListener('scroll', handleScroll, true);
    return () => {
      document.removeEventListener('pointerdown', handlePointer);
      document.removeEventListener('keydown', handleKey);
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', handleScroll, true);
    };
  }, [open, onClose, place, anchorRef]);

  useEffect(() => {
    if (!open || !sheet) return undefined;
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previous;
    };
  }, [open, sheet]);

  if (!open) return null;

  const panel = (
    <div
      ref={panelRef}
      className={`ui-popover${sheet ? ' is-sheet' : ''} ${className}`.trim()}
      style={sheet ? undefined : { top: position?.top ?? -9999, left: position?.left ?? -9999 }}
      role="dialog"
    >
      {sheet && <div className="ui-sheet-handle" aria-hidden="true" />}
      {children}
    </div>
  );

  return createPortal(
    sheet ? (
      <>
        <div className="ui-popover-backdrop" aria-hidden="true" />
        {panel}
      </>
    ) : (
      panel
    ),
    document.body
  );
}

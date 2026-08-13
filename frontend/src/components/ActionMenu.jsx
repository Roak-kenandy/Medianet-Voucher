import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

export default function ActionMenu({ open, onClose, anchorRef, children }) {
  const menuRef = useRef(null);
  const [position, setPosition] = useState(null);

  const updatePosition = () => {
    if (!anchorRef.current) return;

    const rect = anchorRef.current.getBoundingClientRect();
    const menuWidth = 180;
    const menuHeight = menuRef.current?.offsetHeight || 96;
    const gap = 6;

    let top = rect.bottom + gap;
    let left = rect.right - menuWidth;

    if (top + menuHeight > window.innerHeight - 8) {
      top = rect.top - menuHeight - gap;
    }

    if (left < 8) left = 8;
    if (left + menuWidth > window.innerWidth - 8) {
      left = window.innerWidth - menuWidth - 8;
    }

    setPosition({ top, left, minWidth: menuWidth });
  };

  useEffect(() => {
    if (!open) {
      setPosition(null);
      return;
    }

    updatePosition();
    window.addEventListener('resize', updatePosition);
    window.addEventListener('scroll', updatePosition, true);

    return () => {
      window.removeEventListener('resize', updatePosition);
      window.removeEventListener('scroll', updatePosition, true);
    };
  }, [open, anchorRef, children]);

  useLayoutEffect(() => {
    if (open) updatePosition();
  }, [open, children]);

  useEffect(() => {
    if (!open) return;

    function handleClickOutside(e) {
      if (
        menuRef.current?.contains(e.target) ||
        anchorRef.current?.contains(e.target)
      ) {
        return;
      }
      onClose();
    }

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [open, onClose, anchorRef]);

  if (!open || !position) return null;

  return createPortal(
    <div
      ref={menuRef}
      className="action-menu action-menu-portal"
      style={{
        position: 'fixed',
        top: position.top,
        left: position.left,
        minWidth: position.minWidth,
      }}
    >
      {children}
    </div>,
    document.body
  );
}

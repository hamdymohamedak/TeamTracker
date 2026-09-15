import React, { useEffect, useState } from 'react';
import { HelpCircle } from 'lucide-react';

type HelpTipProps = {
  text: string;
  /** Visual size of the trigger circle */
  size?: number;
  /** Prefer opening upward when near the bottom of a card */
  placement?: 'bottom' | 'top';
};

/**
 * Circular "?" help control — hover or click to pin the explanation.
 * Shared across dashboard pages for consistent microcopy.
 */
export const HelpTip: React.FC<HelpTipProps> = ({
  text,
  size = 18,
  placement = 'bottom',
}) => {
  const [pinned, setPinned] = useState(false);

  useEffect(() => {
    if (!pinned) return;
    const close = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (target.closest('[data-tip-root]')) return;
      setPinned(false);
    };
    const t = setTimeout(() => document.addEventListener('click', close), 0);
    return () => {
      clearTimeout(t);
      document.removeEventListener('click', close);
    };
  }, [pinned]);

  const iconSize = Math.max(10, Math.round(size * 0.62));

  return (
    <span data-tip-root style={{ position: 'relative', display: 'inline-flex' }} className="tip-wrap">
      <button
        type="button"
        aria-label={text}
        title={text}
        onClick={() => setPinned(p => !p)}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: size,
          height: size,
          borderRadius: '50%',
          backgroundColor: '#e5e7eb',
          color: '#6b7280',
          cursor: 'pointer',
          border: 'none',
          padding: 0,
          flexShrink: 0,
        }}
      >
        <HelpCircle size={iconSize} strokeWidth={2.25} aria-hidden />
      </button>
      <span
        className="tip-bubble"
        role="tooltip"
        data-pinned={pinned ? 'true' : 'false'}
        style={{
          position: 'absolute',
          ...(placement === 'top'
            ? { bottom: '100%', marginBottom: 8 }
            : { top: '100%', marginTop: 8 }),
          left: '50%',
          transform: 'translateX(-50%)',
          zIndex: 1000,
          backgroundColor: '#1f2937',
          color: '#f9fafb',
          fontSize: 12,
          fontWeight: 400,
          lineHeight: 1.45,
          padding: '8px 10px',
          borderRadius: 6,
          width: 'min(280px, 80vw)',
          boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
          pointerEvents: 'none',
          textTransform: 'none',
          letterSpacing: 'normal',
          whiteSpace: 'normal',
        }}
      >
        {text}
      </span>
    </span>
  );
};

/** Section heading with an optional help tip aligned to the title. */
export const SectionTitle: React.FC<{
  children: React.ReactNode;
  help?: string;
  icon?: React.ReactNode;
  style?: React.CSSProperties;
}> = ({ children, help, icon, style }) => (
  <h2
    style={{
      display: 'flex',
      alignItems: 'center',
      gap: 8,
      margin: 0,
      fontSize: 18,
      fontWeight: 650,
      color: 'var(--tt-text)',
      ...style,
    }}
  >
    {icon}
    <span>{children}</span>
    {help ? <HelpTip text={help} /> : null}
  </h2>
);

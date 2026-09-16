import React from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Info,
  X,
  type LucideIcon,
} from 'lucide-react';

const rowStyle: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  verticalAlign: 'middle',
};

/** Icon + text for card meta rows (email, department, etc.). */
export const IconLabel: React.FC<{
  icon: LucideIcon;
  children: React.ReactNode;
  size?: number;
  style?: React.CSSProperties;
}> = ({ icon: Icon, children, size = 14, style }) => (
  <span style={{ ...rowStyle, ...style }}>
    <Icon size={size} strokeWidth={2} aria-hidden style={{ flexShrink: 0 }} />
    <span>{children}</span>
  </span>
);

/** Empty-state / error hero icon. */
export const EmptyIcon: React.FC<{
  icon: LucideIcon;
  size?: number;
  color?: string;
}> = ({ icon: Icon, size = 40, color = 'var(--tt-text-faint)' }) => (
  <div style={{ marginBottom: 16, color, display: 'flex', justifyContent: 'center' }}>
    <Icon size={size} strokeWidth={1.5} aria-hidden />
  </div>
);

type BannerVariant = 'success' | 'error' | 'warning' | 'info';

const bannerIcons: Record<BannerVariant, LucideIcon> = {
  success: CheckCircle2,
  error: AlertTriangle,
  warning: AlertTriangle,
  info: Info,
};

/** Inline status line with lucide icon (success / error / warning / info). */
export const StatusLine: React.FC<{
  variant: BannerVariant;
  children: React.ReactNode;
  style?: React.CSSProperties;
  className?: string;
}> = ({ variant, children, style, className }) => {
  const Icon = bannerIcons[variant];
  return (
    <div
      className={className}
      style={{
        display: 'flex',
        alignItems: 'flex-start',
        gap: 8,
        ...style,
      }}
    >
      <Icon size={16} strokeWidth={2} aria-hidden style={{ flexShrink: 0, marginTop: 2 }} />
      <span style={{ flex: 1 }}>{children}</span>
    </div>
  );
};

/** Modal close control using lucide X. */
export const ModalCloseButton: React.FC<{
  onClick: () => void;
  label?: string;
  className?: string;
}> = ({ onClick, label = 'Close', className = 'tt-modal-close' }) => (
  <button type="button" className={className} aria-label={label} onClick={onClick}>
    <X size={16} strokeWidth={2} aria-hidden />
  </button>
);

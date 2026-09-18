import React from 'react';
import { HelpTip } from '@/components/HelpTip';
import { formatDurationSeconds } from '../../../../../shared-types';
import { dashboardStyles as styles } from '../dashboard.styles';

// ── StatCard ─────────────────────────────────────────────────────────────────

export interface StatCardProps {
  title: string;
  value: string | number;
  icon: React.ReactNode;
  color: string;
  tooltip?: string;
}

export const StatCard: React.FC<StatCardProps> = ({ title, value, icon, color, tooltip }) => (
  <div style={{ ...styles.statCard as React.CSSProperties, borderLeftColor: color }}>
    <div style={(styles.statIcon as (c: string) => React.CSSProperties)(color)}>{icon}</div>
    <div style={{ flex: 1, minWidth: 0 }}>
      <div style={styles.statValue as React.CSSProperties}>{value}</div>
      <div style={{ ...(styles.statTitle as React.CSSProperties), display: 'flex', alignItems: 'center', gap: '6px' }}>
        <span>{title}</span>
        {tooltip ? <HelpTip text={tooltip} /> : null}
      </div>
    </div>
  </div>
);

// ── BreakdownItem ─────────────────────────────────────────────────────────────

export interface BreakdownItemProps {
  label: string;
  minutes: number;
  color: string;
}

export const BreakdownItem: React.FC<BreakdownItemProps> = ({ label, minutes, color }) => (
  <div style={styles.breakdownItem as React.CSSProperties}>
    <div style={styles.breakdownLabel as React.CSSProperties}>
      <span style={{ ...(styles.breakdownDot as React.CSSProperties), backgroundColor: color }} />
      {label}
    </div>
    <div style={styles.breakdownValue as React.CSSProperties}>{formatDurationSeconds(minutes * 60)}</div>
  </div>
);

// Styles used by Dashboard page and its sub-components (StatCard, BreakdownItem, SuspiciousLog).
// Extracted from the monolithic Dashboard.tsx to keep the page files lean.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const dashboardStyles: { [key: string]: any } = {
  loading: {
    padding: '40px',
    textAlign: 'center',
    color: 'var(--tt-text-muted)',
  },
  scopeTabs: {
    display: 'inline-flex',
    gap: 4,
    padding: 4,
    borderRadius: 999,
    backgroundColor: 'var(--tt-surface-muted)',
    border: '1px solid var(--tt-border)',
  },
  scopeTab: {
    padding: '9px 16px',
    border: 'none',
    borderRadius: 999,
    backgroundColor: 'transparent',
    color: 'var(--tt-text-muted)',
    cursor: 'pointer',
    fontSize: 13,
    fontWeight: 650,
    transition: 'background 140ms ease, color 140ms ease',
  },
  scopeTabActive: {
    backgroundColor: 'var(--tt-ink)',
    color: '#fff',
    boxShadow: 'var(--tt-shadow-sm)',
  },
  statTray: {
    background: 'var(--tt-surface-muted)',
    border: '1px solid var(--tt-border)',
    borderRadius: 20,
    padding: 14,
  },
  statCard: {
    backgroundColor: 'var(--tt-surface)',
    border: '1px solid var(--tt-border)',
    borderRadius: 16,
    boxShadow: 'none',
    padding: '18px 18px 18px 20px',
    display: 'flex',
    alignItems: 'center',
    gap: 14,
    borderLeft: '4px solid var(--tt-ink)',
    minHeight: 92,
  },
  grid: {
    display: 'grid',
    gap: 20,
  },
  statIcon: (color: string) => ({
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    color,
    backgroundColor: 'transparent',
    padding: 0,
    borderRadius: 0,
    flexShrink: 0,
  }),
  statValue: {
    fontSize: 28,
    fontWeight: 700,
    fontFamily: 'var(--tt-font-display)',
    letterSpacing: '-0.03em',
    color: 'var(--tt-text)',
    lineHeight: 1.15,
  },
  statTitle: {
    fontSize: 13,
    color: 'var(--tt-text-muted)',
    fontWeight: 550,
    marginTop: 4,
  },
  breakdownGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
    gap: '12px',
  },
  breakdownItem: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '12px',
    backgroundColor: 'var(--tt-surface-muted)',
    borderRadius: 'var(--tt-radius-sm)',
  },
  breakdownLabel: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    fontSize: '14px',
    color: 'var(--tt-text)',
  },
  breakdownDot: {
    width: '10px',
    height: '10px',
    borderRadius: '50%',
  },
  breakdownValue: {
    fontSize: '14px',
    fontWeight: 600,
    color: 'var(--tt-text)',
  },
  suspiciousList: {
    display: 'flex',
    flexDirection: 'column',
    gap: '12px',
  },
  suspiciousItem: {
    padding: '12px',
    backgroundColor: 'var(--tt-danger-soft)',
    border: '1px solid rgba(232, 93, 76, 0.25)',
    borderRadius: 'var(--tt-radius-sm)',
  },
  suspiciousHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    marginBottom: '4px',
  },
  suspiciousApp: {
    fontWeight: 600,
    color: 'var(--tt-text)',
  },
  suspiciousTime: {
    fontSize: '12px',
    color: 'var(--tt-text-faint)',
  },
  suspiciousTitle: {
    fontSize: '13px',
    color: 'var(--tt-text-muted)',
    marginBottom: '4px',
  },
  suspiciousReasonText: {
    fontSize: '12px',
    color: 'var(--tt-danger)',
    fontWeight: 500,
  },
};

import type React from 'react';

export const skeletonStyles: { [key: string]: React.CSSProperties } = {
  container: {
    padding: '24px',
    animation: 'fadeIn 0.3s ease',
  },
  header: {
    marginBottom: '24px',
  },
  title: {
    height: '32px',
    width: '200px',
    backgroundColor: 'var(--tt-border-strong)',
    borderRadius: '4px',
    marginBottom: '8px',
    animation: 'pulse 1.5s infinite',
  },
  subtitle: {
    height: '16px',
    width: '300px',
    backgroundColor: 'var(--tt-border-strong)',
    borderRadius: '4px',
    animation: 'pulse 1.5s infinite',
  },
  statsGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
    gap: '16px',
    marginBottom: '24px',
  },
  statCard: {
    backgroundColor: 'var(--tt-surface)',
    padding: '20px',
    borderRadius: 'var(--tt-radius-sm)',
    boxShadow: 'var(--tt-shadow-sm)',
  },
  statIcon: {
    width: '40px',
    height: '40px',
    backgroundColor: 'var(--tt-border-strong)',
    borderRadius: 'var(--tt-radius-sm)',
    marginBottom: '12px',
    animation: 'pulse 1.5s infinite',
  },
  statValue: {
    height: '28px',
    width: '80px',
    backgroundColor: 'var(--tt-border-strong)',
    borderRadius: '4px',
    marginBottom: '8px',
    animation: 'pulse 1.5s infinite',
  },
  statLabel: {
    height: '14px',
    width: '120px',
    backgroundColor: 'var(--tt-border-strong)',
    borderRadius: '4px',
    animation: 'pulse 1.5s infinite',
  },
  contentGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(400px, 1fr))',
    gap: '24px',
  },
  card: {
    backgroundColor: 'var(--tt-surface)',
    padding: '20px',
    borderRadius: 'var(--tt-radius-sm)',
    boxShadow: 'var(--tt-shadow-sm)',
  },
  cardTitle: {
    height: '20px',
    width: '150px',
    backgroundColor: 'var(--tt-border-strong)',
    borderRadius: '4px',
    marginBottom: '16px',
    animation: 'pulse 1.5s infinite',
  },
  cardContent: {
    height: '200px',
    backgroundColor: 'var(--tt-border-strong)',
    borderRadius: '4px',
    animation: 'pulse 1.5s infinite',
  },
};

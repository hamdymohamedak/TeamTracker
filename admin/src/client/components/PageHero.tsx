import React from 'react';
import type { LucideIcon } from 'lucide-react';
import { HelpTip } from './HelpTip';
import { EmptyIcon } from './Icon';

interface PageHeroProps {
  icon: LucideIcon;
  title: string;
  subtitle?: string;
  help?: string;
  action?: React.ReactNode;
}

/** Shared page chrome matching Employees / Privacy Blocks. */
export const PageHero: React.FC<PageHeroProps> = ({
  icon: Icon,
  title,
  subtitle,
  help,
  action,
}) => (
  <header className="tt-hero">
    <div className="tt-hero-icon" aria-hidden>
      <Icon size={22} strokeWidth={2.1} />
    </div>
    <div className="tt-hero-copy">
      <h1 className="tt-hero-title">
        {title}
        {help ? <HelpTip text={help} /> : null}
      </h1>
      {subtitle ? <p className="tt-hero-subtitle">{subtitle}</p> : null}
    </div>
    {action ? <div className="tt-hero-action">{action}</div> : null}
  </header>
);

interface PageEmptyProps {
  icon: LucideIcon;
  title: string;
  hint?: string;
  action?: React.ReactNode;
}

export const PageEmpty: React.FC<PageEmptyProps> = ({ icon, title, hint, action }) => (
  <div className="tt-empty">
    <EmptyIcon icon={icon} size={44} />
    <h2 className="tt-empty-title">{title}</h2>
    {hint ? <p className="tt-muted">{hint}</p> : null}
    {action ? <div className="tt-empty-action">{action}</div> : null}
  </div>
);

interface PagePanelProps {
  title?: string;
  hint?: string;
  children: React.ReactNode;
  className?: string;
  headAction?: React.ReactNode;
}

export const PagePanel: React.FC<PagePanelProps> = ({
  title,
  hint,
  children,
  className,
  headAction,
}) => (
  <section className={className ? `tt-panel ${className}` : 'tt-panel'}>
    {(title || headAction) && (
      <div className="tt-panel-head">
        <div>
          {title ? <h2 className="tt-panel-title">{title}</h2> : null}
          {hint ? <p className="tt-panel-hint">{hint}</p> : null}
        </div>
        {headAction}
      </div>
    )}
    {children}
  </section>
);

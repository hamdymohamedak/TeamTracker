import React, { useState, useEffect, useCallback } from 'react';
import { Routes, Route, useLocation, useNavigate } from 'react-router-dom';
import {
  LayoutDashboard,
  Users,
  FolderKanban,
  CheckSquare,
  BarChart3,
  Mail,
  Camera,
  Tags,
  Shield,
  EyeOff,
  Settings,
  HelpCircle,
  LogOut,
  Menu,
  X,
  type LucideIcon,
} from 'lucide-react';
import { Dashboard } from '@/pages/Dashboard';
import { Employees } from '@/pages/Employees';
import { Projects } from '@/pages/Projects';
import { Tasks } from '@/pages/Tasks';
import { Reports } from '@/pages/Reports';
import { DailySummary } from '@/pages/DailySummary';
import { Screenshots } from '@/pages/Screenshots';
import { Overrides } from '@/pages/Overrides';
import { PrivacyBlocks } from '@/pages/PrivacyBlocks';
import { Team } from '@/pages/Team';
import { GenesisAI } from '@/components/GenesisAI';
import { OrgSettingsModal } from '@/components/OrgSettingsModal';
import { LanguageSwitcher, useI18n } from '@/contexts/I18nContext';
import { useAuth } from '@/contexts/AuthContext';
import type { TranslationKey } from '@/i18n/translations';

type ConnectionStatus = 'loading' | 'connected' | 'disconnected';
type Page = 'dashboard' | 'employees' | 'projects' | 'tasks' | 'reports' | 'summary' | 'screenshots' | 'overrides' | 'privacy' | 'team';

// ─── Brand block ─────────────────────────────────────────────────────────────

const BrandBlock: React.FC<{ compact?: boolean; onOpenSettings: () => void }> = ({
  compact,
  onOpenSettings,
}) => {
  const { org } = useAuth();
  const { t } = useI18n();
  const name = org?.name || 'TeamTracker';

  return (
    <div
      className={compact ? 'mobile-logo' : 'logo'}
      onClick={onOpenSettings}
      role="button"
      tabIndex={0}
      aria-label={t('shell.orgSettings')}
      title={t('shell.orgSettings')}
      onKeyDown={e => {
        if (e.key === 'Enter' || e.key === ' ') onOpenSettings();
      }}
    >
      <div className="logo-row">
        {org?.logoUrl ? (
          <img
            className="logo-img"
            src={org.logoUrl}
            alt={name}
            onError={e => {
              (e.currentTarget as HTMLImageElement).style.display = 'none';
            }}
          />
        ) : (
          <div className="logo-mark">T</div>
        )}
        <div>
          <h1>{name}</h1>
          <div className="logo-meta">{compact ? t('shell.admin') : t('shell.adminConsole')}</div>
        </div>
      </div>
    </div>
  );
};

// ─── Nav item ────────────────────────────────────────────────────────────────

interface NavItemProps {
  label: string;
  icon: LucideIcon;
  active: boolean;
  onClick: () => void;
}

const NavItem: React.FC<NavItemProps> = ({ label, icon: Icon, active, onClick }) => (
  <button type="button" onClick={onClick} className={`nav-item ${active ? 'active' : ''}`}>
    <span className="nav-icon">
      <Icon size={16} strokeWidth={2.1} />
    </span>
    <span className="nav-label">{label}</span>
  </button>
);

// ─── Main layout ─────────────────────────────────────────────────────────────

export const AppLayout: React.FC = () => {
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>('loading');
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [isMobile, setIsMobile] = useState(window.innerWidth < 768);
  const [showOrgSettings, setShowOrgSettings] = useState(false);
  const location = useLocation();
  const navigate = useNavigate();
  const { logout, user } = useAuth();
  const { t } = useI18n();

  const currentPage = (location.pathname.slice(1) || 'dashboard') as Page;

  useEffect(() => {
    const handleResize = () => {
      setIsMobile(window.innerWidth < 768);
      if (window.innerWidth >= 768) setIsMobileMenuOpen(false);
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  const checkHealth = useCallback(async () => {
    try {
      const response = await fetch('/api/health');
      setConnectionStatus(response.ok ? 'connected' : 'disconnected');
    } catch {
      setConnectionStatus('disconnected');
    }
  }, []);

  useEffect(() => {
    checkHealth();
    const interval = setInterval(checkHealth, 30000);
    return () => clearInterval(interval);
  }, [checkHealth]);

  const handleNavClick = (page: Page) => {
    navigate(`/${page === 'dashboard' ? '' : page}`);
    setIsMobileMenuOpen(false);
  };

  const openSettings = () => setShowOrgSettings(true);

  const nav = (key: TranslationKey, page: Page, icon: LucideIcon) => (
    <NavItem
      key={page}
      icon={icon}
      label={t(key)}
      active={currentPage === page}
      onClick={() => handleNavClick(page)}
    />
  );

  return (
    <div className="app-container">
      {isMobile && (
        <header className="mobile-header">
          <BrandBlock compact onOpenSettings={openSettings} />
          <button
            className="mobile-menu-btn"
            onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
            aria-label="Toggle menu"
          >
            {isMobileMenuOpen ? <X size={20} /> : <Menu size={20} />}
          </button>
        </header>
      )}

      <aside className={`sidebar ${isMobile ? 'mobile' : ''} ${isMobileMenuOpen ? 'open' : ''}`}>
        {!isMobile && <BrandBlock onOpenSettings={openSettings} />}

        <nav className="nav">
          <div className="nav-section-label">{t('shell.overview')}</div>
          {nav('shell.dashboard', 'dashboard', LayoutDashboard)}
          {nav('shell.employees', 'employees', Users)}
          {nav('shell.projects', 'projects', FolderKanban)}
          {nav('shell.tasks', 'tasks', CheckSquare)}

          <div className="nav-section-label">{t('shell.insights')}</div>
          {nav('shell.reports', 'reports', BarChart3)}
          {nav('shell.summary', 'summary', Mail)}
          {nav('shell.screenshots', 'screenshots', Camera)}

          <div className="nav-section-label">{t('shell.workspace')}</div>
          {nav('shell.overrides', 'overrides', Tags)}
          {nav('shell.privacy', 'privacy', EyeOff)}
          {nav('shell.team', 'team', Shield)}
          {isMobile && (
            <NavItem
              icon={Settings}
              label={t('shell.settings')}
              active={false}
              onClick={() => {
                openSettings();
                setIsMobileMenuOpen(false);
              }}
            />
          )}
        </nav>

        <div className="sidebar-footer">
          <LanguageSwitcher variant="sidebar" />
          <a
            className="sidebar-help"
            href="https://github.com/hamdymohamedak/TeamTracker"
            target="_blank"
            rel="noopener noreferrer"
          >
            <HelpCircle size={15} />
            {t('shell.help')}
          </a>
          {user?.name && <div className="sidebar-user">{user.name}</div>}
          <button className="sidebar-signout" onClick={logout} type="button">
            <LogOut size={15} />
            {t('shell.signOut')}
          </button>
          <div className="connection-status">
            <span className={`status-dot ${connectionStatus}`} />
            {connectionStatus === 'loading' && t('shell.connecting')}
            {connectionStatus === 'connected' && t('shell.live')}
            {connectionStatus === 'disconnected' && t('shell.offline')}
          </div>
        </div>
      </aside>

      {isMobile && isMobileMenuOpen && (
        <div className="mobile-overlay" onClick={() => setIsMobileMenuOpen(false)} />
      )}

      <main className="main-content">
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/employees" element={<Employees />} />
          <Route path="/projects" element={<Projects />} />
          <Route path="/tasks" element={<Tasks />} />
          <Route path="/reports" element={<Reports />} />
          <Route path="/summary" element={<DailySummary />} />
          <Route path="/screenshots" element={<Screenshots />} />
          <Route path="/overrides" element={<Overrides />} />
          <Route path="/privacy" element={<PrivacyBlocks />} />
          <Route path="/team" element={<Team />} />
          <Route path="*" element={<Dashboard />} />
        </Routes>
      </main>

      {showOrgSettings && <OrgSettingsModal onClose={() => setShowOrgSettings(false)} />}
      <GenesisAI />
    </div>
  );
};

import React, { useEffect, useState } from 'react';
import { KeyRound, Plus, Trash2, UsersRound } from 'lucide-react';
import { api } from '@/lib/api';
import { useAuth } from '@/contexts/AuthContext';
import { useI18n } from '@/contexts/I18nContext';
import { RecoveryCodesPanel } from '@/components/RecoveryCodesPanel';
import { PageEmpty, PageHero, PagePanel } from '@/components/PageHero';

// Multi-admin team management page.
//
// Backend: GET/POST/DELETE /api/auth/team — see admin/server/routes/auth-routes.ts.
// Password recovery is offline via recovery codes (no paid email required).

interface TeamUser {
  id: string;
  email: string;
  name: string;
  role: 'owner' | 'admin';
  created_at: string;
}

export const Team: React.FC = () => {
  const { t } = useI18n();
  const { user } = useAuth();
  const [users, setUsers] = useState<TeamUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);

  const [showInvite, setShowInvite] = useState(false);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteName, setInviteName] = useState('');
  const [invitePassword, setInvitePassword] = useState('');
  const [inviteRole, setInviteRole] = useState<'admin' | 'owner'>('admin');
  const [submitting, setSubmitting] = useState(false);
  const [inviteCodes, setInviteCodes] = useState<string[] | null>(null);

  const [passwordTarget, setPasswordTarget] = useState<TeamUser | null>(null);
  const [newPassword, setNewPassword] = useState('');
  const [settingPassword, setSettingPassword] = useState(false);

  const [remainingCodes, setRemainingCodes] = useState<number | null>(null);
  const [myNewCodes, setMyNewCodes] = useState<string[] | null>(null);

  const load = async () => {
    try {
      setError(null);
      const res = await api.get('/api/auth/team');
      if (res.success) setUsers(res.data || []);
      else setError(res.error || 'Failed to load team');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load team');
    } finally {
      setLoading(false);
    }
  };

  const loadCodeCount = async () => {
    try {
      const res = await api.get('/api/auth/recovery-codes');
      if (res.success) setRemainingCodes(res.data?.remaining ?? 0);
    } catch {
      /* ignore */
    }
  };

  useEffect(() => {
    load();
    loadCodeCount();
  }, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inviteEmail || !inviteName || invitePassword.length < 6) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await api.post('/api/auth/team', {
        email: inviteEmail,
        name: inviteName,
        password: invitePassword,
        role: inviteRole,
      });
      if (res.success) {
        setFlash(`Invited ${inviteEmail} as ${inviteRole}. Share the password securely.`);
        setTimeout(() => setFlash(null), 8000);
        if (Array.isArray(res.data?.recoveryCodes)) {
          setInviteCodes(res.data.recoveryCodes);
        }
        setShowInvite(false);
        setInviteEmail('');
        setInviteName('');
        setInvitePassword('');
        setInviteRole('admin');
        load();
      } else {
        setError(res.error || 'Failed to invite');
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to invite');
    } finally {
      setSubmitting(false);
    }
  };

  const remove = async (u: TeamUser) => {
    if (u.id === user?.id) {
      alert("You can't remove yourself. Ask another admin to do it.");
      return;
    }
    if (!confirm(`Remove ${u.name} (${u.email}) from the organization? They will lose dashboard access immediately.`)) return;
    try {
      const res = await api.delete(`/api/auth/team/${u.id}`);
      if (res.success) load();
      else setError(res.error || 'Failed to remove user');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to remove user');
    }
  };

  const submitPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!passwordTarget || newPassword.length < 6) return;
    setSettingPassword(true);
    setError(null);
    try {
      const res = await api.post(`/api/auth/team/${passwordTarget.id}/password`, {
        password: newPassword,
      });
      if (res.success) {
        setFlash(res.message || `Password updated for ${passwordTarget.email}`);
        setTimeout(() => setFlash(null), 6000);
        setPasswordTarget(null);
        setNewPassword('');
      } else {
        setError(res.error || 'Failed to set password');
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to set password');
    } finally {
      setSettingPassword(false);
    }
  };

  const regenerateMyCodes = async () => {
    if (!confirm(t('team.regenerateConfirm'))) return;
    try {
      const res = await api.post('/api/auth/recovery-codes/regenerate', {});
      if (res.success && Array.isArray(res.data?.recoveryCodes)) {
        setMyNewCodes(res.data.recoveryCodes);
        setRemainingCodes(res.data.recoveryCodes.length);
      } else {
        setError(res.error || 'Failed to regenerate codes');
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to regenerate codes');
    }
  };

  if (loading) {
    return (
      <div className="tt-page">
        <p className="tt-muted">{t('team.loading')}</p>
      </div>
    );
  }

  return (
    <div className="tt-page">
      <PageHero
        icon={UsersRound}
        title={t('team.title')}
        subtitle={t('team.subtitle')}
        help={t('help.team')}
        action={
          <button
            type="button"
            className="tt-btn tt-btn-primary"
            onClick={() => setShowInvite(!showInvite)}
          >
            {showInvite ? (
              t('common.cancel')
            ) : (
              <>
                <Plus size={16} strokeWidth={2.2} />
                {t('team.invite')}
              </>
            )}
          </button>
        }
      />

      {flash && <div className="tt-flash">{flash}</div>}
      {error && <div className="tt-error-banner">{error}</div>}

      <PagePanel title={t('team.recoverySection')}>
        {myNewCodes ? (
          <RecoveryCodesPanel codes={myNewCodes} onContinue={() => setMyNewCodes(null)} />
        ) : (
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
            <p className="tt-muted">
              {t('team.recoveryRemaining').replace(
                '{count}',
                String(remainingCodes ?? '—')
              )}
            </p>
            <button type="button" onClick={regenerateMyCodes} className="tt-btn tt-btn-ghost">
              {t('team.regenerateCodes')}
            </button>
          </div>
        )}
      </PagePanel>

      {inviteCodes && (
        <PagePanel title={t('team.inviteCodesNote')}>
          <RecoveryCodesPanel codes={inviteCodes} onContinue={() => setInviteCodes(null)} />
        </PagePanel>
      )}

      {showInvite && (
        <PagePanel title={t('team.inviteTitle')}>
          <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
              <div className="tt-field" style={{ flex: 1, minWidth: 200 }}>
                <label className="tt-field-label" htmlFor="invite-name">
                  {t('team.name')}
                </label>
                <input
                  id="invite-name"
                  type="text"
                  className="tt-input"
                  value={inviteName}
                  onChange={e => setInviteName(e.target.value)}
                  required
                />
              </div>
              <div className="tt-field" style={{ flex: 1, minWidth: 200 }}>
                <label className="tt-field-label" htmlFor="invite-email">
                  {t('team.email')}
                </label>
                <input
                  id="invite-email"
                  type="email"
                  className="tt-input"
                  value={inviteEmail}
                  onChange={e => setInviteEmail(e.target.value)}
                  required
                />
              </div>
            </div>
            <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
              <div className="tt-field" style={{ flex: 1, minWidth: 200 }}>
                <label className="tt-field-label" htmlFor="invite-password">
                  {t('team.tempPassword')}
                </label>
                <input
                  id="invite-password"
                  type="text"
                  className="tt-input"
                  value={invitePassword}
                  onChange={e => setInvitePassword(e.target.value)}
                  required
                  minLength={6}
                />
              </div>
              <div className="tt-field" style={{ width: 160, minWidth: 160 }}>
                <label className="tt-field-label" htmlFor="invite-role">
                  {t('team.role')}
                </label>
                <select
                  id="invite-role"
                  className="tt-input"
                  value={inviteRole}
                  onChange={e => setInviteRole(e.target.value as 'admin' | 'owner')}
                >
                  <option value="admin">{t('team.roleAdmin')}</option>
                  <option value="owner">{t('team.roleOwner')}</option>
                </select>
              </div>
            </div>
            <div>
              <button type="submit" disabled={submitting} className="tt-btn tt-btn-primary">
                {submitting ? t('team.inviting') : t('team.inviteSubmit')}
              </button>
            </div>
          </form>
        </PagePanel>
      )}

      {passwordTarget && (
        <PagePanel title={t('team.setPasswordTitle').replace('{name}', passwordTarget.name)}>
          <p className="tt-panel-hint" style={{ marginTop: 0 }}>
            {t('team.setPasswordHint')}
          </p>
          <form onSubmit={submitPassword} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div className="tt-field">
              <label className="tt-field-label" htmlFor="new-password">
                {t('team.newPassword')}
              </label>
              <input
                id="new-password"
                type="text"
                className="tt-input"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                required
                minLength={6}
              />
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button type="submit" disabled={settingPassword} className="tt-btn tt-btn-primary">
                {settingPassword ? t('team.saving') : t('common.save')}
              </button>
              <button
                type="button"
                onClick={() => {
                  setPasswordTarget(null);
                  setNewPassword('');
                }}
                className="tt-btn tt-btn-ghost"
              >
                {t('common.cancel')}
              </button>
            </div>
          </form>
        </PagePanel>
      )}

      <PagePanel title={t('team.activeTitle', { count: users.length })}>
        {users.length === 0 ? (
          <PageEmpty
            icon={UsersRound}
            title={t('team.empty')}
            hint={t('team.emptyHint')}
            action={
              !showInvite ? (
                <button
                  type="button"
                  className="tt-btn tt-btn-primary"
                  onClick={() => setShowInvite(true)}
                >
                  <Plus size={16} strokeWidth={2.2} />
                  {t('team.invite')}
                </button>
              ) : undefined
            }
          />
        ) : (
          <div style={{ overflowX: 'auto', WebkitOverflowScrolling: 'touch' }}>
            <table className="tt-data-table" style={{ minWidth: 560 }}>
              <thead>
                <tr>
                  <th>{t('team.colName')}</th>
                  <th>{t('team.colEmail')}</th>
                  <th>{t('team.colRole')}</th>
                  <th>{t('team.colJoined')}</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {users.map(u => (
                  <tr key={u.id}>
                    <td>
                      {u.name}
                      {u.id === user?.id && (
                        <span className="tt-chip" style={{ marginLeft: 8 }}>{t('team.you')}</span>
                      )}
                    </td>
                    <td>{u.email}</td>
                    <td>
                      <span className="tt-chip">
                        {u.role === 'owner' ? t('team.roleOwner') : t('team.roleAdmin')}
                      </span>
                    </td>
                    <td>{new Date(u.created_at).toLocaleDateString()}</td>
                    <td>
                      {u.id !== user?.id && (
                        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                          <button
                            type="button"
                            className="tt-action-btn"
                            onClick={() => { setPasswordTarget(u); setNewPassword(''); }}
                          >
                            <KeyRound size={14} strokeWidth={2.2} />
                            {t('team.setPassword')}
                          </button>
                          <button
                            type="button"
                            className="tt-action-btn tt-action-btn-danger"
                            onClick={() => remove(u)}
                          >
                            <Trash2 size={14} strokeWidth={2.2} />
                            {t('team.remove')}
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </PagePanel>
    </div>
  );
};

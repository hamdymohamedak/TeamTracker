import React, { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { useAuth } from '../contexts/AuthContext';
import { useI18n } from '../contexts/I18nContext';
import { HelpTip } from '../components/HelpTip';
import { RecoveryCodesPanel } from '../components/RecoveryCodesPanel';
import { StatusLine } from '../components/Icon';

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

  if (loading) return <div style={styles.container}><p>{t('team.loading')}</p></div>;

  return (
    <div style={styles.container}>
      <header style={styles.header}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '12px' }}>
          <div>
            <h1 style={{ ...styles.title, display: 'flex', alignItems: 'center', gap: 8 }}>
              {t('team.title')}
              <HelpTip text={t('help.team')} />
            </h1>
            <p style={styles.subtitle}>{t('team.subtitle')}</p>
          </div>
          <button onClick={() => setShowInvite(!showInvite)} style={styles.primaryBtn}>
            {showInvite ? t('common.cancel') : t('team.invite')}
          </button>
        </div>
      </header>

      {flash && (
        <div style={styles.flash}>
          <StatusLine variant="success">{flash}</StatusLine>
        </div>
      )}
      {error && (
        <div style={styles.error}>
          <StatusLine variant="error">{error}</StatusLine>
        </div>
      )}

      <section style={styles.card}>
        <h2 style={styles.cardTitle}>{t('team.recoverySection')}</h2>
        {myNewCodes ? (
          <RecoveryCodesPanel codes={myNewCodes} onContinue={() => setMyNewCodes(null)} />
        ) : (
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
            <p style={{ margin: 0, fontSize: 14, color: 'var(--tt-text-muted)' }}>
              {t('team.recoveryRemaining').replace(
                '{count}',
                String(remainingCodes ?? '—')
              )}
            </p>
            <button type="button" onClick={regenerateMyCodes} style={styles.secondaryBtn}>
              {t('team.regenerateCodes')}
            </button>
          </div>
        )}
      </section>

      {inviteCodes && (
        <section style={styles.card}>
          <h2 style={styles.cardTitle}>{t('team.inviteCodesNote')}</h2>
          <RecoveryCodesPanel codes={inviteCodes} onContinue={() => setInviteCodes(null)} />
        </section>
      )}

      {showInvite && (
        <section style={styles.card}>
          <h2 style={styles.cardTitle}>{t('team.inviteTitle')}</h2>
          <form onSubmit={submit} style={styles.form}>
            <div style={styles.row}>
              <label style={styles.label}>
                Name
                <input type="text" value={inviteName} onChange={e => setInviteName(e.target.value)} required style={styles.input} />
              </label>
              <label style={styles.label}>
                Email
                <input type="email" value={inviteEmail} onChange={e => setInviteEmail(e.target.value)} required style={styles.input} />
              </label>
            </div>
            <div style={styles.row}>
              <label style={styles.label}>
                Temporary password (≥ 6 chars — share securely)
                <input type="text" value={invitePassword} onChange={e => setInvitePassword(e.target.value)} required minLength={6} style={styles.input} />
              </label>
              <label style={{ ...styles.label, width: '160px' }}>
                Role
                <select value={inviteRole} onChange={e => setInviteRole(e.target.value as any)} style={styles.input}>
                  <option value="admin">Admin</option>
                  <option value="owner">Owner</option>
                </select>
              </label>
            </div>
            <button type="submit" disabled={submitting} style={styles.primaryBtn}>
              {submitting ? 'Inviting…' : 'Invite'}
            </button>
          </form>
        </section>
      )}

      {passwordTarget && (
        <section style={styles.card}>
          <h2 style={styles.cardTitle}>
            {t('team.setPasswordTitle').replace('{name}', passwordTarget.name)}
          </h2>
          <p style={{ fontSize: 13, color: 'var(--tt-text-muted)', marginTop: 0 }}>
            {t('team.setPasswordHint')}
          </p>
          <form onSubmit={submitPassword} style={styles.form}>
            <label style={styles.label}>
              New password
              <input
                type="text"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                required
                minLength={6}
                style={styles.input}
              />
            </label>
            <div style={{ display: 'flex', gap: 8 }}>
              <button type="submit" disabled={settingPassword} style={styles.primaryBtn}>
                {settingPassword ? 'Saving…' : t('common.save')}
              </button>
              <button
                type="button"
                onClick={() => {
                  setPasswordTarget(null);
                  setNewPassword('');
                }}
                style={styles.secondaryBtn}
              >
                {t('common.cancel')}
              </button>
            </div>
          </form>
        </section>
      )}

      <section style={styles.card}>
        <h2 style={styles.cardTitle}>Active dashboard users ({users.length})</h2>
        <div style={{ overflowX: 'auto', WebkitOverflowScrolling: 'touch' }}>
        <table style={styles.table}>
          <thead>
            <tr>
              <th style={styles.th}>Name</th>
              <th style={styles.th}>Email</th>
              <th style={styles.th}>Role</th>
              <th style={styles.th}>Joined</th>
              <th style={styles.th}></th>
            </tr>
          </thead>
          <tbody>
            {users.map(u => (
              <tr key={u.id}>
                <td style={styles.td}>
                  {u.name}
                  {u.id === user?.id && <span style={styles.youTag}>you</span>}
                </td>
                <td style={styles.td}>{u.email}</td>
                <td style={styles.td}><span style={styles.roleTag(u.role)}>{u.role}</span></td>
                <td style={styles.td}>{new Date(u.created_at).toLocaleDateString()}</td>
                <td style={{ ...styles.td, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  {u.id !== user?.id && (
                    <>
                      <button onClick={() => { setPasswordTarget(u); setNewPassword(''); }} style={styles.secondaryBtn}>
                        {t('team.setPassword')}
                      </button>
                      <button onClick={() => remove(u)} style={styles.deleteBtn}>Remove</button>
                    </>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
      </section>
    </div>
  );
};

const styles: { [key: string]: any } = {
  container: { padding: 'clamp(16px, 4vw, 32px)' },
  header: { marginBottom: '24px' },
  title: { fontSize: '28px', fontWeight: 600, color: 'var(--tt-text)', margin: 0 },
  subtitle: { fontSize: '14px', color: 'var(--tt-text-muted)', marginTop: '8px' },
  primaryBtn: { padding: '10px 20px', backgroundColor: 'var(--tt-teal)', color: '#fff', border: 'none', borderRadius: '6px', fontSize: '14px', fontWeight: 600, cursor: 'pointer' },
  secondaryBtn: { padding: '8px 14px', backgroundColor: 'var(--tt-surface-muted)', color: 'var(--tt-text)', border: '1px solid var(--tt-border-strong)', borderRadius: '6px', fontSize: '13px', fontWeight: 600, cursor: 'pointer' },
  card: { backgroundColor: 'var(--tt-surface)', padding: '24px', borderRadius: 'var(--tt-radius)', boxShadow: 'var(--tt-shadow-sm)', marginBottom: '24px' },
  cardTitle: { fontSize: '18px', fontWeight: 600, color: 'var(--tt-text)', marginTop: 0, marginBottom: '16px' },
  form: { display: 'flex', flexDirection: 'column', gap: '16px' },
  row: { display: 'flex', gap: '16px', flexWrap: 'wrap' },
  label: { display: 'flex', flexDirection: 'column', gap: '6px', fontSize: '13px', fontWeight: 600, color: 'var(--tt-text)', flex: 1, minWidth: '200px' },
  input: { padding: '10px 12px', border: '1px solid #d0d7de', borderRadius: '6px', fontSize: '14px', fontWeight: 400 },
  table: { width: '100%', borderCollapse: 'collapse', minWidth: '560px' },
  th: { textAlign: 'left', padding: '10px 12px', borderBottom: '2px solid #e0e6ed', fontSize: '12px', textTransform: 'uppercase', color: 'var(--tt-text-muted)', fontWeight: 600 },
  td: { padding: '10px 12px', borderBottom: '1px solid #f1f5f9', fontSize: '14px', color: 'var(--tt-text)' },
  deleteBtn: { padding: '6px 12px', backgroundColor: 'rgba(232, 93, 76, 0.25)', color: '#dc2626', border: 'none', borderRadius: '4px', fontSize: '12px', fontWeight: 600, cursor: 'pointer' },
  youTag: { marginLeft: '8px', backgroundColor: '#e0f2fe', color: '#0369a1', padding: '2px 8px', borderRadius: '4px', fontSize: '11px', fontWeight: 600 },
  roleTag: (role: string) => ({
    display: 'inline-block',
    padding: '3px 10px',
    borderRadius: '4px',
    fontSize: '11px',
    fontWeight: 700,
    textTransform: 'uppercase',
    backgroundColor: role === 'owner' ? '#fef3c7' : '#e0e7ff',
    color: role === 'owner' ? '#92400e' : '#3730a3'
  }),
  flash: { backgroundColor: '#d4edda', color: '#155724', padding: '12px 16px', borderRadius: 'var(--tt-radius-sm)', marginBottom: '16px', fontSize: '14px' },
  error: { backgroundColor: 'var(--tt-danger-soft)', color: 'var(--tt-danger)', padding: '12px 16px', borderRadius: 'var(--tt-radius-sm)', marginBottom: '16px', fontSize: '14px' },
};

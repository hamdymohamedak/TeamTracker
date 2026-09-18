import React, { useState, useEffect } from 'react';
import { api } from '@/lib/api';
import type { Project } from '../../../../shared-types';
import { SUPPORTED_CURRENCIES, formatCurrency } from '../../../../shared-types';
import { useAuth } from '@/contexts/AuthContext';
import { useI18n } from '@/contexts/I18nContext';
import { PageHero, PageEmpty } from '@/components/PageHero';
import { EmptyIcon, ModalCloseButton, StatusLine } from '@/components/Icon';
import { AlertTriangle, Briefcase, Calendar, DollarSign, Pencil, Plus, Trash2, User } from 'lucide-react';

const statusBadgeStyle = (color: string): React.CSSProperties => ({
  padding: '4px 8px',
  borderRadius: '999px',
  fontSize: '11px',
  fontWeight: 650,
  textTransform: 'uppercase',
  backgroundColor: `${color}20`,
  color,
  flexShrink: 0,
});

export const Projects: React.FC = () => {
  const { t } = useI18n();
  const { org } = useAuth();
  const defaultCurrency = org?.defaultCurrency || 'USD';
  const currencySymbol = SUPPORTED_CURRENCIES.find(c => c.code === defaultCurrency)?.symbol || '$';
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [editingProject, setEditingProject] = useState<Project | null>(null);
  const [formData, setFormData] = useState({
    name: '',
    description: '',
    clientName: '',
    budget: ''
  });

  useEffect(() => {
    loadProjects();
  }, []);

  const loadProjects = async () => {
    try {
      setError(null);
      const data = await api.get('/api/projects');
      if (data.success) {
        setProjects(data.data);
      } else {
        throw new Error(data.error || 'Failed to load projects');
      }
    } catch (err) {
      console.error('Error loading projects:', err);
      setError(err instanceof Error ? err.message : 'Failed to load projects');
    } finally {
      setLoading(false);
    }
  };

  const openCreate = () => {
    setEditingProject(null);
    setFormData({ name: '', description: '', clientName: '', budget: '' });
    setFormError(null);
    setShowForm(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);

    if (!formData.name.trim()) {
      setFormError('Project name is required');
      return;
    }

    const url = editingProject
      ? `/api/projects/${editingProject.id}`
      : '/api/projects';

    try {
      const payload = {
        ...formData,
        budget: parseFloat(formData.budget) || 0
      };

      const data = editingProject
        ? await api.put(url, payload)
        : await api.post(url, payload);

      if (data.success) {
        setShowForm(false);
        setEditingProject(null);
        setFormData({ name: '', description: '', clientName: '', budget: '' });
        loadProjects();
      } else {
        throw new Error(data.error || 'Failed to save project');
      }
    } catch (err) {
      console.error('Error saving project:', err);
      setFormError(err instanceof Error ? err.message : 'Failed to save project');
    }
  };

  const handleEdit = (project: Project) => {
    setEditingProject(project);
    setFormData({
      name: project.name,
      description: project.description || '',
      clientName: project.clientName || '',
      budget: project.budget?.toString() || ''
    });
    setFormError(null);
    setShowForm(true);
  };

  const handleDelete = async (project: Project) => {
    const tasksWarning = 'Any tasks under this project will also be deleted.';
    if (!confirm(`Delete "${project.name}"? ${tasksWarning}`)) return;
    try {
      const data = await api.delete(`/api/projects/${project.id}`);
      if (!data.success) throw new Error(data.error || 'Failed to delete project');
      loadProjects();
    } catch (err) {
      console.error('Error deleting project:', err);
      setError(err instanceof Error ? err.message : 'Failed to delete project');
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'active': return 'var(--tt-success)';
      case 'completed': return 'var(--tt-teal)';
      case 'archived': return 'var(--tt-text-faint)';
      default: return 'var(--tt-text-muted)';
    }
  };

  if (loading) {
    return (
      <div className="tt-page">
        <p className="tt-muted">{t('common.loading')}</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="tt-page">
        <div className="tt-empty">
          <EmptyIcon icon={AlertTriangle} size={40} color="var(--tt-danger)" />
          <h2 className="tt-empty-title">{t('projects.loadFailed')}</h2>
          <p className="tt-muted">{error}</p>
          <div className="tt-empty-action">
            <button type="button" className="tt-btn tt-btn-primary" onClick={loadProjects}>
              {t('common.retry')}
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="tt-page">
      <PageHero
        icon={Briefcase}
        title={t('projects.title')}
        subtitle={t('projects.subtitle')}
        help={t('help.projects')}
        action={
          <button type="button" className="tt-btn tt-btn-primary" onClick={openCreate}>
            <Plus size={16} strokeWidth={2.4} />
            {t('projects.add')}
          </button>
        }
      />

      {showForm && (
        <div
          className="tt-modal-overlay"
          role="dialog"
          aria-modal="true"
          aria-labelledby="modal-title"
          onClick={() => setShowForm(false)}
        >
          <div className="tt-modal tt-modal--md" onClick={e => e.stopPropagation()}>
            <div className="tt-modal-header">
              <h2 id="modal-title" className="tt-modal-title">
                {editingProject ? t('projects.edit') : t('projects.addTitle')}
              </h2>
              <ModalCloseButton onClick={() => setShowForm(false)} />
            </div>
            <form onSubmit={handleSubmit} style={{ display: 'contents' }}>
              <div className="tt-modal-body">
                {formError && (
                  <div className="tt-error-banner">
                    <StatusLine variant="error">{formError}</StatusLine>
                  </div>
                )}
                <div className="tt-modal-form tt-modal-form--2col">
                  <div className="tt-field tt-field-span-2">
                    <label className="tt-field-label">{t('projects.name')} *</label>
                    <input
                      type="text"
                      className="tt-input"
                      placeholder="e.g. Smith Residence"
                      value={formData.name}
                      onChange={e => setFormData({ ...formData, name: e.target.value })}
                      required
                    />
                  </div>
                  <div className="tt-field tt-field-span-2">
                    <label className="tt-field-label">{t('projects.description')}</label>
                    <textarea
                      className="tt-input"
                      placeholder="Project details..."
                      value={formData.description}
                      onChange={e => setFormData({ ...formData, description: e.target.value })}
                      style={{ minHeight: '80px', resize: 'vertical' }}
                    />
                  </div>
                  <div className="tt-field">
                    <label className="tt-field-label">{t('projects.client')}</label>
                    <input
                      type="text"
                      className="tt-input"
                      placeholder="e.g. John Smith"
                      value={formData.clientName}
                      onChange={e => setFormData({ ...formData, clientName: e.target.value })}
                    />
                  </div>
                  <div className="tt-field">
                    <label className="tt-field-label">
                      {t('projects.budget')} ({currencySymbol} {defaultCurrency})
                    </label>
                    <input
                      type="number"
                      className="tt-input"
                      placeholder="e.g. 50000"
                      value={formData.budget}
                      onChange={e => setFormData({ ...formData, budget: e.target.value })}
                      min="0"
                      step="1000"
                    />
                  </div>
                </div>
              </div>
              <div className="tt-modal-footer">
                <button type="button" className="tt-btn tt-btn-ghost" onClick={() => setShowForm(false)}>
                  {t('common.cancel')}
                </button>
                <button type="submit" className="tt-btn tt-btn-primary">
                  {editingProject ? t('projects.update') : t('projects.create')}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {projects.length === 0 ? (
        <PageEmpty
          icon={Briefcase}
          title={t('projects.empty')}
          hint={t('projects.emptyHint')}
          action={
            <button type="button" className="tt-btn tt-btn-primary" onClick={openCreate}>
              <Plus size={16} strokeWidth={2.4} />
              {t('projects.addFirst')}
            </button>
          }
        />
      ) : (
        <div className="tt-card-grid">
          {projects.map(project => (
            <article key={project.id} className="tt-entity-card">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
                <h3 style={{ margin: 0, fontSize: 16, fontWeight: 650, color: 'var(--tt-text)', lineHeight: 1.35 }}>
                  {project.name}
                </h3>
                <span style={statusBadgeStyle(getStatusColor(project.status))}>
                  {project.status}
                </span>
              </div>

              {project.description ? (
                <p className="tt-muted" style={{ margin: 0 }}>{project.description}</p>
              ) : null}

              <div className="tt-meta-chips">
                {project.clientName ? (
                  <span className="tt-chip">
                    <User size={12} strokeWidth={2.1} />
                    {project.clientName}
                  </span>
                ) : null}
                {project.budget ? (
                  <span className="tt-chip">
                    <DollarSign size={12} strokeWidth={2.1} />
                    {formatCurrency(project.budget, defaultCurrency)}
                  </span>
                ) : null}
                <span className="tt-chip">
                  <Calendar size={12} strokeWidth={2.1} />
                  {new Date(project.startDate).toLocaleDateString()}
                </span>
              </div>

              <div className="tt-entity-card-actions">
                <button
                  type="button"
                  className="tt-action-btn"
                  onClick={() => handleEdit(project)}
                  title={t('common.edit')}
                >
                  <Pencil size={14} strokeWidth={2.1} />
                  {t('common.edit')}
                </button>
                <button
                  type="button"
                  className="tt-action-btn tt-action-btn-danger"
                  onClick={() => handleDelete(project)}
                  title={t('common.delete')}
                >
                  <Trash2 size={14} strokeWidth={2.1} />
                  {t('common.delete')}
                </button>
              </div>
            </article>
          ))}
        </div>
      )}
    </div>
  );
};

import React, { useState, useEffect } from 'react';
import { api } from '../lib/api';
import type { Project } from '../../../shared-types';
import { SUPPORTED_CURRENCIES, formatCurrency } from '../../../shared-types';
import { useAuth } from '../contexts/AuthContext';

export const Projects: React.FC = () => {
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

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);

    // Validation
    if (!formData.name.trim()) {
      setFormError('Project name is required');
      return;
    }

    const url = editingProject
      ? `/api/projects/${editingProject.id}`
      : '/api/projects';

    const method = editingProject ? 'PUT' : 'POST';

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
    return <div style={styles.loading}>Loading...</div>;
  }

  if (error) {
    return (
      <div style={styles.container}>
        <div style={errorStyles.container}>
          <div style={errorStyles.icon}>⚠️</div>
          <h2 style={errorStyles.title}>Error Loading Projects</h2>
          <p style={errorStyles.message}>{error}</p>
          <button onClick={loadProjects} style={errorStyles.retryButton}>
            Retry
          </button>
        </div>
      </div>
    );
  }

  return (
    <div style={styles.container}>
      <header style={styles.header}>
        <h1 style={styles.title}>Projects</h1>
        <button
          style={styles.addButton}
          onClick={() => {
            setEditingProject(null);
            setFormData({ name: '', description: '', clientName: '', budget: '' });
            setShowForm(true);
          }}
        >
          + Add Project
        </button>
      </header>

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
                {editingProject ? 'Edit Project' : 'Add Project'}
              </h2>
              <button type="button" className="tt-modal-close" aria-label="Close" onClick={() => setShowForm(false)}>✕</button>
            </div>
            <form onSubmit={handleSubmit} style={{ display: 'contents' }}>
              <div className="tt-modal-body">
                {formError && (
                  <div style={styles.errorBanner}>
                    ⚠️ {formError}
                  </div>
                )}
                <div className="tt-modal-form tt-modal-form--2col">
                  <div className="tt-field tt-field-span-2">
                    <label className="tt-field-label">Project Name *</label>
                    <input
                      type="text"
                      className="tt-input"
                      placeholder="e.g. Smith Residence"
                      value={formData.name}
                      onChange={e => setFormData({...formData, name: e.target.value})}
                      required
                    />
                  </div>
                  <div className="tt-field tt-field-span-2">
                    <label className="tt-field-label">Description</label>
                    <textarea
                      className="tt-input"
                      placeholder="Project details..."
                      value={formData.description}
                      onChange={e => setFormData({...formData, description: e.target.value})}
                      style={{ minHeight: '80px', resize: 'vertical' }}
                    />
                  </div>
                  <div className="tt-field">
                    <label className="tt-field-label">Client Name</label>
                    <input
                      type="text"
                      className="tt-input"
                      placeholder="e.g. John Smith"
                      value={formData.clientName}
                      onChange={e => setFormData({...formData, clientName: e.target.value})}
                    />
                  </div>
                  <div className="tt-field">
                    <label className="tt-field-label">Budget ({currencySymbol} {defaultCurrency})</label>
                    <input
                      type="number"
                      className="tt-input"
                      placeholder="e.g. 50000"
                      value={formData.budget}
                      onChange={e => setFormData({...formData, budget: e.target.value})}
                      min="0"
                      step="1000"
                    />
                  </div>
                </div>
              </div>
              <div className="tt-modal-footer">
                <button type="button" className="tt-btn tt-btn-ghost" onClick={() => setShowForm(false)}>Cancel</button>
                <button type="submit" className="tt-btn tt-btn-primary">
                  {editingProject ? 'Update' : 'Create'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {projects.length === 0 && (
        <div style={{
          textAlign: 'center' as const,
          padding: '60px 20px',
          backgroundColor: 'var(--tt-surface)',
          borderRadius: 'var(--tt-radius)',
          boxShadow: 'var(--tt-shadow-sm)',
        }}>
          <div style={{ fontSize: '48px', marginBottom: '16px' }}>💼</div>
          <h2 style={{ fontSize: '20px', fontWeight: 600, color: 'var(--tt-text)', margin: '0 0 8px' }}>
            No projects yet
          </h2>
          <p style={{ fontSize: '14px', color: 'var(--tt-text-muted)', margin: '0 0 24px' }}>
            Projects help you organize work and track time per client.
          </p>
          <button
            onClick={() => {
              setEditingProject(null);
              setFormData({ name: '', description: '', clientName: '', budget: '' });
              setShowForm(true);
            }}
            style={{
              padding: '12px 32px',
              backgroundColor: 'var(--tt-success)',
              color: '#fff',
              border: 'none',
              borderRadius: 'var(--tt-radius-sm)',
              cursor: 'pointer',
              fontSize: '15px',
              fontWeight: 600,
            }}
          >
            + Add First Project
          </button>
        </div>
      )}

      <div style={styles.grid}>
        {projects.map(project => (
          <div key={project.id} style={styles.card}>
            <div style={styles.cardHeader}>
              <h3 style={styles.projectName}>{project.name}</h3>
              <span style={styles.statusBadge(getStatusColor(project.status))}>
                {project.status}
              </span>
            </div>
            <div style={styles.cardBody}>
              {project.description && (
                <p style={styles.description}>{project.description}</p>
              )}
              {project.clientName && (
                <p style={styles.info}>👤 {project.clientName}</p>
              )}
              {project.budget ? (
                <p style={styles.info}>
                  💰 Budget: {formatCurrency(project.budget, defaultCurrency)}
                </p>
              ) : null}
              <p style={styles.info}>
                📅 Started: {new Date(project.startDate).toLocaleDateString()}
              </p>
            </div>
            <div style={styles.cardActions}>
              <button onClick={() => handleEdit(project)} style={styles.editButton}>
                Edit
              </button>
              <button onClick={() => handleDelete(project)} style={styles.deleteButton}>
                Delete
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

const errorStyles: { [key: string]: React.CSSProperties } = {
  container: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '40px',
    textAlign: 'center'
  },
  icon: {
    fontSize: '48px',
    marginBottom: '16px'
  },
  title: {
    fontSize: '24px',
    fontWeight: 600,
    color: 'var(--tt-danger)',
    marginBottom: '8px'
  },
  message: {
    fontSize: '16px',
    color: 'var(--tt-text-muted)',
    marginBottom: '24px'
  },
  retryButton: {
    padding: '12px 24px',
    backgroundColor: 'var(--tt-teal)',
    color: '#fff',
    border: 'none',
    borderRadius: 'var(--tt-radius-sm)',
    fontSize: '16px',
    fontWeight: 500,
    cursor: 'pointer'
  }
};

const styles: { [key: string]: React.CSSProperties | any } = {
  container: {
    padding: '32px'
  },
  loading: {
    padding: '40px',
    textAlign: 'center'
  },
  errorBanner: {
    backgroundColor: 'var(--tt-danger-soft)',
    border: '1px solid rgba(232, 93, 76, 0.25)',
    color: 'var(--tt-danger)',
    padding: '12px 16px',
    borderRadius: 'var(--tt-radius-sm)',
    marginBottom: '16px',
    fontWeight: 500
  },
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: '24px'
  },
  title: {
    fontSize: 'clamp(1.5rem, 2.2vw, 1.9rem)',
    fontWeight: 750,
    fontFamily: 'var(--tt-font-display)',
    letterSpacing: '-0.02em',
    color: 'var(--tt-text)'
  },
  addButton: {
    padding: '12px 24px',
    backgroundColor: 'var(--tt-success)',
    color: '#fff',
    border: 'none',
    borderRadius: 'var(--tt-radius-sm)',
    cursor: 'pointer',
    fontSize: '14px',
    fontWeight: 500
  },
  modal: {
    position: 'fixed',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.5)',
    display: 'flex',
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 1000
  },
  modalContent: {
    backgroundColor: 'var(--tt-surface)',
    padding: '32px',
    borderRadius: 'var(--tt-radius)',
    width: '100%',
    maxWidth: '450px'
  },
  modalTitle: {
    marginBottom: '20px',
    color: 'var(--tt-text)'
  },
  form: {
    display: 'flex',
    flexDirection: 'column',
    gap: '16px'
  },
  inputGroup: {
    display: 'flex',
    flexDirection: 'column',
    gap: '6px'
  },
  label: {
    fontSize: '13px',
    fontWeight: 500,
    color: 'var(--tt-text-muted)'
  },
  input: {
    padding: '12px',
    border: '1px solid #ddd',
    borderRadius: '6px',
    fontSize: '14px',
    fontFamily: 'inherit'
  },
  formButtons: {
    display: 'flex',
    gap: '12px',
    marginTop: '8px'
  },
  cancelButton: {
    flex: 1,
    padding: '12px',
    backgroundColor: 'var(--tt-surface-muted)',
    border: 'none',
    borderRadius: '6px',
    cursor: 'pointer'
  },
  saveButton: {
    flex: 1,
    padding: '12px',
    backgroundColor: 'var(--tt-success)',
    color: '#fff',
    border: 'none',
    borderRadius: '6px',
    cursor: 'pointer',
    fontWeight: 500
  },
  grid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(350px, 1fr))',
    gap: '16px'
  },
  card: {
    backgroundColor: 'var(--tt-surface)',
    padding: '20px',
    borderRadius: 'var(--tt-radius)',
    boxShadow: 'var(--tt-shadow-sm)'
  },
  cardHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: '12px'
  },
  projectName: {
    fontSize: '18px',
    fontWeight: 600,
    color: 'var(--tt-text)',
    margin: 0,
    flex: 1
  },
  statusBadge: (color: string) => ({
    padding: '4px 8px',
    borderRadius: '4px',
    fontSize: '11px',
    fontWeight: 600,
    textTransform: 'uppercase',
    backgroundColor: `${color}20`,
    color: color
  }),
  cardBody: {
    marginBottom: '16px'
  },
  description: {
    fontSize: '14px',
    color: 'var(--tt-text-muted)',
    marginBottom: '12px',
    lineHeight: 1.5
  },
  info: {
    fontSize: '13px',
    color: 'var(--tt-text-muted)',
    margin: '4px 0'
  },
  cardActions: {
    display: 'flex',
    gap: '8px'
  },
  editButton: {
    flex: 1,
    padding: '8px',
    backgroundColor: 'var(--tt-teal)',
    color: '#fff',
    border: 'none',
    borderRadius: '6px',
    cursor: 'pointer',
    fontSize: '13px'
  },
  deleteButton: {
    flex: 1,
    padding: '8px',
    backgroundColor: 'var(--tt-danger)',
    color: '#fff',
    border: 'none',
    borderRadius: '6px',
    cursor: 'pointer',
    fontSize: '13px'
  }
};

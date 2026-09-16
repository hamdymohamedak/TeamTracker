import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../lib/api';
import type { Task, Project, Employee } from '../../../shared-types';
import { useI18n } from '../contexts/I18nContext';
import { HelpTip } from '../components/HelpTip';
import { EmptyIcon, IconLabel, ModalCloseButton, StatusLine } from '../components/Icon';
import { AlertTriangle, CheckSquare, FolderKanban, Timer, User } from 'lucide-react';

export const Tasks: React.FC = () => {
  const { t } = useI18n();
  const navigate = useNavigate();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [editingTask, setEditingTask] = useState<Task | null>(null);
  const [formData, setFormData] = useState({
    name: '',
    description: '',
    projectId: '',
    assignedTo: '',
    priority: 'medium',
    estimatedHours: '',
    status: 'todo'
  });

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      setError(null);
      const [tasksData, projectsData, employeesData] = await Promise.all([
        api.get('/api/tasks'),
        api.get('/api/projects'),
        api.get('/api/employees')
      ]);

      if (tasksData.success) setTasks(tasksData.data);
      if (projectsData.success) setProjects(projectsData.data);
      if (employeesData.success) setEmployees(employeesData.data);
    } catch (err) {
      console.error('Error loading tasks:', err);
      setError(err instanceof Error ? err.message : 'Failed to load data');
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);

    // Validation
    if (!formData.name.trim()) {
      setFormError('Task name is required');
      return;
    }
    if (!formData.projectId) {
      setFormError('Please select a project');
      return;
    }

    const url = editingTask
      ? `/api/tasks/${editingTask.id}`
      : '/api/tasks';

    try {
      const payload = {
        ...formData,
        estimatedHours: parseFloat(formData.estimatedHours) || 0
      };

      const data = editingTask
        ? await api.put(url, payload)
        : await api.post(url, payload);

      if (data.success) {
        setShowForm(false);
        setEditingTask(null);
        setFormData({ name: '', description: '', projectId: '', assignedTo: '', priority: 'medium', estimatedHours: '', status: 'todo' });
        loadData();
      } else {
        throw new Error(data.error || 'Failed to save task');
      }
    } catch (err) {
      console.error('Error saving task:', err);
      setFormError(err instanceof Error ? err.message : 'Failed to save task');
    }
  };

  const handleEdit = (task: Task) => {
    setEditingTask(task);
    setFormData({
      name: task.name,
      description: task.description || '',
      projectId: task.projectId,
      assignedTo: task.assignedTo || '',
      priority: task.priority,
      estimatedHours: task.estimatedHours?.toString() || '',
      status: task.status
    });
    setShowForm(true);
  };

  const handleStatusChange = async (task: Task, newStatus: string) => {
    try {
      const data = await api.put(`/api/tasks/${task.id}`, { status: newStatus });
      if (data.success) {
        setTasks(tasks.map(t => t.id === task.id ? { ...t, status: newStatus as Task['status'] } : t));
      }
    } catch (err) {
      console.error('Error updating status:', err);
      alert('Failed to update status');
    }
  };

  const handleDelete = async (task: Task) => {
    if (!confirm(`Delete task "${task.name}"?`)) return;
    try {
      const data = await api.delete(`/api/tasks/${task.id}`);
      if (!data.success) throw new Error(data.error || 'Failed to delete task');
      setTasks(tasks.filter(t => t.id !== task.id));
    } catch (err) {
      console.error('Error deleting task:', err);
      alert(err instanceof Error ? err.message : 'Failed to delete task');
    }
  };

  const getProjectName = (projectId: string) => {
    return projects.find(p => p.id === projectId)?.name || 'Unknown Project';
  };

  const getEmployeeName = (employeeId?: string) => {
    if (!employeeId) return 'Unassigned';
    return employees.find(e => e.id === employeeId)?.name || 'Unknown';
  };

  const getPriorityColor = (priority: string) => {
    switch (priority) {
      case 'high': return 'var(--tt-danger)';
      case 'medium': return 'var(--tt-amber)';
      case 'low': return 'var(--tt-success)';
      default: return 'var(--tt-text-muted)';
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'completed': return 'var(--tt-success)';
      case 'in_progress': return 'var(--tt-teal)';
      case 'todo': return 'var(--tt-text-faint)';
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
          <EmptyIcon icon={AlertTriangle} size={48} color="var(--tt-danger)" />
          <h2 style={errorStyles.title}>Error Loading Tasks</h2>
          <p style={errorStyles.message}>{error}</p>
          <button onClick={loadData} style={errorStyles.retryButton}>
            Retry
          </button>
        </div>
      </div>
    );
  }

  return (
    <div style={styles.container}>
      <header style={styles.header}>
        <h1 style={{ ...styles.title, display: 'flex', alignItems: 'center', gap: 8 }}>
          {t('tasks.title')}
          <HelpTip text={t('help.tasks')} />
        </h1>
        <button
          style={styles.addButton}
          onClick={() => {
            setEditingTask(null);
            setFormData({ name: '', description: '', projectId: '', assignedTo: '', priority: 'medium', estimatedHours: '', status: 'todo' });
            setShowForm(true);
          }}
        >
          {t('tasks.add')}
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
                {editingTask ? t('tasks.edit') : t('tasks.addTitle')}
              </h2>
              <ModalCloseButton onClick={() => setShowForm(false)} />
            </div>
            <form onSubmit={handleSubmit} style={{ display: 'contents' }}>
              <div className="tt-modal-body">
                {formError && (
                  <div style={styles.errorBanner}>
                    <StatusLine variant="error">{formError}</StatusLine>
                  </div>
                )}
                <div className="tt-modal-form tt-modal-form--2col">
                  <div className="tt-field tt-field-span-2">
                    <label className="tt-field-label">Task Name *</label>
                    <input
                      type="text"
                      className="tt-input"
                      placeholder="e.g. Design floor plans"
                      value={formData.name}
                      onChange={e => setFormData({...formData, name: e.target.value})}
                      required
                    />
                  </div>
                  <div className="tt-field tt-field-span-2">
                    <label className="tt-field-label">Description</label>
                    <textarea
                      className="tt-input"
                      placeholder="Task details..."
                      value={formData.description}
                      onChange={e => setFormData({...formData, description: e.target.value})}
                      style={{ minHeight: '60px', resize: 'vertical' }}
                    />
                  </div>
                  <div className="tt-field">
                    <label className="tt-field-label">Project *</label>
                    <select
                      className="tt-input"
                      value={formData.projectId}
                      onChange={e => setFormData({...formData, projectId: e.target.value})}
                      required
                    >
                      <option value="">Select a project</option>
                      {projects.map(p => (
                        <option key={p.id} value={p.id}>{p.name}</option>
                      ))}
                    </select>
                  </div>
                  <div className="tt-field">
                    <label className="tt-field-label">Assigned To</label>
                    <select
                      className="tt-input"
                      value={formData.assignedTo}
                      onChange={e => setFormData({...formData, assignedTo: e.target.value})}
                    >
                      <option value="">Unassigned</option>
                      {employees.map(e => (
                        <option key={e.id} value={e.id}>{e.name}</option>
                      ))}
                    </select>
                  </div>
                  <div className="tt-field">
                    <label className="tt-field-label">Priority</label>
                    <select
                      className="tt-input"
                      value={formData.priority}
                      onChange={e => setFormData({...formData, priority: e.target.value})}
                    >
                      <option value="low">Low Priority</option>
                      <option value="medium">Medium Priority</option>
                      <option value="high">High Priority</option>
                    </select>
                  </div>
                  <div className="tt-field">
                    <label className="tt-field-label">Estimated Hours</label>
                    <input
                      type="number"
                      className="tt-input"
                      placeholder="e.g. 8"
                      value={formData.estimatedHours}
                      onChange={e => setFormData({...formData, estimatedHours: e.target.value})}
                      min="0"
                      step="0.5"
                    />
                  </div>
                  {editingTask && (
                    <div className="tt-field tt-field-span-2">
                      <label className="tt-field-label">Status</label>
                      <select
                        className="tt-input"
                        value={formData.status}
                        onChange={e => setFormData({...formData, status: e.target.value})}
                      >
                        <option value="todo">To Do</option>
                        <option value="in_progress">In Progress</option>
                        <option value="completed">Completed</option>
                      </select>
                    </div>
                  )}
                </div>
              </div>
              <div className="tt-modal-footer">
                <button type="button" className="tt-btn tt-btn-ghost" onClick={() => setShowForm(false)}>Cancel</button>
                <button type="submit" className="tt-btn tt-btn-primary">
                  {editingTask ? 'Update' : 'Create'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {tasks.length === 0 && (
        <div style={{
          textAlign: 'center' as const,
          padding: '60px 20px',
          backgroundColor: 'var(--tt-surface)',
          borderRadius: 'var(--tt-radius)',
          boxShadow: 'var(--tt-shadow-sm)',
        }}>
          <EmptyIcon icon={CheckSquare} size={48} />
          <h2 style={{ fontSize: '20px', fontWeight: 600, color: 'var(--tt-text)', margin: '0 0 8px' }}>
            No tasks yet
          </h2>
          {projects.length === 0 ? (
            <>
              <p style={{ fontSize: '14px', color: 'var(--tt-text-muted)', margin: '0 0 24px' }}>
                Create a project first before adding tasks.
              </p>
              <button
                onClick={() => navigate('/projects')}
                style={{
                  padding: '12px 32px',
                  backgroundColor: 'var(--tt-teal)',
                  color: '#fff',
                  border: 'none',
                  borderRadius: 'var(--tt-radius-sm)',
                  cursor: 'pointer',
                  fontSize: '15px',
                  fontWeight: 600,
                }}
              >
                Go to Projects
              </button>
            </>
          ) : (
            <>
              <p style={{ fontSize: '14px', color: 'var(--tt-text-muted)', margin: '0 0 24px' }}>
                Break down projects into tasks and assign them to your team.
              </p>
              <button
                onClick={() => {
                  setEditingTask(null);
                  setFormData({ name: '', description: '', projectId: '', assignedTo: '', priority: 'medium', estimatedHours: '', status: 'todo' });
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
                + Create First Task
              </button>
            </>
          )}
        </div>
      )}

      <div style={styles.grid}>
        {tasks.map(task => (
          <div key={task.id} style={styles.card}>
            <div style={styles.cardHeader}>
              <h3 style={styles.taskName}>{task.name}</h3>
              <div style={styles.badges}>
                <span style={styles.priorityBadge(getPriorityColor(task.priority))}>
                  {task.priority}
                </span>
                <span style={styles.statusBadge(getStatusColor(task.status))}>
                  {task.status}
                </span>
              </div>
            </div>
            <div style={styles.cardBody}>
              {task.description && (
                <p style={styles.description}>{task.description}</p>
              )}
              <p style={styles.info}><IconLabel icon={FolderKanban}>{getProjectName(task.projectId)}</IconLabel></p>
              <p style={styles.info}><IconLabel icon={User}>{getEmployeeName(task.assignedTo)}</IconLabel></p>
              {task.estimatedHours && (
                <p style={styles.info}><IconLabel icon={Timer}>Est: {task.estimatedHours}h</IconLabel></p>
              )}
            </div>
            <div style={styles.cardActions}>
              <select
                value={task.status}
                onChange={e => handleStatusChange(task, e.target.value)}
                style={styles.statusDropdown}
              >
                <option value="todo">To Do</option>
                <option value="in_progress">In Progress</option>
                <option value="completed">Completed</option>
              </select>
              <button onClick={() => handleEdit(task)} style={styles.editButton}>
                Edit
              </button>
              <button onClick={() => handleDelete(task)} style={styles.deleteButton}>
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
    padding: '32px',
    '@media (max-width: 768px)': {
      padding: '16px'
    }
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
    marginBottom: '24px',
    '@media (max-width: 768px)': {
      flexDirection: 'column',
      gap: '12px',
      alignItems: 'flex-start'
    }
  },
  title: {
    fontSize: 'clamp(1.5rem, 2.2vw, 1.9rem)',
    fontWeight: 750,
    fontFamily: 'var(--tt-font-display)',
    letterSpacing: '-0.02em',
    color: 'var(--tt-text)',
    '@media (max-width: 768px)': {
      fontSize: '22px'
    }
  },
  addButton: {
    padding: '12px 24px',
    backgroundColor: 'var(--tt-success)',
    color: '#fff',
    border: 'none',
    borderRadius: 'var(--tt-radius-sm)',
    cursor: 'pointer',
    fontSize: '14px',
    fontWeight: 500,
    '@media (max-width: 768px)': {
      width: '100%',
      padding: '14px 24px'
    }
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
    maxWidth: '450px',
    '@media (max-width: 768px)': {
      margin: '16px',
      padding: '20px',
      maxHeight: '90vh',
      overflowY: 'auto'
    }
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
    '@media (max-width: 768px)': {
      fontSize: '16px', // Prevent zoom on iOS
      padding: '14px'
    }
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
    gap: '16px',
    '@media (max-width: 768px)': {
      gridTemplateColumns: '1fr',
      gap: '12px'
    }
  },
  card: {
    backgroundColor: 'var(--tt-surface)',
    padding: '20px',
    borderRadius: 'var(--tt-radius)',
    boxShadow: 'var(--tt-shadow-sm)',
    '@media (max-width: 768px)': {
      padding: '16px'
    }
  },
  cardHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: '12px'
  },
  taskName: {
    fontSize: '16px',
    fontWeight: 600,
    color: 'var(--tt-text)',
    margin: 0,
    flex: 1
  },
  badges: {
    display: 'flex',
    gap: '6px'
  },
  priorityBadge: (color: string) => ({
    padding: '2px 6px',
    borderRadius: '4px',
    fontSize: '10px',
    fontWeight: 600,
    textTransform: 'uppercase',
    backgroundColor: `${color}20`,
    color: color
  }),
  statusBadge: (color: string) => ({
    padding: '2px 6px',
    borderRadius: '4px',
    fontSize: '10px',
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
    gap: '8px',
    '@media (max-width: 768px)': {
      flexDirection: 'column'
    }
  },
  statusDropdown: {
    flex: 1,
    padding: '8px 12px',
    border: '1px solid #ddd',
    borderRadius: '6px',
    fontSize: '14px',
    backgroundColor: 'var(--tt-surface)',
    cursor: 'pointer',
    '@media (max-width: 768px)': {
      fontSize: '16px', // Prevent zoom on iOS
      padding: '12px'
    }
  },
  editButton: {
    flex: 1,
    padding: '8px',
    backgroundColor: 'var(--tt-teal)',
    color: '#fff',
    border: 'none',
    borderRadius: '6px',
    cursor: 'pointer',
    fontSize: '13px',
    '@media (max-width: 768px)': {
      padding: '12px',
      fontSize: '14px'
    }
  },
  deleteButton: {
    flex: 1,
    padding: '8px',
    backgroundColor: 'var(--tt-danger)',
    color: '#fff',
    border: 'none',
    borderRadius: '6px',
    cursor: 'pointer',
    fontSize: '13px',
    '@media (max-width: 768px)': {
      padding: '12px',
      fontSize: '14px'
    }
  }
};

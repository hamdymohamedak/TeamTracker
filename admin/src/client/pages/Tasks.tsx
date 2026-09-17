import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../lib/api';
import type { Task, Project, Employee } from '../../../shared-types';
import { useI18n } from '../contexts/I18nContext';
import { PageHero, PageEmpty } from '../components/PageHero';
import { EmptyIcon, ModalCloseButton, StatusLine } from '../components/Icon';
import { AlertTriangle, CheckSquare, FolderKanban, Pencil, Plus, Timer, Trash2, User } from 'lucide-react';

const badgeStyle = (color: string): React.CSSProperties => ({
  padding: '2px 8px',
  borderRadius: '999px',
  fontSize: '10px',
  fontWeight: 650,
  textTransform: 'uppercase',
  backgroundColor: `${color}20`,
  color,
});

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

  const openCreate = () => {
    setEditingTask(null);
    setFormData({ name: '', description: '', projectId: '', assignedTo: '', priority: 'medium', estimatedHours: '', status: 'todo' });
    setFormError(null);
    setShowForm(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);

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
    setFormError(null);
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
          <h2 className="tt-empty-title">{t('tasks.loadFailed')}</h2>
          <p className="tt-muted">{error}</p>
          <div className="tt-empty-action">
            <button type="button" className="tt-btn tt-btn-primary" onClick={loadData}>
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
        icon={CheckSquare}
        title={t('tasks.title')}
        subtitle={t('tasks.subtitle')}
        help={t('help.tasks')}
        action={
          <button type="button" className="tt-btn tt-btn-primary" onClick={openCreate}>
            <Plus size={16} strokeWidth={2.4} />
            {t('tasks.add')}
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
                {editingTask ? t('tasks.edit') : t('tasks.addTitle')}
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
                    <label className="tt-field-label">{t('tasks.name')} *</label>
                    <input
                      type="text"
                      className="tt-input"
                      placeholder="e.g. Design floor plans"
                      value={formData.name}
                      onChange={e => setFormData({ ...formData, name: e.target.value })}
                      required
                    />
                  </div>
                  <div className="tt-field tt-field-span-2">
                    <label className="tt-field-label">{t('projects.description')}</label>
                    <textarea
                      className="tt-input"
                      placeholder="Task details..."
                      value={formData.description}
                      onChange={e => setFormData({ ...formData, description: e.target.value })}
                      style={{ minHeight: '60px', resize: 'vertical' }}
                    />
                  </div>
                  <div className="tt-field">
                    <label className="tt-field-label">{t('tasks.project')} *</label>
                    <select
                      className="tt-input"
                      value={formData.projectId}
                      onChange={e => setFormData({ ...formData, projectId: e.target.value })}
                      required
                    >
                      <option value="">Select a project</option>
                      {projects.map(p => (
                        <option key={p.id} value={p.id}>{p.name}</option>
                      ))}
                    </select>
                  </div>
                  <div className="tt-field">
                    <label className="tt-field-label">{t('tasks.assignedTo')}</label>
                    <select
                      className="tt-input"
                      value={formData.assignedTo}
                      onChange={e => setFormData({ ...formData, assignedTo: e.target.value })}
                    >
                      <option value="">Unassigned</option>
                      {employees.map(e => (
                        <option key={e.id} value={e.id}>{e.name}</option>
                      ))}
                    </select>
                  </div>
                  <div className="tt-field">
                    <label className="tt-field-label">{t('tasks.priority')}</label>
                    <select
                      className="tt-input"
                      value={formData.priority}
                      onChange={e => setFormData({ ...formData, priority: e.target.value })}
                    >
                      <option value="low">Low Priority</option>
                      <option value="medium">Medium Priority</option>
                      <option value="high">High Priority</option>
                    </select>
                  </div>
                  <div className="tt-field">
                    <label className="tt-field-label">{t('tasks.estimatedHours')}</label>
                    <input
                      type="number"
                      className="tt-input"
                      placeholder="e.g. 8"
                      value={formData.estimatedHours}
                      onChange={e => setFormData({ ...formData, estimatedHours: e.target.value })}
                      min="0"
                      step="0.5"
                    />
                  </div>
                  {editingTask && (
                    <div className="tt-field tt-field-span-2">
                      <label className="tt-field-label">{t('tasks.status')}</label>
                      <select
                        className="tt-input"
                        value={formData.status}
                        onChange={e => setFormData({ ...formData, status: e.target.value })}
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
                <button type="button" className="tt-btn tt-btn-ghost" onClick={() => setShowForm(false)}>
                  {t('common.cancel')}
                </button>
                <button type="submit" className="tt-btn tt-btn-primary">
                  {editingTask ? t('tasks.update') : t('tasks.create')}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {tasks.length === 0 ? (
        <PageEmpty
          icon={CheckSquare}
          title={t('tasks.empty')}
          hint={projects.length === 0 ? t('tasks.noProjectsHint') : t('tasks.emptyHint')}
          action={
            projects.length === 0 ? (
              <button type="button" className="tt-btn tt-btn-primary" onClick={() => navigate('/projects')}>
                {t('tasks.goToProjects')}
              </button>
            ) : (
              <button type="button" className="tt-btn tt-btn-primary" onClick={openCreate}>
                <Plus size={16} strokeWidth={2.4} />
                {t('tasks.addFirst')}
              </button>
            )
          }
        />
      ) : (
        <div className="tt-card-grid">
          {tasks.map(task => (
            <article key={task.id} className="tt-entity-card">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
                <h3 style={{ margin: 0, fontSize: 16, fontWeight: 650, color: 'var(--tt-text)', lineHeight: 1.35, flex: 1 }}>
                  {task.name}
                </h3>
                <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                  <span style={badgeStyle(getPriorityColor(task.priority))}>
                    {task.priority}
                  </span>
                  <span style={badgeStyle(getStatusColor(task.status))}>
                    {task.status}
                  </span>
                </div>
              </div>

              {task.description ? (
                <p className="tt-muted" style={{ margin: 0 }}>{task.description}</p>
              ) : null}

              <div className="tt-meta-chips">
                <span className="tt-chip">
                  <FolderKanban size={12} strokeWidth={2.1} />
                  {getProjectName(task.projectId)}
                </span>
                <span className="tt-chip">
                  <User size={12} strokeWidth={2.1} />
                  {getEmployeeName(task.assignedTo)}
                </span>
                {task.estimatedHours ? (
                  <span className="tt-chip">
                    <Timer size={12} strokeWidth={2.1} />
                    {task.estimatedHours}h
                  </span>
                ) : null}
              </div>

              <div className="tt-entity-card-actions">
                <select
                  className="tt-input"
                  value={task.status}
                  onChange={e => handleStatusChange(task, e.target.value)}
                  style={{ flex: 1, minWidth: 120, fontSize: 12, padding: '7px 10px' }}
                  aria-label={t('tasks.status')}
                >
                  <option value="todo">To Do</option>
                  <option value="in_progress">In Progress</option>
                  <option value="completed">Completed</option>
                </select>
                <button
                  type="button"
                  className="tt-action-btn"
                  onClick={() => handleEdit(task)}
                  title={t('common.edit')}
                >
                  <Pencil size={14} strokeWidth={2.1} />
                  {t('common.edit')}
                </button>
                <button
                  type="button"
                  className="tt-action-btn tt-action-btn-danger"
                  onClick={() => handleDelete(task)}
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

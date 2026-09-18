import React from 'react';
import { Search } from 'lucide-react';
import { useI18n } from '@/contexts/I18nContext';

interface Props {
  query: string;
  setQuery: (q: string) => void;
  totalCount: number;
  filteredCount: number;
}

export const EmployeeToolbar: React.FC<Props> = ({ query, setQuery, totalCount, filteredCount }) => {
  const { t } = useI18n();

  return (
    <div className="tt-toolbar">
      <div className="tt-search">
        <Search size={16} strokeWidth={2.1} style={{ color: 'var(--tt-text-faint)', flexShrink: 0 }} />
        <input
          type="search"
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder={t('employees.searchPlaceholder')}
          aria-label={t('common.search')}
        />
      </div>
      <div className="tt-count-pill">
        {t('employees.count', { count: filteredCount, total: totalCount })}
      </div>
    </div>
  );
};

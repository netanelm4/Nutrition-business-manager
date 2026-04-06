import { useState, useMemo, useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { fetchClients } from '../lib/api';
import { CLIENT_STATUS, CLIENT_STATUS_LABEL } from '../constants/statuses';
import ClientCard from '../components/clients/ClientCard';
import ClientForm from '../components/clients/ClientForm';
import Modal from '../components/ui/Modal';
import EmptyState from '../components/ui/EmptyState';

function Skeleton({ className = '' }) {
  return <div className={`animate-pulse bg-gray-200 rounded-xl ${className}`} />;
}

export default function Clients() {
  const location = useLocation();
  const prefill = location.state?.prefill ?? null;

  const [addOpen, setAddOpen] = useState(false);
  const [statusFilter, setStatusFilter] = useState('');
  const [search, setSearch] = useState('');
  const [includeEnded, setIncludeEnded] = useState(false);

  useEffect(() => {
    if (prefill) setAddOpen(true);
  }, []); // run once on mount

  const { data: clients = [], isLoading, isError } = useQuery({
    queryKey: ['clients', includeEnded],
    queryFn: () => fetchClients(includeEnded),
  });

  const filtered = useMemo(() => {
    let result = clients;

    if (statusFilter) {
      result = result.filter((c) => c.status === statusFilter);
    }

    const q = search.trim().toLowerCase();
    if (q) {
      result = result.filter(
        (c) =>
          c.full_name.toLowerCase().includes(q) ||
          (c.phone && c.phone.replace(/\D/g, '').includes(q.replace(/\D/g, '')))
      );
    }

    return result;
  }, [clients, statusFilter, search]);

  return (
    <>
      <div className="p-4 md:p-6 space-y-5 max-w-3xl mx-auto">
        {/* Header */}
        <div className="flex items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">לקוחות פעילים</h1>
            {!isLoading && (
              <p className="text-sm text-gray-400 mt-0.5">{clients.length} לקוחות</p>
            )}
          </div>
          <button
            type="button"
            onClick={() => setAddOpen(true)}
            className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-indigo-600 text-white text-sm font-semibold hover:bg-indigo-700 transition-colors flex-shrink-0"
          >
            <span>+</span>
            <span>הוספת לקוח</span>
          </button>
        </div>

        {/* Filter bar */}
        <div className="flex flex-col sm:flex-row gap-3">
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-700 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-400 sm:w-44"
          >
            <option value="">כל הסטטוסים</option>
            {Object.entries(CLIENT_STATUS).map(([, val]) => (
              <option key={val} value={val}>{CLIENT_STATUS_LABEL[val]}</option>
            ))}
          </select>

          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="חיפוש לפי שם או טלפון..."
            className="flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
          />

          <label className="flex items-center gap-2 text-sm text-gray-600 cursor-pointer flex-shrink-0 self-center">
            <input
              type="checkbox"
              checked={includeEnded}
              onChange={(e) => setIncludeEnded(e.target.checked)}
              className="w-4 h-4 accent-indigo-600"
            />
            כולל שסיימו
          </label>
        </div>

        {/* Content */}
        {isLoading && (
          <div className="space-y-3">
            {[1, 2, 3].map((i) => <Skeleton key={i} className="h-36" />)}
          </div>
        )}

        {isError && (
          <p className="text-red-500 text-sm">שגיאה בטעינת רשימת הלקוחות.</p>
        )}

        {!isLoading && !isError && filtered.length === 0 && (
          <EmptyState
            message={search || statusFilter ? 'לא נמצאו לקוחות התואמים לסינון' : 'אין לקוחות עדיין'}
            sub={!search && !statusFilter ? 'לחץ על "הוספת לקוח" כדי להתחיל' : undefined}
          />
        )}

        {!isLoading && !isError && filtered.length > 0 && (
          <div className="space-y-3">
            {filtered.map((client) => (
              <ClientCard key={client.id} client={client} />
            ))}
          </div>
        )}
      </div>

      {addOpen && (
        <Modal title="הוספת לקוח חדש" onClose={() => setAddOpen(false)}>
          <ClientForm
            onSuccess={() => setAddOpen(false)}
            defaultValues={prefill ?? undefined}
            convertedFromLeadId={prefill?.convertedFromLeadId}
          />
        </Modal>
      )}
    </>
  );
}

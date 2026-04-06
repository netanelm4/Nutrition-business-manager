import { useState, useEffect, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { fetchClients, fetchLeads } from '../../lib/api';

const MAX_PER_SECTION = 5;

function matchScore(lead, q) {
  const lq = q.toLowerCase();
  return ['full_name', 'phone', 'notes'].some(
    (f) => lead[f] && String(lead[f]).toLowerCase().includes(lq)
  );
}

function matchClient(client, q) {
  const lq = q.toLowerCase();
  return ['full_name', 'phone', 'goal', 'medical_notes'].some(
    (f) => client[f] && String(client[f]).toLowerCase().includes(lq)
  );
}

function contextLine(item, q, fields) {
  const lq = q.toLowerCase();
  for (const f of fields) {
    if (f === 'full_name') continue;
    if (item[f] && String(item[f]).toLowerCase().includes(lq)) {
      const val = String(item[f]);
      return val.length > 60 ? val.slice(0, 60) + '…' : val;
    }
  }
  return item.phone || '';
}

export default function GlobalSearch({ onClose }) {
  const navigate = useNavigate();
  const inputRef = useRef(null);
  const containerRef = useRef(null);

  const [inputValue, setInputValue] = useState('');
  const [query, setQuery] = useState('');

  // Debounce: update `query` 200ms after user stops typing
  useEffect(() => {
    const timer = setTimeout(() => setQuery(inputValue.trim()), 200);
    return () => clearTimeout(timer);
  }, [inputValue]);

  // Fetch clients + leads once (staleTime: 60s keeps data cached)
  const { data: clients = [] } = useQuery({
    queryKey: ['clients'],
    queryFn: () => fetchClients(false),
    staleTime: 60_000,
  });

  const { data: leads = [] } = useQuery({
    queryKey: ['leads'],
    queryFn: fetchLeads,
    staleTime: 60_000,
  });

  // Keyboard: Cmd/Ctrl+K focuses; Escape closes
  useEffect(() => {
    function onKeyDown(e) {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        inputRef.current?.focus();
      }
      if (e.key === 'Escape') {
        if (onClose) onClose();
        else inputRef.current?.blur();
        setInputValue('');
      }
    }
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  // Click outside → close dropdown
  useEffect(() => {
    function onMouseDown(e) {
      if (containerRef.current && !containerRef.current.contains(e.target)) {
        setInputValue('');
      }
    }
    document.addEventListener('mousedown', onMouseDown);
    return () => document.removeEventListener('mousedown', onMouseDown);
  }, []);

  const isOpen = query.length >= 2;

  const matchedClients = isOpen
    ? clients.filter((c) => matchClient(c, query)).slice(0, MAX_PER_SECTION)
    : [];
  const matchedLeads = isOpen
    ? leads.filter((l) => matchScore(l, query)).slice(0, MAX_PER_SECTION)
    : [];

  const hasResults = matchedClients.length > 0 || matchedLeads.length > 0;

  function handleSelect(path) {
    navigate(path);
    setInputValue('');
    if (onClose) onClose();
  }

  return (
    <div ref={containerRef} className="relative w-full max-w-md">
      <div className="relative">
        <span className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm pointer-events-none">
          🔍
        </span>
        <input
          ref={inputRef}
          type="text"
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value)}
          placeholder="חיפוש לקוח או ליד… (⌘K)"
          className="w-full rounded-xl border border-gray-200 bg-gray-50 pr-9 pl-3 py-2 text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-indigo-400 focus:bg-white transition-colors"
          dir="rtl"
        />
      </div>

      {isOpen && (
        <div className="absolute top-full mt-1 right-0 left-0 z-50 bg-white rounded-xl shadow-lg border border-gray-200 max-h-80 overflow-y-auto">
          {!hasResults ? (
            <p className="text-sm text-gray-500 px-4 py-3">
              לא נמצאו תוצאות עבור &quot;{query}&quot;
            </p>
          ) : (
            <>
              {matchedClients.length > 0 && (
                <div>
                  <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide px-4 pt-3 pb-1">
                    לקוחות
                  </p>
                  {matchedClients.map((c) => (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => handleSelect(`/clients/${c.id}`)}
                      className="w-full text-right px-4 py-2.5 hover:bg-gray-50 transition-colors border-b border-gray-100 last:border-0"
                    >
                      <p className="text-sm font-medium text-gray-900">{c.full_name}</p>
                      <p className="text-xs text-gray-500 truncate">
                        {contextLine(c, query, ['full_name', 'phone', 'goal', 'medical_notes'])}
                      </p>
                    </button>
                  ))}
                </div>
              )}
              {matchedLeads.length > 0 && (
                <div>
                  <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide px-4 pt-3 pb-1">
                    לידים
                  </p>
                  {matchedLeads.map((l) => (
                    <button
                      key={l.id}
                      type="button"
                      onClick={() => handleSelect(`/leads/${l.id}`)}
                      className="w-full text-right px-4 py-2.5 hover:bg-gray-50 transition-colors border-b border-gray-100 last:border-0"
                    >
                      <p className="text-sm font-medium text-gray-900">{l.full_name}</p>
                      <p className="text-xs text-gray-500 truncate">
                        {contextLine(l, query, ['full_name', 'phone', 'notes'])}
                      </p>
                    </button>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { fetchPayments, createPayment, deletePayment } from '../../lib/api';
import { formatDateHebrew } from '../../lib/dates';
import WhatsAppDropdown from '../whatsapp/WhatsAppDropdown';

const inputClass =
  'w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-indigo-400 focus:border-transparent';

const STATUS_BADGE = {
  paid:    { label: 'שולם במלואו', cls: 'bg-green-100 text-green-700 border-green-200' },
  partial: { label: 'תשלום חלקי', cls: 'bg-yellow-100 text-yellow-700 border-yellow-200' },
  unpaid:  { label: 'טרם שולם',   cls: 'bg-red-100 text-red-600 border-red-200' },
};

function PaymentStatusBadge({ status }) {
  const cfg = STATUS_BADGE[status] ?? STATUS_BADGE.unpaid;
  return (
    <span className={`text-xs font-semibold px-2.5 py-1 rounded-full border ${cfg.cls}`}>
      {cfg.label}
    </span>
  );
}

function ProgressBar({ paid, total }) {
  if (!total || total <= 0) return null;
  const pct = Math.min(100, Math.round((paid / total) * 100));
  return (
    <div className="w-full bg-gray-200 rounded-full h-2 mt-2">
      <div
        className="bg-indigo-500 h-2 rounded-full transition-all"
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}

export default function PaymentsSection({ client }) {
  const queryClient = useQueryClient();
  const [addOpen, setAddOpen] = useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState(null);
  const [form, setForm] = useState({
    amount: '',
    paid_at: new Date().toISOString().slice(0, 10),
    note: '',
  });
  const [formError, setFormError] = useState('');

  const { data: payments = [], isLoading } = useQuery({
    queryKey: ['payments', String(client.id)],
    queryFn: () => fetchPayments(client.id),
  });

  const totalPaid = payments.reduce((sum, p) => sum + p.amount, 0);
  const packagePrice = client.package_price || 0;
  const paymentStatus = client.payment_status || 'unpaid';

  const addMutation = useMutation({
    mutationFn: (data) => createPayment(client.id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['payments', String(client.id)] });
      queryClient.invalidateQueries({ queryKey: ['client', String(client.id)] });
      queryClient.invalidateQueries({ queryKey: ['clients'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard'] });
      setForm({ amount: '', paid_at: new Date().toISOString().slice(0, 10), note: '' });
      setAddOpen(false);
      setFormError('');
    },
    onError: (err) => setFormError(err.message || 'שגיאה בשמירה.'),
  });

  const deleteMutation = useMutation({
    mutationFn: (id) => deletePayment(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['payments', String(client.id)] });
      queryClient.invalidateQueries({ queryKey: ['client', String(client.id)] });
      queryClient.invalidateQueries({ queryKey: ['clients'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard'] });
      setConfirmDeleteId(null);
    },
  });

  function handleSubmit(e) {
    e.preventDefault();
    if (!form.amount || Number(form.amount) <= 0) {
      setFormError('יש להזין סכום חיובי.');
      return;
    }
    addMutation.mutate({
      amount: Number(form.amount),
      paid_at: form.paid_at,
      note: form.note.trim() || null,
    });
  }

  return (
    <section className="bg-white rounded-xl border border-gray-200 p-5 space-y-4">
      {/* Header row */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <h2 className="text-base font-semibold text-gray-700">מעקב תשלומים</h2>
        <div className="flex items-center gap-2 flex-wrap">
          <PaymentStatusBadge status={paymentStatus} />
          {packagePrice > 0 && (
            <span className="text-sm text-gray-500">
              שולם {totalPaid.toLocaleString()} ₪ מתוך {packagePrice.toLocaleString()} ₪
            </span>
          )}
          {packagePrice === 0 && totalPaid > 0 && (
            <span className="text-sm text-gray-500">
              סה״כ שולם: {totalPaid.toLocaleString()} ₪
            </span>
          )}
        </div>
      </div>

      {/* Progress bar */}
      <ProgressBar paid={totalPaid} total={packagePrice} />

      {/* Payments list */}
      {isLoading ? (
        <div className="animate-pulse bg-gray-100 h-12 rounded-lg" />
      ) : payments.length === 0 ? (
        <p className="text-sm text-gray-400">אין תשלומים רשומים עדיין.</p>
      ) : (
        <ul className="divide-y divide-gray-100">
          {payments.map((p) => (
            <li key={p.id} className="py-2.5 flex items-center justify-between gap-3">
              <div className="min-w-0">
                <span className="text-sm font-semibold text-gray-900">
                  {p.amount.toLocaleString()} ₪
                </span>
                <span className="text-xs text-gray-400 mr-2">{formatDateHebrew(p.paid_at)}</span>
                {p.note && (
                  <p className="text-xs text-gray-500 truncate">{p.note}</p>
                )}
              </div>
              <div>
                {confirmDeleteId === p.id ? (
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => deleteMutation.mutate(p.id)}
                      disabled={deleteMutation.isPending}
                      className="text-xs text-red-600 hover:text-red-800 font-medium"
                    >
                      אשר מחיקה
                    </button>
                    <button
                      type="button"
                      onClick={() => setConfirmDeleteId(null)}
                      className="text-xs text-gray-400 hover:text-gray-600"
                    >
                      ביטול
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => setConfirmDeleteId(p.id)}
                    className="text-xs text-gray-400 hover:text-red-500 transition-colors"
                  >
                    מחק
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}

      {/* Add payment inline form */}
      {addOpen ? (
        <form onSubmit={handleSubmit} className="border border-gray-200 rounded-xl p-4 space-y-3 bg-gray-50">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="flex flex-col gap-1">
              <label className="text-xs font-medium text-gray-600">סכום (₪) *</label>
              <input
                type="number"
                step="1"
                min="1"
                value={form.amount}
                onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))}
                placeholder="500"
                className={inputClass}
                autoFocus
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs font-medium text-gray-600">תאריך תשלום *</label>
              <input
                type="date"
                value={form.paid_at}
                onChange={(e) => setForm((f) => ({ ...f, paid_at: e.target.value }))}
                className={inputClass}
                dir="ltr"
              />
            </div>
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-gray-600">הערה (אופציונלי)</label>
            <input
              type="text"
              value={form.note}
              onChange={(e) => setForm((f) => ({ ...f, note: e.target.value }))}
              placeholder="העברה בנקאית, מזומן..."
              className={inputClass}
            />
          </div>
          {formError && <p className="text-xs text-red-500">{formError}</p>}
          <div className="flex gap-2">
            <button
              type="submit"
              disabled={addMutation.isPending}
              className="flex-1 py-2 rounded-xl bg-indigo-600 text-white text-sm font-semibold hover:bg-indigo-700 transition-colors disabled:opacity-60"
            >
              {addMutation.isPending ? 'שומר...' : 'הוסף תשלום'}
            </button>
            <button
              type="button"
              onClick={() => { setAddOpen(false); setFormError(''); }}
              className="flex-1 py-2 rounded-xl border border-gray-200 text-sm text-gray-600 hover:bg-gray-50 transition-colors"
            >
              ביטול
            </button>
          </div>
        </form>
      ) : (
        <div className="flex items-center gap-3 flex-wrap">
          <button
            type="button"
            onClick={() => setAddOpen(true)}
            className="px-4 py-2 rounded-xl border-2 border-dashed border-indigo-200 text-indigo-600 text-sm font-medium hover:bg-indigo-50 transition-colors"
          >
            + הוסף תשלום
          </button>
          <div className="flex-shrink-0">
            <WhatsAppDropdown
              clientId={client.id}
              phone={client.phone}
              defaultTriggerEvent="payment_reminder"
            />
          </div>
        </div>
      )}
    </section>
  );
}

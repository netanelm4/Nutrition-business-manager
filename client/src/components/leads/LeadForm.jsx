import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { createLead, updateLead } from '../../lib/api';
import {
  LEAD_SOURCE,
  LEAD_STATUS,
  LEAD_SOURCE_LABEL,
  LEAD_STATUS_LABEL,
} from '../../constants/statuses';

const EMPTY_FORM = {
  full_name: '',
  phone: '',
  source: '',
  status: LEAD_STATUS.NEW,
  follow_up_date: '',
  notes: '',
};

function Field({ label, error, children }) {
  return (
    <div className="flex flex-col gap-1">
      <label className="text-sm font-medium text-gray-700">{label}</label>
      {children}
      {error && <p className="text-xs text-red-500">{error}</p>}
    </div>
  );
}

const inputClass =
  'w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-indigo-400 focus:border-transparent';

/**
 * Add / Edit lead form. Rendered inside Modal by the parent.
 *
 * @param {object}   [lead]      - Pre-fill data for edit mode (null/undefined = create)
 * @param {function} onSuccess   - Called after successful submit
 */
export default function LeadForm({ lead, onSuccess }) {
  const queryClient = useQueryClient();
  const isEdit = !!lead?.id;

  const [form, setForm] = useState(() => ({
    full_name: lead?.full_name ?? '',
    phone: lead?.phone ?? '',
    source: lead?.source ?? '',
    status: lead?.status ?? LEAD_STATUS.NEW,
    follow_up_date: lead?.follow_up_date ?? '',
    notes: lead?.notes ?? '',
  }));

  const [errors, setErrors] = useState({});
  const [serverError, setServerError] = useState('');

  function set(field, value) {
    setForm((f) => ({ ...f, [field]: value }));
    setErrors((e) => ({ ...e, [field]: '' }));
  }

  function validate() {
    const e = {};
    if (!form.full_name.trim()) e.full_name = 'שם מלא הוא שדה חובה';
    return e;
  }

  const mutation = useMutation({
    mutationFn: (data) =>
      isEdit ? updateLead(lead.id, data) : createLead(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['leads'] });
      onSuccess();
    },
    onError: (err) => {
      setServerError(err.message || 'אירעה שגיאה. נסה שוב.');
    },
  });

  function handleSubmit(e) {
    e.preventDefault();
    const errs = validate();
    if (Object.keys(errs).length > 0) {
      setErrors(errs);
      return;
    }
    setServerError('');
    mutation.mutate({
      full_name: form.full_name.trim(),
      phone: form.phone.trim() || null,
      source: form.source || null,
      status: form.status || LEAD_STATUS.NEW,
      follow_up_date: form.follow_up_date || null,
      notes: form.notes.trim() || null,
    });
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4" noValidate>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <Field label="שם מלא *" error={errors.full_name}>
          <input
            type="text"
            value={form.full_name}
            onChange={(e) => set('full_name', e.target.value)}
            placeholder="ישראל ישראלי"
            className={inputClass}
          />
        </Field>

        <Field label="טלפון">
          <input
            type="tel"
            value={form.phone}
            onChange={(e) => set('phone', e.target.value)}
            placeholder="050-000-0000"
            className={inputClass}
            dir="ltr"
          />
        </Field>

        <Field label="מקור">
          <select
            value={form.source}
            onChange={(e) => set('source', e.target.value)}
            className={inputClass}
          >
            <option value="">— בחר —</option>
            <option value={LEAD_SOURCE.LANDING_PAGE}>{LEAD_SOURCE_LABEL[LEAD_SOURCE.LANDING_PAGE]}</option>
            <option value={LEAD_SOURCE.REFERRAL}>{LEAD_SOURCE_LABEL[LEAD_SOURCE.REFERRAL]}</option>
            <option value={LEAD_SOURCE.OTHER}>{LEAD_SOURCE_LABEL[LEAD_SOURCE.OTHER]}</option>
          </select>
        </Field>

        <Field label="סטטוס">
          <select
            value={form.status}
            onChange={(e) => set('status', e.target.value)}
            className={inputClass}
          >
            <option value={LEAD_STATUS.NEW}>{LEAD_STATUS_LABEL[LEAD_STATUS.NEW]}</option>
            <option value={LEAD_STATUS.CONTACTED}>{LEAD_STATUS_LABEL[LEAD_STATUS.CONTACTED]}</option>
            <option value={LEAD_STATUS.MEETING_SCHEDULED}>{LEAD_STATUS_LABEL[LEAD_STATUS.MEETING_SCHEDULED]}</option>
            <option value={LEAD_STATUS.BECAME_CLIENT}>{LEAD_STATUS_LABEL[LEAD_STATUS.BECAME_CLIENT]}</option>
            <option value={LEAD_STATUS.NOT_RELEVANT}>{LEAD_STATUS_LABEL[LEAD_STATUS.NOT_RELEVANT]}</option>
          </select>
        </Field>

        <Field label="תאריך מעקב">
          <input
            type="date"
            value={form.follow_up_date}
            onChange={(e) => set('follow_up_date', e.target.value)}
            className={inputClass}
            dir="ltr"
          />
        </Field>
      </div>

      <Field label="הערות">
        <textarea
          value={form.notes}
          onChange={(e) => set('notes', e.target.value)}
          placeholder="הערות על הליד..."
          rows={3}
          className={inputClass}
        />
      </Field>

      {serverError && (
        <p className="text-sm text-red-500 bg-red-50 px-3 py-2 rounded-lg">{serverError}</p>
      )}

      <button
        type="submit"
        disabled={mutation.isPending}
        className="w-full py-2.5 rounded-xl bg-indigo-600 text-white font-semibold text-sm hover:bg-indigo-700 transition-colors disabled:opacity-60"
      >
        {mutation.isPending ? 'שומר...' : isEdit ? 'עריכת ליד' : 'הוספת ליד'}
      </button>
    </form>
  );
}

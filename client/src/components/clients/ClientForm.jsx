import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { createClient, updateClient } from '../../lib/api';

const EMPTY_FORM = {
  full_name: '',
  phone: '',
  age: '',
  gender: '',
  start_date: '',
  goal: '',
  medical_notes: '',
  initial_weight: '',
  package_price: '',
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
 * Add / Edit client form. Rendered inside Modal by the parent.
 *
 * @param {object}   [client]         - Pre-fill data for edit mode (null = create)
 * @param {function} onSuccess        - Called after successful submit
 * @param {number}   [convertedFromLeadId] - Pre-filled when converting a lead
 * @param {object}   [defaultValues]  - Pre-fill data from lead conversion (full_name, phone)
 */
export default function ClientForm({ client, onSuccess, convertedFromLeadId, defaultValues }) {
  const queryClient = useQueryClient();
  const isEdit = !!client?.id;

  const [form, setForm] = useState(() => ({
    full_name:      client?.full_name      ?? defaultValues?.full_name      ?? '',
    phone:          client?.phone          ?? defaultValues?.phone           ?? '',
    age:            client?.age            ?? defaultValues?.age             ?? '',
    gender:         client?.gender         ?? defaultValues?.gender          ?? '',
    start_date:     client?.start_date     ?? '',
    goal:           client?.goal           ?? defaultValues?.goal            ?? '',
    medical_notes:  client?.medical_notes  ?? defaultValues?.medical_notes   ?? '',
    initial_weight: client?.initial_weight ?? defaultValues?.initial_weight  ?? '',
    package_price:  client?.package_price  ?? '',
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
    if (!form.phone.trim())     e.phone = 'טלפון הוא שדה חובה';
    // start_date is optional when converting from lead — nutritionist fills it later
    if (!form.start_date && !convertedFromLeadId) e.start_date = 'תאריך פגישה ראשונה הוא שדה חובה';
    return e;
  }

  const mutation = useMutation({
    mutationFn: (data) =>
      isEdit ? updateClient(client.id, data) : createClient(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['clients'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard'] });
      if (isEdit) queryClient.invalidateQueries({ queryKey: ['client', String(client.id)] });
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
      phone: form.phone.trim(),
      age: form.age ? Number(form.age) : null,
      gender: form.gender || null,
      start_date: form.start_date || null,
      goal: form.goal.trim() || null,
      medical_notes: form.medical_notes.trim() || null,
      initial_weight: form.initial_weight ? Number(form.initial_weight) : null,
      package_price: form.package_price ? Number(form.package_price) : 0,
      ...(convertedFromLeadId && !isEdit ? { converted_from_lead_id: convertedFromLeadId } : {}),
    });
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4" noValidate>
      {!isEdit && convertedFromLeadId && (
        <div className="rounded-lg bg-blue-50 border border-blue-200 px-3 py-2.5 text-sm text-blue-700">
          ממיר ליד: <strong>{defaultValues?.full_name}</strong> — הפרטים הועברו אוטומטית מטופס ההיכרות
        </div>
      )}
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
        <Field label="טלפון *" error={errors.phone}>
          <input
            type="tel"
            value={form.phone}
            onChange={(e) => set('phone', e.target.value)}
            placeholder="050-000-0000"
            className={inputClass}
            dir="ltr"
          />
        </Field>
        <Field label="גיל">
          <input
            type="number"
            value={form.age}
            onChange={(e) => set('age', e.target.value)}
            placeholder="30"
            min={1}
            max={120}
            className={inputClass}
          />
        </Field>
        <Field label="מין">
          <select
            value={form.gender}
            onChange={(e) => set('gender', e.target.value)}
            className={inputClass}
          >
            <option value="">— בחר —</option>
            <option value="male">זכר</option>
            <option value="female">נקבה</option>
            <option value="other">אחר</option>
          </select>
        </Field>
        <Field label={convertedFromLeadId ? 'תאריך פגישה ראשונה' : 'תאריך פגישה ראשונה *'} error={errors.start_date}>
          <input
            type="date"
            value={form.start_date}
            onChange={(e) => set('start_date', e.target.value)}
            className={inputClass}
            dir="ltr"
          />
        </Field>
        <Field label="משקל התחלתי (ק״ג)">
          <input
            type="number"
            step="0.1"
            value={form.initial_weight}
            onChange={(e) => set('initial_weight', e.target.value)}
            placeholder="70.0"
            className={inputClass}
          />
        </Field>
        <Field label="מחיר חבילה (₪)">
          <input
            type="number"
            step="1"
            min="0"
            value={form.package_price}
            onChange={(e) => set('package_price', e.target.value)}
            placeholder="0"
            className={inputClass}
          />
        </Field>
      </div>

      <Field label="מטרת הלקוח">
        <textarea
          value={form.goal}
          onChange={(e) => set('goal', e.target.value)}
          placeholder="ירידה במשקל, שיפור הרגלי אכילה..."
          rows={2}
          className={inputClass}
        />
      </Field>

      <Field label="הערות רפואיות">
        <textarea
          value={form.medical_notes}
          onChange={(e) => set('medical_notes', e.target.value)}
          placeholder="אלרגיות, תרופות, מצבים רפואיים רלוונטיים..."
          rows={2}
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
        {mutation.isPending ? 'שומר...' : isEdit ? 'שמור שינויים' : 'הוספת לקוח'}
      </button>
    </form>
  );
}

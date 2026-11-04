import { useState } from 'react';
import { scheduleMeeting, updateMeeting } from '../../lib/api';
import { israelDateOf, israelTimeOf, todayIsraelISO } from '../../lib/dates';

const EVENT_TYPES = [
  { value: 'first_meeting', label: 'פגישה ראשונה' },
  { value: 'follow_up',     label: 'מעקב' },
  { value: 'consultation',  label: 'ייעוץ' },
];

// existingEvent: { id, start_time, event_type, notes } — when editing an existing event
export default function MeetingScheduleModal({ lead, onSave, onSkip, onClose, existingEvent }) {
  const today = todayIsraelISO();

  // Pre-fill from existingEvent when editing (start_time is UTC — show Israel date/time)
  const initialDate = existingEvent?.start_time ? israelDateOf(existingEvent.start_time) : today;
  const initialTime = existingEvent?.start_time ? israelTimeOf(existingEvent.start_time) : '10:00';

  const [date, setDate]           = useState(initialDate);
  const [time, setTime]           = useState(initialTime);
  const [eventType, setEventType] = useState(existingEvent?.event_type || 'first_meeting');
  const [notes, setNotes]         = useState(existingEvent?.notes || '');
  const [saving, setSaving]       = useState(false);
  const [error, setError]         = useState('');

  const isEdit = !!existingEvent?.id;

  async function handleSave() {
    if (!date || !time) {
      setError('יש לבחור תאריך ושעה.');
      return;
    }
    setSaving(true);
    setError('');
    try {
      if (isEdit) {
        await updateMeeting(existingEvent.id, { date, time, event_type: eventType, notes });
      } else {
        await scheduleMeeting(lead.id, { date, time, event_type: eventType, notes });
      }
      onSave();
    } catch (err) {
      setError(err.message || 'שגיאה בשמירת הפגישה.');
      setSaving(false);
    }
  }

  return (
    <div
      dir="rtl"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="bg-surface rounded-2xl shadow-xl w-full max-w-sm p-6 space-y-5">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-gray-800">
            {isEdit ? 'עדכון פגישה' : 'פרטי הפגישה'}
          </h2>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 text-xl leading-none"
            aria-label="סגור"
          >
            ×
          </button>
        </div>

        <p className="text-sm text-gray-500">
          {isEdit ? 'עדכון פרטי הפגישה עם' : 'נקבעה פגישה עם'}{' '}
          <span className="font-medium text-gray-700">{lead.full_name}</span>.
          {!isEdit && ' מלא את הפרטים כדי שתופיע בלוח הפגישות.'}
        </p>

        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">תאריך</label>
            <input
              type="date"
              dir="ltr"
              style={{ textAlign: 'end' }}
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">שעה</label>
            <input
              type="time"
              dir="ltr"
              style={{ textAlign: 'end' }}
              value={time}
              onChange={(e) => setTime(e.target.value)}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">סוג פגישה</label>
            <select
              value={eventType}
              onChange={(e) => setEventType(e.target.value)}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
            >
              {EVENT_TYPES.map((et) => (
                <option key={et.value} value={et.value}>{et.label}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">הערות (אופציונלי)</label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
              placeholder="הערות לפגישה..."
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-blue-400"
            />
          </div>
        </div>

        {error && <p className="text-sm text-red-600">{error}</p>}

        <div className="flex gap-3 pt-1">
          <button
            onClick={handleSave}
            disabled={saving}
            className="flex-1 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm font-medium rounded-lg py-2 transition-colors"
          >
            {saving ? 'שומר...' : isEdit ? 'עדכן פגישה' : 'שמור פגישה'}
          </button>
          {!isEdit && (
            <button
              onClick={onSkip}
              className="flex-1 border border-gray-300 hover:bg-gray-50 text-gray-700 text-sm font-medium rounded-lg py-2 transition-colors"
            >
              דלג
            </button>
          )}
          {isEdit && (
            <button
              onClick={onClose}
              className="flex-1 border border-gray-300 hover:bg-gray-50 text-gray-700 text-sm font-medium rounded-lg py-2 transition-colors"
            >
              ביטול
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

import { useState } from 'react';
import { scheduleMeeting } from '../../lib/api';

const EVENT_TYPES = [
  { value: 'first_meeting', label: 'פגישה ראשונה' },
  { value: 'follow_up',     label: 'מעקב' },
  { value: 'consultation',  label: 'ייעוץ' },
];

export default function MeetingScheduleModal({ lead, onSave, onSkip, onClose }) {
  const today = new Date().toISOString().slice(0, 10);
  const [date, setDate]           = useState(today);
  const [time, setTime]           = useState('10:00');
  const [eventType, setEventType] = useState('first_meeting');
  const [notes, setNotes]         = useState('');
  const [saving, setSaving]       = useState(false);
  const [error, setError]         = useState('');

  async function handleSave() {
    if (!date || !time) {
      setError('יש לבחור תאריך ושעה.');
      return;
    }
    setSaving(true);
    setError('');
    try {
      await scheduleMeeting(lead.id, { date, time, event_type: eventType, notes });
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
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm p-6 space-y-5">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-gray-800">פרטי הפגישה</h2>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 text-xl leading-none"
            aria-label="סגור"
          >
            ×
          </button>
        </div>

        <p className="text-sm text-gray-500">
          נקבעה פגישה עם <span className="font-medium text-gray-700">{lead.full_name}</span>.
          מלא את הפרטים כדי שתופיע בלוח הפגישות.
        </p>

        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">תאריך</label>
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">שעה</label>
            <input
              type="time"
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
            {saving ? 'שומר...' : 'שמור פגישה'}
          </button>
          <button
            onClick={onSkip}
            className="flex-1 border border-gray-300 hover:bg-gray-50 text-gray-700 text-sm font-medium rounded-lg py-2 transition-colors"
          >
            דלג
          </button>
        </div>
      </div>
    </div>
  );
}

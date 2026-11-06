// Session recordings: limits, formats and UI labels

export const RECORDING_MAX_BYTES = 50 * 1024 * 1024;

export const RECORDING_ACCEPT = 'audio/webm,audio/wav,audio/x-wav,audio/mpeg,audio/mp4,audio/x-m4a,audio/ogg,.webm,.wav,.mp3,.m4a,.ogg';

// MediaRecorder formats in order of preference (Safari records audio/mp4)
export const RECORDING_MIME_CANDIDATES = Object.freeze([
  'audio/webm;codecs=opus',
  'audio/webm',
  'audio/mp4',
  'audio/ogg;codecs=opus',
]);

export const RECORDING_LABELS = Object.freeze({
  title: 'הקלטת הפגישה',
  count: (n) => (n === 1 ? 'הקלטה אחת' : `${n} הקלטות`),
  start: 'התחל הקלטת פגישה',
  connecting: 'מתחבר למיקרופון...',
  pause: 'השהה',
  resume: 'המשך',
  stop: 'סיים ושמור',
  saving: 'שומר את ההקלטה...',
  uploadExisting: 'או העלה קובץ שמע קיים (MP3/WAV/M4A)',
  consent: 'יש לקבל את הסכמת המטופל לפני הקלטת הפגישה.',
  unsupported: 'הדפדפן הזה לא תומך בהקלטה. אפשר להעלות קובץ שמע קיים.',
  micDenied: 'אין הרשאה למיקרופון. יש לאשר גישה בהגדרות הדפדפן.',
  micUnavailable: 'לא נמצא מיקרופון זמין.',
  tooLarge: 'הקובץ גדול מדי (עד 50MB).',
  uploadFailed: 'שמירת ההקלטה נכשלה.',
  loadFailed: 'טעינת ההקלטה נכשלה.',
  deleteFailed: 'מחיקת ההקלטה נכשלה.',
  play: '▶ השמעה',
  loading: 'טוען...',
  loadingList: 'טוען הקלטות...',
  delete: 'מחיקה',
  deleteConfirm: 'למחוק את ההקלטה?',
  deleteYes: 'כן, למחוק',
  deleting: 'מוחק...',
  cancel: 'ביטול',
});

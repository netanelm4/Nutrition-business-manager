// Session recordings: limits, formats and UI labels

export const RECORDING_MAX_BYTES = 500 * 1024 * 1024;

// Chunked upload part size (the server accepts up to 12MB per part)
export const RECORDING_CHUNK_BYTES = 8 * 1024 * 1024;

// Speech-quality mono recording: 32kbps ≈ 29MB for two hours
export const RECORDING_BITRATE = 32000;

// MediaRecorder timeslice: each slice is also written to the IndexedDB backup
export const RECORDING_TIMESLICE_MS = 1000;

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
  uploading: 'מכין ומעלה הקלטה...',
  uploadRetry: 'ניסיון חוזר',
  downloadBackup: 'הורד גיבוי שמע',
  backupNote: 'ההקלטה שמורה בדפדפן הזה ולא תאבד. אפשר לנסות שוב או להוריד גיבוי.',
  recoveredTitle: 'נמצאה הקלטה שלא הועלתה',
  recoveredUpload: 'העלאה עכשיו',
  recoveredDiscard: 'מחיקת הגיבוי',
  recoveredDiscardConfirm: 'למחוק את הגיבוי לצמיתות?',
  uploadExisting: 'או העלה קובץ שמע קיים (MP3/WAV/M4A)',
  consent: 'יש לקבל את הסכמת המטופל לפני הקלטת הפגישה.',
  unsupported: 'הדפדפן הזה לא תומך בהקלטה. אפשר להעלות קובץ שמע קיים.',
  micDenied: 'אין הרשאה למיקרופון. יש לאשר גישה בהגדרות הדפדפן.',
  micUnavailable: 'לא נמצא מיקרופון זמין.',
  tooLarge: 'הקובץ גדול מדי (עד 500MB).',
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
  // Transcription
  transcriptTitle: 'תמלול',
  transcriptShow: 'הצגת התמלול',
  transcriptHide: 'הסתרת התמלול',
  transcriptQueued: 'ממתין לתמלול...',
  transcriptProcessing: 'מתמלל את ההקלטה...',
  transcriptPreparing: 'מכין את ההקלטה לתמלול...',
  transcriptPart: (part, parts) => `מתמלל חלק ${part} מתוך ${parts}...`,
  transcriptFailed: 'התמלול נכשל',
  transcriptRetry: 'ניסיון חוזר',
  transcriptNotConfigured: 'תמלול אוטומטי לא מוגדר.',
  transcriptNotStarted: 'התמלול טרם התחיל.',
  transcriptStart: 'תמלול',
  transcriptCopy: 'העתקה',
  transcriptCopied: 'הועתק',
  transcriptSave: 'שמירת שינויים',
  transcriptSaving: 'שומר...',
  transcriptSaved: 'נשמר',
  transcriptEdited: 'נערך ידנית',
  transcriptRedo: 'תמלול מחדש',
  transcriptRedoYes: 'כן, לדרוס',
  transcriptRedoConfirm: 'התמלול נערך ידנית. תמלול מחדש ידרוס את השינויים. להמשיך?',
  transcriptEmpty: 'לא זוהה דיבור בהקלטה.',
});

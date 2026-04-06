import { useState, useRef, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { fetchTemplates, renderTemplate, logWhatsApp } from '../../lib/api';

const GROUP_ORDER = [
  { event: 'welcome',           label: 'ברוכים הבאים' },
  { event: 'session_reminder',  label: 'תזכורות פגישה' },
  { event: 'weekly_checkin',    label: 'מעקב שבועי' },
  { event: 'menu_sent',         label: 'תפריט נשלח' },
  { event: 'process_ending',    label: 'סיום תהליך' },
  { event: 'payment_reminder',  label: 'תזכורת תשלום' },
  { event: 'custom',            label: 'אחר' },
];

/**
 * A button that opens a dropdown listing all active WhatsApp templates,
 * grouped by trigger_event. Clicking a template shows an inline preview
 * panel; from there the user can open WhatsApp manually.
 *
 * @param {number} clientId
 * @param {string} phone
 * @param {string} [defaultTriggerEvent] - If set, auto-clicks the first matching template on open
 */
export default function WhatsAppDropdown({ clientId, phone, defaultTriggerEvent }) {
  const [open, setOpen]                   = useState(false);
  const [preview, setPreview]             = useState(null); // { template, result } | null
  const [previewLoading, setPreviewLoading] = useState(false);
  const [toast, setToast]                 = useState('');
  const ref = useRef(null);

  const { data: templates = [] } = useQuery({
    queryKey: ['templates'],
    queryFn: fetchTemplates,
  });

  // Active templates only
  const activeTemplates = templates.filter((t) => t.is_active === 1);

  // Build grouped list — only groups that have at least one template
  const groups = GROUP_ORDER
    .map(({ event, label }) => ({
      event,
      label,
      items: activeTemplates.filter((t) => t.trigger_event === event),
    }))
    .filter((g) => g.items.length > 0);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    function handleMouseDown(e) {
      if (ref.current && !ref.current.contains(e.target)) {
        setOpen(false);
        setPreview(null);
      }
    }
    document.addEventListener('mousedown', handleMouseDown);
    return () => document.removeEventListener('mousedown', handleMouseDown);
  }, [open]);

  function showToast(msg) {
    setToast(msg);
    setTimeout(() => setToast(''), 2000);
  }

  async function handleTemplateClick(template) {
    if (previewLoading) return;
    setPreview(null);
    setPreviewLoading(true);
    try {
      const result = await renderTemplate(template.id, clientId);
      setPreview({ template, result });
    } catch {
      // swallow — user stays on the list
    } finally {
      setPreviewLoading(false);
    }
  }

  function handleOpenWhatsApp() {
    const { template, result } = preview;
    window.open(result.whatsapp_link, '_blank', 'noopener');
    // fire-and-forget — intentionally not awaited
    logWhatsApp({
      client_id: clientId,
      template_id: template.id,
      rendered_message: result.rendered_text,
    });
    showToast('נפתח בוואטסאפ ✓');
    setTimeout(() => {
      setOpen(false);
      setPreview(null);
    }, 500);
  }

  if (!phone) return null;

  return (
    <>
      <div className="relative" ref={ref}>
        {/* Trigger button */}
        <button
          type="button"
          onClick={() => {
            const nowOpen = !open;
            setOpen(nowOpen);
            setPreview(null);
            if (nowOpen && defaultTriggerEvent) {
              const defaultTemplate = activeTemplates.find(
                (t) => t.trigger_event === defaultTriggerEvent
              );
              if (defaultTemplate) {
                handleTemplateClick(defaultTemplate);
              }
            }
          }}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-green-200 bg-green-50 text-green-700 text-sm font-medium hover:bg-green-100 transition-colors"
        >
          <span>💬</span>
          <span>וואטסאפ</span>
          <span className="text-xs opacity-60">{open ? '▲' : '▼'}</span>
        </button>

        {open && (
          <div className="absolute left-0 top-full mt-1 z-20 bg-white border border-gray-200 rounded-xl shadow-lg w-72 overflow-hidden" dir="rtl">

            {/* ── SPINNER while rendering ── */}
            {previewLoading && (
              <div className="flex items-center justify-center py-8">
                <svg
                  className="animate-spin h-6 w-6 text-green-500"
                  xmlns="http://www.w3.org/2000/svg"
                  fill="none"
                  viewBox="0 0 24 24"
                >
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                </svg>
              </div>
            )}

            {/* ── PREVIEW PANEL ── */}
            {!previewLoading && preview && (
              <div className="flex flex-col gap-0">
                {/* Header row */}
                <div className="flex items-center justify-between px-3 py-2 border-b border-gray-100">
                  <button
                    type="button"
                    onClick={() => setPreview(null)}
                    className="text-xs text-gray-500 hover:text-gray-700 transition-colors"
                  >
                    ← חזרה לרשימה
                  </button>
                  <span className="text-sm font-medium text-gray-700">{preview.template.name}</span>
                </div>

                {/* Rendered message */}
                <div className="px-3 py-2">
                  <div className="bg-gray-50 rounded-lg p-3 text-sm text-gray-700 whitespace-pre-wrap leading-relaxed max-h-48 overflow-y-auto">
                    {preview.result.rendered_text}
                  </div>
                </div>

                {/* Phone */}
                <div className="px-3 pb-2 text-xs text-gray-500">
                  <span>טלפון: </span>
                  <span dir="ltr" className="font-mono">{phone}</span>
                </div>

                <div className="border-t border-gray-100" />

                {/* Open WhatsApp button */}
                <div className="px-3 py-2">
                  <button
                    type="button"
                    onClick={handleOpenWhatsApp}
                    className="w-full py-2 rounded-lg bg-green-500 hover:bg-green-600 text-white text-sm font-medium transition-colors"
                  >
                    פתח בוואטסאפ →
                  </button>
                </div>

                <div className="border-t border-gray-100" />

                {/* Manual send note — always visible */}
                <p className="px-3 py-2 text-xs text-gray-400 text-center">
                  שליחה ידנית — לחץ שלח בוואטסאפ לאחר הפתיחה
                </p>
              </div>
            )}

            {/* ── GROUPED TEMPLATE LIST ── */}
            {!previewLoading && !preview && (
              <>
                <p className="px-3 py-1.5 text-xs font-medium text-gray-400 border-b border-gray-100">
                  בחר תבנית לשליחה ידנית
                </p>

                {activeTemplates.length === 0 && (
                  <p className="px-3 py-2 text-sm text-gray-400">אין תבניות פעילות</p>
                )}

                {groups.map((group) => (
                  <div key={group.event}>
                    {/* Group header */}
                    <p className="px-3 py-1 text-xs text-gray-400 bg-gray-50 border-b border-gray-100">
                      {group.label}
                    </p>
                    {group.items.map((t) => (
                      <button
                        key={t.id}
                        type="button"
                        onClick={() => handleTemplateClick(t)}
                        className="w-full text-right px-3 py-2 text-sm text-gray-700 hover:bg-gray-50 transition-colors"
                      >
                        {t.name}
                      </button>
                    ))}
                  </div>
                ))}
              </>
            )}

          </div>
        )}
      </div>

      {/* Toast — rendered outside the dropdown div */}
      {toast && (
        <div className="fixed bottom-20 right-4 z-50 bg-green-600 text-white text-sm px-4 py-2 rounded-lg shadow-lg">
          {toast}
        </div>
      )}
    </>
  );
}

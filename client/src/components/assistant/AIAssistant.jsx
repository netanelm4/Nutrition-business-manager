import { useState, useRef, useEffect } from 'react';
import { chatWithAssistant } from '../../lib/api';

// ─── Markdown renderer (no dangerouslySetInnerHTML) ───────────────────────────

function parseBold(text) {
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return parts.map((part, i) => {
    if (part.startsWith('**') && part.endsWith('**')) {
      return <strong key={i}>{part.slice(2, -2)}</strong>;
    }
    return part || null;
  });
}

function MarkdownText({ text }) {
  const blocks = text.split(/\n\n+/);

  return (
    <div className="space-y-1.5 text-sm leading-relaxed">
      {blocks.map((block, bi) => {
        const lines = block.split('\n').filter(Boolean);
        if (lines.length === 0) return null;

        const isUnordered = lines.every((l) => /^\s*[-•*]\s/.test(l));
        const isOrdered   = lines.every((l) => /^\s*\d+\.\s/.test(l));

        if (isUnordered) {
          return (
            <ul key={bi} className="list-disc pr-4 space-y-0.5">
              {lines.map((l, li) => (
                <li key={li}>{parseBold(l.replace(/^\s*[-•*]\s*/, ''))}</li>
              ))}
            </ul>
          );
        }

        if (isOrdered) {
          return (
            <ol key={bi} className="list-decimal pr-4 space-y-0.5">
              {lines.map((l, li) => (
                <li key={li}>{parseBold(l.replace(/^\s*\d+\.\s*/, ''))}</li>
              ))}
            </ol>
          );
        }

        return (
          <p key={bi}>
            {lines.map((line, li) => (
              <span key={li}>
                {parseBold(line)}
                {li < lines.length - 1 && <br />}
              </span>
            ))}
          </p>
        );
      })}
    </div>
  );
}

// ─── Loading dots ─────────────────────────────────────────────────────────────

function LoadingDots() {
  return (
    <div className="flex gap-1.5 items-center py-0.5 px-1">
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          className="w-2 h-2 rounded-full bg-gray-400 animate-bounce"
          style={{ animationDelay: `${i * 0.15}s` }}
        />
      ))}
    </div>
  );
}

// ─── Quick action chips ───────────────────────────────────────────────────────

const QUICK_CHIPS = [
  'מה יש לי היום?',
  'מי הלקוחות שלא קבעו פגישה?',
  'תכין אותי לפגישה הבאה',
];

// ─── Main component ───────────────────────────────────────────────────────────

export default function AIAssistant({ isOpen, onClose }) {
  const [history,   setHistory]   = useState([]);
  const [inputText, setInputText] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  const chatEndRef  = useRef(null);
  const textareaRef = useRef(null);

  // Scroll to bottom on new messages
  useEffect(() => {
    if (isOpen) {
      chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [history, isLoading, isOpen]);

  // Focus textarea when panel opens
  useEffect(() => {
    if (isOpen) {
      setTimeout(() => textareaRef.current?.focus(), 300);
    }
  }, [isOpen]);

  async function sendMessage(text) {
    const msg = text.trim();
    if (!msg || isLoading) return;

    const userMsg    = { role: 'user', content: msg };
    const newHistory = [...history, userMsg];

    setHistory(newHistory);
    setInputText('');
    setIsLoading(true);

    // Reset textarea height
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
    }

    try {
      const { reply } = await chatWithAssistant(msg, history);
      setHistory([...newHistory, { role: 'assistant', content: reply }]);
    } catch (err) {
      setHistory([...newHistory, {
        role: 'assistant',
        content: 'מצטער, אירעה שגיאה. אנא נסה שוב.',
      }]);
    } finally {
      setIsLoading(false);
    }
  }

  function handleKeyDown(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage(inputText);
    }
  }

  function handleTextareaChange(e) {
    setInputText(e.target.value);
    const ta = textareaRef.current;
    if (ta) {
      ta.style.height = 'auto';
      ta.style.height = Math.min(ta.scrollHeight, 96) + 'px';
    }
  }

  const todayLabel = new Date().toLocaleDateString('he-IL', {
    day: 'numeric', month: 'long', year: 'numeric',
  });

  return (
    <>
      {/* Mobile overlay — behind panel, closes on tap */}
      <div
        className="fixed inset-0 bg-black/30 z-[999] md:hidden transition-opacity duration-250"
        style={{
          opacity:        isOpen ? 1 : 0,
          pointerEvents:  isOpen ? 'auto' : 'none',
        }}
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Panel */}
      <div
        dir="rtl"
        className="fixed top-0 bottom-0 right-0 z-[1000] flex flex-col bg-white"
        style={{
          width:      'min(380px, 100vw)',
          borderLeft: '0.5px solid #E5E7EB',
          boxShadow:  isOpen ? '-4px 0 32px rgba(0,0,0,0.12)' : 'none',
          transform:  isOpen ? 'translateX(0)' : 'translateX(100%)',
          transition: 'transform 0.25s ease',
        }}
        aria-label="עוזר AI"
        role="complementary"
      >
        {/* ── Header ─────────────────────────────────────────────────────── */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200 flex-shrink-0">
          <div>
            <h2 className="text-sm font-semibold text-gray-900">עוזר AI</h2>
            <p className="text-xs text-gray-400 mt-0.5">מחובר למערכת | {todayLabel}</p>
          </div>
          <div className="flex items-center gap-1">
            {history.length > 0 && (
              <button
                type="button"
                onClick={() => setHistory([])}
                className="text-xs text-gray-400 hover:text-gray-600 px-2 py-1 rounded-lg hover:bg-gray-100 transition-colors"
              >
                נקה שיחה
              </button>
            )}
            <button
              type="button"
              onClick={onClose}
              className="w-8 h-8 flex items-center justify-center rounded-full text-gray-400 hover:bg-gray-100 hover:text-gray-700 transition-colors text-xl leading-none"
              aria-label="סגור"
            >
              ×
            </button>
          </div>
        </div>

        {/* ── Chat area ──────────────────────────────────────────────────── */}
        <div className="flex-1 overflow-y-auto px-4 py-4">
          {history.length === 0 && !isLoading ? (
            /* Welcome state */
            <div className="flex flex-col items-center justify-center h-full gap-5 text-center px-2">
              <div className="text-5xl">✨</div>
              <div>
                <p className="font-semibold text-gray-800 text-base">שלום נתנאל</p>
                <p className="text-sm text-gray-500 mt-2 leading-relaxed">
                  אני מחובר למערכת שלך ומכיר את כל הלקוחות,<br />
                  הלידים והמשימות שלך.
                </p>
                <p className="text-sm text-gray-500 mt-1">איך אוכל לעזור?</p>
              </div>
              {/* Quick chips */}
              <div className="flex flex-col gap-2 w-full mt-1">
                {QUICK_CHIPS.map((chip) => (
                  <button
                    key={chip}
                    type="button"
                    onClick={() => sendMessage(chip)}
                    className="text-sm text-right px-4 py-2.5 rounded-xl border border-gray-200 hover:border-indigo-300 hover:bg-indigo-50 transition-colors text-gray-700 hover:text-indigo-700"
                  >
                    {chip}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            /* Conversation */
            <div className="space-y-3">
              {history.map((msg, i) => (
                <div
                  key={i}
                  className={`flex ${msg.role === 'user' ? 'justify-start' : 'justify-end'}`}
                >
                  <div
                    className={`px-3.5 py-2.5 ${
                      msg.role === 'user'
                        ? 'text-white'
                        : 'bg-gray-100 text-gray-800'
                    }`}
                    style={{
                      maxWidth:     msg.role === 'user' ? '80%' : '90%',
                      borderRadius: msg.role === 'user'
                        ? '16px 16px 4px 16px'
                        : '16px 16px 16px 4px',
                      background: msg.role === 'user' ? '#567DBF' : undefined,
                    }}
                  >
                    {msg.role === 'assistant' ? (
                      <MarkdownText text={msg.content} />
                    ) : (
                      <p className="text-sm leading-relaxed whitespace-pre-wrap">
                        {msg.content}
                      </p>
                    )}
                  </div>
                </div>
              ))}

              {/* Loading indicator */}
              {isLoading && (
                <div className="flex justify-end">
                  <div
                    className="bg-gray-100"
                    style={{ borderRadius: '16px 16px 16px 4px', padding: '10px 14px' }}
                  >
                    <LoadingDots />
                  </div>
                </div>
              )}

              <div ref={chatEndRef} />
            </div>
          )}
        </div>

        {/* ── Input area ─────────────────────────────────────────────────── */}
        <div className="flex-shrink-0 border-t border-gray-200 px-3 py-3">
          <div className="flex items-end gap-2">
            <textarea
              ref={textareaRef}
              value={inputText}
              onChange={handleTextareaChange}
              onKeyDown={handleKeyDown}
              placeholder="שאל אותי משהו..."
              disabled={isLoading}
              rows={1}
              dir="rtl"
              className="flex-1 resize-none rounded-xl border border-gray-200 px-3 py-2.5 text-sm bg-gray-50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-indigo-300 disabled:opacity-50 overflow-hidden"
              style={{ maxHeight: 96 }}
            />
            <button
              type="button"
              onClick={() => sendMessage(inputText)}
              disabled={!inputText.trim() || isLoading}
              className="flex-shrink-0 w-9 h-9 rounded-xl bg-indigo-600 text-white flex items-center justify-center hover:bg-indigo-700 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              aria-label="שלח"
            >
              {/* Send arrow icon */}
              <svg viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
                <path d="M10.894 2.553a1 1 0 00-1.788 0l-7 14a1 1 0 001.169 1.409l5-1.429A1 1 0 009 15.571V11a1 1 0 112 0v4.571a1 1 0 00.725.962l5 1.428a1 1 0 001.17-1.408l-7-14z" />
              </svg>
            </button>
          </div>
          <p className="text-xs text-gray-300 mt-1.5 text-center">
            Enter לשליחה · Shift+Enter לשורה חדשה
          </p>
        </div>
      </div>
    </>
  );
}

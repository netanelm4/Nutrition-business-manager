import { useState, useRef, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { streamAgentChat, fetchAgentConversation } from '../../lib/api';
import { AGENT_TOOL_LABEL, AGENT_QUICK_PROMPTS, AGENT_CONVERSATION_KEY } from '../../constants/agent';

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
    <div style={{ fontSize: 13, lineHeight: 1.6, display: 'flex', flexDirection: 'column', gap: 6 }}>
      {blocks.map((block, bi) => {
        const lines = block.split('\n').filter(Boolean);
        if (lines.length === 0) return null;

        const isUnordered = lines.every((l) => /^\s*[-•*]\s/.test(l));
        const isOrdered   = lines.every((l) => /^\s*\d+\.\s/.test(l));

        if (isUnordered) {
          return (
            <ul key={bi} style={{ paddingInlineStart: 18, margin: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
              {lines.map((l, li) => (
                <li key={li}>{parseBold(l.replace(/^\s*[-•*]\s*/, ''))}</li>
              ))}
            </ul>
          );
        }

        if (isOrdered) {
          return (
            <ol key={bi} style={{ paddingInlineStart: 18, margin: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
              {lines.map((l, li) => (
                <li key={li}>{parseBold(l.replace(/^\s*\d+\.\s*/, ''))}</li>
              ))}
            </ol>
          );
        }

        return (
          <p key={bi} style={{ margin: 0 }}>
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
    <div style={{ display: 'flex', gap: 5, alignItems: 'center', padding: '2px 4px' }}>
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          className="animate-bounce"
          style={{ width: 7, height: 7, borderRadius: '50%', background: 'var(--ink-3)', display: 'inline-block', animationDelay: `${i * 0.15}s` }}
        />
      ))}
    </div>
  );
}

// ─── Quick action chips ───────────────────────────────────────────────────────

const QUICK_CHIPS = AGENT_QUICK_PROMPTS;

// ─── Tool activity chip (read / proposal / autonomous write) ─────────────────

function ToolChip({ msg, onNavigate }) {
  const label = AGENT_TOOL_LABEL[msg.name] || msg.name;
  const tone = msg.isError ? 'var(--red-ink)' : msg.kind === 'propose' ? 'var(--blue-ink)' : 'var(--ink-3)';
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', fontSize: 12, color: tone }}>
      <span aria-hidden="true">{msg.pending ? '…' : msg.isError ? '!' : '✓'}</span>
      <span>{label}</span>
      {msg.summary && <span style={{ color: 'var(--ink-4)' }}>· {msg.summary}</span>}
      {msg.proposalId && (
        <Link to="/" onClick={onNavigate} style={{ color: 'var(--blue)', textDecoration: 'underline' }}>
          לתיבת הפעולות
        </Link>
      )}
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function AIAssistant({ isOpen, onClose }) {
  // history items: { role: 'user'|'assistant', content } | { role: 'tool', name, kind, summary, proposalId, isError, pending }
  const [history,   setHistory]   = useState([]);
  const [inputText, setInputText] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [conversationId, setConversationId] = useState(() => Number(localStorage.getItem(AGENT_CONVERSATION_KEY)) || null);
  const queryClient = useQueryClient();
  const abortRef = useRef(null);

  // Reload the stored conversation (server-side history) when the drawer opens
  useEffect(() => {
    if (!isOpen || !conversationId || history.length > 0) return;
    fetchAgentConversation(conversationId)
      .then((data) => setHistory((data?.messages || []).map((m) => (
        m.role === 'tool' ? { role: 'tool', name: m.name } : { role: m.role, content: m.text }
      ))))
      .catch(() => { localStorage.removeItem(AGENT_CONVERSATION_KEY); setConversationId(null); });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, conversationId]);

  function newConversation() {
    abortRef.current?.abort();
    localStorage.removeItem(AGENT_CONVERSATION_KEY);
    setConversationId(null);
    setHistory([]);
  }

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

    setHistory((h) => [...h, { role: 'user', content: msg }]);
    setInputText('');
    setIsLoading(true);
    if (textareaRef.current) textareaRef.current.style.height = 'auto';

    const controller = new AbortController();
    abortRef.current = controller;
    // Streaming text appends to the last assistant bubble; a tool event closes it
    const appendText = (delta) => setHistory((h) => {
      const last = h[h.length - 1];
      if (last?.role === 'assistant' && last.streaming) {
        return [...h.slice(0, -1), { ...last, content: last.content + delta }];
      }
      return [...h, { role: 'assistant', content: delta, streaming: true }];
    });
    const closeBubble = (h) => h.map((m) => (m.streaming ? { ...m, streaming: false } : m));

    try {
      await streamAgentChat({
        message: msg,
        conversationId,
        signal: controller.signal,
        onEvent: (type, data) => {
          if (type === 'conversation' && data?.id) {
            setConversationId(data.id);
            localStorage.setItem(AGENT_CONVERSATION_KEY, String(data.id));
          } else if (type === 'text') {
            appendText(data.text);
          } else if (type === 'tool_start') {
            setHistory((h) => [...closeBubble(h), { role: 'tool', id: data.id, name: data.name, pending: true }]);
          } else if (type === 'tool_result') {
            setHistory((h) => h.map((m) => (m.role === 'tool' && m.id === data.id
              ? { ...m, pending: false, kind: data.kind, summary: data.summary, isError: data.is_error, proposalId: data.proposal_id }
              : m)));
          } else if (type === 'error') {
            setHistory((h) => [...closeBubble(h), { role: 'assistant', content: data.message || 'אירעה שגיאה. אפשר לנסות שוב.' }]);
            if (data.code === 'conversation_full') {
              localStorage.removeItem(AGENT_CONVERSATION_KEY);
              setConversationId(null);
            }
          } else if (type === 'done') {
            setHistory(closeBubble);
            if (data?.proposals?.length) queryClient.invalidateQueries({ queryKey: ['inbox'] });
          }
        },
      });
    } catch (err) {
      if (err.name !== 'AbortError') {
        setHistory((h) => [...closeBubble(h), { role: 'assistant', content: 'אירעה שגיאה בחיבור לעוזר. אפשר לנסות שוב.' }]);
      }
    } finally {
      setIsLoading(false);
      abortRef.current = null;
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
      {/* Mobile overlay */}
      <div
        style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.3)', zIndex: 999,
          opacity: isOpen ? 1 : 0, pointerEvents: isOpen ? 'auto' : 'none',
          transition: 'opacity 0.25s',
        }}
        className="md:hidden"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Panel */}
      <div
        dir="rtl"
        style={{
          position: 'fixed', top: 0, bottom: 0, insetInlineEnd: 0, zIndex: 1000, // opposite the (right-hand) sidebar
          width: 'min(380px, 100vw)',
          display: 'flex', flexDirection: 'column',
          background: 'var(--surface-1)',
          borderInlineStart: '1px solid var(--line)', // inner edge, facing the content
          // The drawer sits on the left (inline-end under RTL): it hides by
          // sliding further left, and is invisible to focus/AT while closed.
          boxShadow: isOpen ? '4px 0 32px rgba(0,0,0,0.25)' : 'none',
          transform: isOpen ? 'translateX(0)' : 'translateX(-100%)',
          visibility: isOpen ? 'visible' : 'hidden',
          transition: isOpen ? 'transform 0.25s ease' : 'transform 0.25s ease, visibility 0s linear 0.25s',
        }}
        aria-label="עוזר AI"
        role="complementary"
      >
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 16px', borderBottom: '1px solid var(--hairline)', flexShrink: 0 }}>
          <div>
            <h2 style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--ink-1)', margin: 0 }}>עוזר AI</h2>
            <p style={{ fontSize: 11.5, color: 'var(--ink-3)', margin: '2px 0 0' }}>מחובר למערכת | {todayLabel}</p>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            {history.length > 0 && (
              <button
                type="button"
                onClick={newConversation}
                style={{ fontSize: 12, color: 'var(--ink-3)', background: 'none', border: 'none', cursor: 'pointer', padding: '4px 8px', borderRadius: 6 }}
                onMouseEnter={(e) => e.currentTarget.style.background = 'var(--surface-2)'}
                onMouseLeave={(e) => e.currentTarget.style.background = ''}
              >
                שיחה חדשה
              </button>
            )}
            <button
              type="button"
              onClick={onClose}
              style={{ width: 30, height: 30, display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: '50%', background: 'none', border: 'none', cursor: 'pointer', fontSize: 20, color: 'var(--ink-3)', lineHeight: 1 }}
              aria-label="סגירה"
            >
              ×
            </button>
          </div>
        </div>

        {/* Chat area */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '16px 16px' }}>
          {history.length === 0 && !isLoading ? (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', gap: 20, textAlign: 'center', padding: '0 8px' }}>
              <div style={{ fontSize: 40 }}>✨</div>
              <div>
                <p style={{ fontWeight: 600, fontSize: 15, color: 'var(--ink-1)', margin: 0 }}>שלום נתנאל</p>
                <p style={{ fontSize: 13, color: 'var(--ink-3)', marginTop: 8, lineHeight: 1.6 }}>
                  העוזר מחובר לכל המערכת: מטופלים, לידים, יומן ותיבת הפעולות.<br />
                  פעולות שמשנות נתונים מגיעות כהצעה לאישור בתיבה.
                </p>
                <p style={{ fontSize: 13, color: 'var(--ink-3)', margin: '4px 0 0' }}>במה אפשר לעזור?</p>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, width: '100%', marginTop: 4 }}>
                {QUICK_CHIPS.map((chip) => (
                  <button
                    key={chip}
                    type="button"
                    onClick={() => sendMessage(chip)}
                    style={{
                      fontSize: 13, textAlign: 'start', padding: '10px 14px',
                      borderRadius: 10, border: '1px solid var(--line)',
                      background: 'var(--surface-1)', color: 'var(--ink-2)',
                      cursor: 'pointer', transition: 'border-color 0.15s',
                    }}
                    onMouseEnter={(e) => { e.currentTarget.style.borderColor = 'var(--blue)'; e.currentTarget.style.background = 'var(--blue-soft)'; }}
                    onMouseLeave={(e) => { e.currentTarget.style.borderColor = 'var(--line)'; e.currentTarget.style.background = 'var(--surface-1)'; }}
                  >
                    {chip}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {history.map((msg, i) => msg.role === 'tool' ? (
                <div key={i} style={{ display: 'flex', justifyContent: 'flex-end', paddingInline: 6 }}>
                  <ToolChip msg={msg} onNavigate={onClose} />
                </div>
              ) : (
                <div key={i} style={{ display: 'flex', justifyContent: msg.role === 'user' ? 'flex-start' : 'flex-end' }}>
                  <div
                    style={{
                      padding: '10px 14px',
                      maxWidth: msg.role === 'user' ? '80%' : '90%',
                      minWidth: 0,
                      overflowWrap: 'anywhere',
                      borderRadius: msg.role === 'user' ? '14px 14px 4px 14px' : '14px 14px 14px 4px',
                      background: msg.role === 'user' ? 'var(--blue)' : 'var(--surface-2)',
                      color: msg.role === 'user' ? 'var(--on-accent)' : 'var(--ink-1)',
                    }}
                  >
                    {msg.role === 'assistant' ? (
                      <MarkdownText text={msg.content} />
                    ) : (
                      <p style={{ fontSize: 13, lineHeight: 1.55, whiteSpace: 'pre-wrap', margin: 0 }}>{msg.content}</p>
                    )}
                  </div>
                </div>
              ))}

              {isLoading && !history[history.length - 1]?.streaming && (
                <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                  <div style={{ background: 'var(--surface-2)', borderRadius: '14px 14px 14px 4px', padding: '10px 14px' }}>
                    <LoadingDots />
                  </div>
                </div>
              )}

              <div ref={chatEndRef} />
            </div>
          )}
        </div>

        {/* Input area */}
        <div style={{ flexShrink: 0, borderTop: '1px solid var(--hairline)', padding: '10px 12px' }}>
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: 8 }}>
            <textarea
              ref={textareaRef}
              value={inputText}
              onChange={handleTextareaChange}
              onKeyDown={handleKeyDown}
              placeholder="אפשר לשאול כל דבר על המערכת..."
              disabled={isLoading}
              rows={1}
              dir="rtl"
              style={{
                flex: 1, resize: 'none', borderRadius: 10, border: '1px solid var(--line)',
                padding: '8px 12px', fontSize: 13, background: 'var(--surface-2)',
                color: 'var(--ink-1)', outline: 'none', maxHeight: 96, overflow: 'hidden',
                fontFamily: 'inherit',
              }}
              onFocus={(e) => { e.currentTarget.style.borderColor = 'var(--blue)'; e.currentTarget.style.background = 'var(--surface-1)'; }}
              onBlur={(e) => { e.currentTarget.style.borderColor = 'var(--line)'; e.currentTarget.style.background = 'var(--surface-2)'; }}
            />
            <button
              type="button"
              onClick={() => sendMessage(inputText)}
              disabled={!inputText.trim() || isLoading}
              style={{
                flexShrink: 0, width: 36, height: 36, borderRadius: 10,
                background: 'var(--blue)', color: 'var(--on-accent)', border: 'none', cursor: 'pointer',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                opacity: (!inputText.trim() || isLoading) ? 0.4 : 1,
                transition: 'opacity 0.15s',
              }}
              aria-label="שליחה"
            >
              <svg viewBox="0 0 20 20" fill="currentColor" width="15" height="15">
                <path d="M10.894 2.553a1 1 0 00-1.788 0l-7 14a1 1 0 001.169 1.409l5-1.429A1 1 0 009 15.571V11a1 1 0 112 0v4.571a1 1 0 00.725.962l5 1.428a1 1 0 001.17-1.408l-7-14z" />
              </svg>
            </button>
          </div>
          <p style={{ fontSize: 11, color: 'var(--ink-4)', marginTop: 6, textAlign: 'center' }}>
            Enter לשליחה · Shift+Enter לשורה חדשה
          </p>
        </div>
      </div>
    </>
  );
}

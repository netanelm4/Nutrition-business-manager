import { useMutation, useQueryClient } from '@tanstack/react-query';
import { updateSession } from '../../lib/api';

/**
 * Toggle button for "שמור לפגישה הבאה".
 */
function SaveToggle({ saved, onToggle }) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className={`text-xs px-2 py-0.5 rounded-full border transition-colors flex-shrink-0 ${
        saved
          ? 'bg-indigo-100 text-indigo-700 border-indigo-300'
          : 'bg-gray-50 text-gray-400 border-gray-200 hover:border-indigo-300 hover:text-indigo-600'
      }`}
    >
      {saved ? '✓ שמור' : 'שמור לפגישה הבאה'}
    </button>
  );
}

function InsightItem({ text, saved, onToggle }) {
  return (
    <div className="flex items-start gap-2 py-2 border-b border-gray-100 last:border-0">
      <p className="flex-1 text-sm text-gray-700 leading-relaxed">{text}</p>
      <SaveToggle saved={saved} onToggle={onToggle} />
    </div>
  );
}

/**
 * Read + toggle AI insights and flags for a session.
 * Persists toggle state to the server immediately on each click.
 *
 * @param {object}   session    - Full session object (with parsed ai_insights / ai_flags arrays)
 * @param {string}   clientId   - Used for query invalidation
 */
export default function AIInsightsPanel({ session, clientId }) {
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: (updates) => updateSession(session.id, updates),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['sessions', String(clientId)] });
    },
  });

  function toggleInsight(index) {
    const updated = session.ai_insights.map((item, i) =>
      i === index ? { ...item, saved_for_next: !item.saved_for_next } : item
    );
    mutation.mutate({ ai_insights: updated });
  }

  function toggleFlag(index) {
    const updated = session.ai_flags.map((item, i) =>
      i === index ? { ...item, saved_for_next: !item.saved_for_next } : item
    );
    mutation.mutate({ ai_flags: updated });
  }

  const hasInsights = session.ai_insights?.length > 0;
  const hasFlags    = session.ai_flags?.length > 0;

  if (!hasInsights && !hasFlags) {
    return (
      <p className="text-sm text-gray-400 italic">
        לא נוצרו תובנות AI עדיין לפגישה זו.
      </p>
    );
  }

  return (
    <div className="space-y-4">
      {hasInsights && (
        <div>
          <h4 className="text-xs font-semibold text-indigo-600 uppercase tracking-wide mb-1">
            הצעות קליניות
          </h4>
          <div className="bg-indigo-50 rounded-lg px-3">
            {session.ai_insights.map((item, i) => (
              <InsightItem
                key={i}
                text={item.text}
                saved={!!item.saved_for_next}
                onToggle={() => toggleInsight(i)}
              />
            ))}
          </div>
        </div>
      )}

      {hasFlags && (
        <div>
          <h4 className="text-xs font-semibold text-orange-600 uppercase tracking-wide mb-1">
            דגלים לתשומת לב
          </h4>
          <div className="bg-orange-50 rounded-lg px-3">
            {session.ai_flags.map((item, i) => (
              <InsightItem
                key={i}
                text={item.text}
                saved={!!item.saved_for_next}
                onToggle={() => toggleFlag(i)}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

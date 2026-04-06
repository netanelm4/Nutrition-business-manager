import { useAlertColor } from '../../hooks/useAlertColor';

const STATE_LABEL = {
  green:  'תקין',
  yellow: 'ממתין',
  red:    'דחוף',
  none:   '',
};

/**
 * Coloured dot + label pill for alert state.
 * @param {string} state  - 'green' | 'yellow' | 'red' | 'none'
 * @param {string} label  - Override the default Hebrew label (optional)
 */
export default function AlertBadge({ state, label }) {
  const { dot, text, border, bg } = useAlertColor(state);
  const displayLabel = label ?? STATE_LABEL[state] ?? '';
  if (!displayLabel) return null;

  return (
    <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium border ${text} ${border} ${bg}`}>
      <span className={`w-2 h-2 rounded-full flex-shrink-0 ${dot}`} />
      {displayLabel}
    </span>
  );
}

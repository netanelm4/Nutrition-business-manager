import { ALERT_STATE } from '../constants/statuses';

const COLOR_MAP = {
  [ALERT_STATE.GREEN]:  { dot: 'bg-green-500',  text: 'text-green-700',  border: 'border-green-300',  bg: 'bg-green-50'  },
  [ALERT_STATE.YELLOW]: { dot: 'bg-yellow-400', text: 'text-yellow-700', border: 'border-yellow-300', bg: 'bg-yellow-50' },
  [ALERT_STATE.RED]:    { dot: 'bg-red-500',    text: 'text-red-700',    border: 'border-red-300',    bg: 'bg-red-50'    },
  [ALERT_STATE.NONE]:   { dot: 'bg-gray-300',   text: 'text-gray-500',   border: 'border-gray-200',   bg: 'bg-gray-50'   },
};

const FALLBACK = COLOR_MAP[ALERT_STATE.NONE];

/**
 * Returns Tailwind class sets for a given alert state string.
 * Usage: const { dot, text, border, bg } = useAlertColor(state);
 */
export function useAlertColor(state) {
  return COLOR_MAP[state] ?? FALLBACK;
}

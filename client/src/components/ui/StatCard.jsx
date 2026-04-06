/**
 * Metric card: big number + label.
 * @param {number|string} value
 * @param {string}        label
 * @param {string}        [color]  - Tailwind text color for the value (default: text-indigo-600)
 */
export default function StatCard({ value, label, color = 'text-indigo-600' }) {
  return (
    <div className="flex-1 bg-white rounded-xl border border-gray-200 p-5 flex flex-col items-center gap-1 min-w-0">
      <span className={`text-3xl font-bold ${color}`}>
        {value ?? '—'}
      </span>
      <span className="text-sm text-gray-500 text-center">{label}</span>
    </div>
  );
}

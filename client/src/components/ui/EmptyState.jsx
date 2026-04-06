/**
 * Reusable "nothing here yet" placeholder.
 * @param {string} message  - Main message (Hebrew)
 * @param {string} [sub]    - Optional sub-message
 */
export default function EmptyState({ message, sub }) {
  return (
    <div className="flex flex-col items-center justify-center py-10 text-center text-gray-400 gap-2">
      <span className="text-4xl">📭</span>
      <p className="text-sm font-medium text-gray-500">{message}</p>
      {sub && <p className="text-xs text-gray-400">{sub}</p>}
    </div>
  );
}

/**
 * Safely parse a JSON string stored in a SQLite TEXT column.
 * Falls back to an empty array if the value is null, undefined, or invalid JSON.
 */
function parseJsonArray(value) {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

module.exports = { parseJsonArray };

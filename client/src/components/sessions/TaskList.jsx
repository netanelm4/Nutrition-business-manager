import { v4 as uuidv4 } from 'uuid';
import { TASK_STATUS } from '../../constants/statuses';

const STATUS_CYCLE = {
  [TASK_STATUS.PENDING]:     TASK_STATUS.IN_PROGRESS,
  [TASK_STATUS.IN_PROGRESS]: TASK_STATUS.DONE,
  [TASK_STATUS.DONE]:        TASK_STATUS.PENDING,
};

const STATUS_ICON = {
  [TASK_STATUS.PENDING]:     '○',
  [TASK_STATUS.IN_PROGRESS]: '◑',
  [TASK_STATUS.DONE]:        '●',
};

const STATUS_COLOR = {
  [TASK_STATUS.PENDING]:     'text-gray-400',
  [TASK_STATUS.IN_PROGRESS]: 'text-yellow-500',
  [TASK_STATUS.DONE]:        'text-green-500',
};

/**
 * Editable task list used inside SessionModal.
 * @param {Array}    tasks     - Array of task objects
 * @param {function} onChange  - Called with new tasks array
 */
export function EditableTaskList({ tasks = [], onChange }) {
  function addTask() {
    onChange([
      ...tasks,
      { id: uuidv4(), text: '', status: TASK_STATUS.PENDING, carried_over_from_session: null },
    ]);
  }

  function updateText(id, text) {
    onChange(tasks.map((t) => (t.id === id ? { ...t, text } : t)));
  }

  function removeTask(id) {
    onChange(tasks.filter((t) => t.id !== id));
  }

  function toggleStatus(id) {
    onChange(
      tasks.map((t) =>
        t.id === id ? { ...t, status: STATUS_CYCLE[t.status] ?? TASK_STATUS.PENDING } : t
      )
    );
  }

  return (
    <div className="space-y-2">
      {tasks.map((task) => (
        <div key={task.id} className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => toggleStatus(task.id)}
            className={`flex-shrink-0 text-lg leading-none transition-colors ${STATUS_COLOR[task.status]}`}
            title="שנה סטטוס"
          >
            {STATUS_ICON[task.status]}
          </button>
          <input
            type="text"
            value={task.text}
            onChange={(e) => updateText(task.id, e.target.value)}
            placeholder="תיאור המשימה..."
            className="flex-1 text-sm border-b border-gray-200 py-1 px-0 focus:outline-none focus:border-indigo-400 bg-transparent"
          />
          {task.carried_over_from_session && (
            <span className="text-xs text-gray-400 flex-shrink-0">
              מפגישה {task.carried_over_from_session}
            </span>
          )}
          <button
            type="button"
            onClick={() => removeTask(task.id)}
            className="flex-shrink-0 text-gray-300 hover:text-red-400 transition-colors text-sm"
            aria-label="מחק משימה"
          >
            ✕
          </button>
        </div>
      ))}
      <button
        type="button"
        onClick={addTask}
        className="text-sm text-indigo-600 hover:text-indigo-800 transition-colors flex items-center gap-1"
      >
        <span>+</span>
        <span>הוסף משימה</span>
      </button>
    </div>
  );
}

/**
 * Read-only task list used inside session accordion (SessionHistory).
 * @param {Array} tasks
 */
export function ReadonlyTaskList({ tasks = [] }) {
  if (tasks.length === 0) {
    return <p className="text-sm text-gray-400">אין משימות לפגישה זו.</p>;
  }

  return (
    <ul className="space-y-1.5">
      {tasks.map((task) => (
        <li key={task.id} className="flex items-start gap-2">
          <span className={`flex-shrink-0 text-base leading-tight ${STATUS_COLOR[task.status] ?? 'text-gray-400'}`}>
            {STATUS_ICON[task.status] ?? '○'}
          </span>
          <span
            className={`text-sm ${
              task.status === TASK_STATUS.DONE ? 'line-through text-gray-400' : 'text-gray-700'
            }`}
          >
            {task.text}
            {task.carried_over_from_session && (
              <span className="mr-1.5 text-xs text-gray-400">
                (הועבר מפגישה {task.carried_over_from_session})
              </span>
            )}
          </span>
        </li>
      ))}
    </ul>
  );
}

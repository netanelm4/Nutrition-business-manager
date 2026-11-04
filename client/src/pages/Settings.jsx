import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { fetchUsers, createUser, toggleUserActive, resetUserPassword, fetchActivityLog } from '../lib/api';

export default function Settings() {
  const queryClient = useQueryClient();

  const [showAddUser, setShowAddUser]   = useState(false);
  const [newName, setNewName]           = useState('');
  const [newPassword, setNewPassword]   = useState('');
  const [resetTargetId, setResetTargetId] = useState(null);
  const [resetPasswordValue, setResetPasswordValue] = useState('');

  const { data: users = [], isLoading: usersLoading } = useQuery({
    queryKey: ['settings-users'],
    queryFn:  fetchUsers,
  });

  const { data: activity = [], isLoading: activityLoading } = useQuery({
    queryKey: ['settings-activity'],
    queryFn:  fetchActivityLog,
  });

  async function handleAddUser(e) {
    e.preventDefault();
    if (!newName.trim() || !newPassword.trim()) return;
    await createUser(newName.trim(), newPassword);
    setNewName('');
    setNewPassword('');
    setShowAddUser(false);
    queryClient.invalidateQueries(['settings-users']);
  }

  async function handleToggle(id) {
    await toggleUserActive(id);
    queryClient.invalidateQueries(['settings-users']);
  }

  async function handleResetPassword(id) {
    if (!resetPasswordValue.trim()) return;
    await resetUserPassword(id, resetPasswordValue);
    setResetTargetId(null);
    setResetPasswordValue('');
  }

  return (
    <div className="crm-page" style={{ maxWidth: 800 }}>
      <h1 className="page-title" style={{ marginBottom: 24 }}>הגדרות</h1>

      {/* ── משתמשים ── */}
      <section className="bg-white rounded-xl border border-gray-200 p-5" style={{ marginBottom: 24 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, flexWrap: 'wrap', gap: 8 }}>
          <h2 style={{ fontSize: 15, fontWeight: 700, color: 'var(--ink-1)' }}>משתמשים</h2>
          <button
            type="button"
            className="crm-btn crm-btn--primary"
            onClick={() => setShowAddUser((v) => !v)}
          >
            {showAddUser ? 'ביטול' : 'הוספת משתמש'}
          </button>
        </div>

        {showAddUser && (
          <form
            onSubmit={handleAddUser}
            style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 16, padding: 12, background: 'var(--surface-2)', borderRadius: 8 }}
          >
            <input
              className="field-input"
              placeholder="שם"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              style={{ flex: '1 1 140px' }}
            />
            <input
              className="field-input"
              type="password"
              placeholder="סיסמה"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              style={{ flex: '1 1 140px' }}
            />
            <button type="submit" className="crm-btn crm-btn--primary">שמירה</button>
          </form>
        )}

        {usersLoading && (
          <p style={{ fontSize: 13, color: 'var(--ink-3)' }}>טוען...</p>
        )}

        {!usersLoading && (
          <div style={{ overflowX: 'auto' }}>
            <table className="table">
              <thead>
                <tr>
                  <th>שם</th>
                  <th>סטטוס</th>
                  <th>התחברות אחרונה</th>
                  <th>פעולות</th>
                </tr>
              </thead>
              <tbody>
                {users.map((u) => (
                  <tr key={u.id}>
                    <td>{u.name}</td>
                    <td>
                      <span className={`chip ${u.is_active ? 'chip--green' : 'chip--red'}`}>
                        <span className="dot" />
                        {u.is_active ? 'פעיל' : 'מושבת'}
                      </span>
                    </td>
                    <td style={{ fontSize: 12.5, color: 'var(--ink-3)' }}>
                      {u.last_login_at ? new Date(u.last_login_at).toLocaleString('he-IL') : 'טרם התחבר'}
                    </td>
                    <td>
                      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                        <button
                          type="button"
                          className="crm-btn crm-btn--ghost"
                          onClick={() => handleToggle(u.id)}
                        >
                          {u.is_active ? 'השבתה' : 'הפעלה'}
                        </button>

                        {resetTargetId === u.id ? (
                          <>
                            <input
                              className="field-input"
                              type="password"
                              placeholder="סיסמה חדשה"
                              value={resetPasswordValue}
                              onChange={(e) => setResetPasswordValue(e.target.value)}
                              style={{ width: 120 }}
                            />
                            <button
                              type="button"
                              className="crm-btn crm-btn--primary"
                              onClick={() => handleResetPassword(u.id)}
                            >
                              שמירה
                            </button>
                          </>
                        ) : (
                          <button
                            type="button"
                            className="crm-btn crm-btn--ghost"
                            onClick={() => { setResetTargetId(u.id); setResetPasswordValue(''); }}
                          >
                            איפוס סיסמה
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* ── פעילות אחרונה ── */}
      <section className="bg-white rounded-xl border border-gray-200 p-5">
        <h2 style={{ fontSize: 15, fontWeight: 700, color: 'var(--ink-1)', marginBottom: 16 }}>
          פעילות אחרונה
        </h2>

        {activityLoading && (
          <p style={{ fontSize: 13, color: 'var(--ink-3)' }}>טוען...</p>
        )}

        {!activityLoading && activity.length === 0 && (
          <p style={{ fontSize: 13, color: 'var(--ink-3)' }}>אין פעילות עדיין.</p>
        )}

        {!activityLoading && activity.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {activity.map((a) => (
              <div
                key={a.id}
                style={{ display: 'flex', justifyContent: 'space-between', gap: 8, fontSize: 13, borderBottom: '1px solid var(--surface-3)', paddingBottom: 8, flexWrap: 'wrap' }}
              >
                <span style={{ color: 'var(--ink-1)', fontWeight: 500 }}>{a.user_name}</span>
                <span style={{ color: 'var(--ink-2)', flex: 1 }}>{a.label || `${a.method} ${a.path}`}</span>
                <span style={{ color: 'var(--ink-3)', fontSize: 12 }}>
                  {new Date(a.created_at).toLocaleString('he-IL')}
                </span>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

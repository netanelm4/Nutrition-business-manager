import { useState } from 'react';
import { checkHealth } from '../lib/api';

export default function Login({ onLogin }) {
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    if (!password.trim()) return;
    setLoading(true);
    setError('');
    try {
      const result = await checkHealth(password);
      if (result.ok) {
        localStorage.setItem('auth_password', password);
        onLogin();
      } else {
        setError('סיסמה שגויה');
      }
    } catch {
      setError('לא ניתן להתחבר לשרת. בדוק שהשרת פועל.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div
      style={{
        minHeight: '100vh',
        background: 'var(--canvas)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 16,
      }}
      dir="rtl"
    >
      <div
        className="card"
        style={{ width: '100%', maxWidth: 360, padding: '36px 32px' }}
      >
        <div style={{ textAlign: 'center', marginBottom: 28 }}>
          <h1 style={{ fontSize: 22, fontWeight: 700, color: 'var(--ink-1)', marginBottom: 4 }}>
            ניהול לקוחות
          </h1>
          <p style={{ fontSize: 13, color: 'var(--ink-3)' }}>תזונה קלינית</p>
        </div>

        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <label style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--ink-2)' }}>סיסמה</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="הזן סיסמה"
              className="field-input"
              style={{ width: '100%' }}
              autoFocus
            />
          </div>

          {error && (
            <p style={{ fontSize: 13, color: 'var(--red-ink)', background: 'var(--red-soft)', padding: '8px 12px', borderRadius: 8 }}>
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={loading}
            className="crm-btn crm-btn--primary"
            style={{ width: '100%', justifyContent: 'center', padding: '10px 16px', marginTop: 4 }}
          >
            {loading ? 'מתחבר...' : 'כניסה'}
          </button>
        </form>
      </div>
    </div>
  );
}

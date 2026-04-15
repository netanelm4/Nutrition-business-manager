const express = require('express');
const db = require('../database/db');

const router = express.Router();

function ok(res, data) {
  return res.json({ success: true, data });
}

function fail(res, status, message) {
  return res.status(status).json({ success: false, error: message });
}

// ── Recompute payment_status for a client and update it ──────────────────────

function syncPaymentStatus(clientId) {
  const client = db.prepare('SELECT package_price FROM clients WHERE id = ?').get(clientId);
  if (!client) return;

  const row = db
    .prepare('SELECT COALESCE(SUM(amount), 0) as total FROM payments WHERE client_id = ?')
    .get(clientId);

  const totalPaid    = Number((row.total || 0).toFixed(2));
  const packagePrice = Number((client.package_price || 0).toFixed(2));

  let status;
  if (totalPaid <= 0) {
    status = 'unpaid';
  } else if (packagePrice === 0) {
    status = 'paid';
  } else if (totalPaid >= packagePrice) {
    status = 'paid';
  } else {
    status = 'partial';
  }

  db.prepare('UPDATE clients SET payment_status = ? WHERE id = ?').run(status, clientId);
  return { total, status };
}

// ── GET /api/clients/:id/payments ─────────────────────────────────────────────

router.get('/clients/:id/payments', (req, res) => {
  try {
    const client = db.prepare('SELECT id FROM clients WHERE id = ?').get(req.params.id);
    if (!client) return fail(res, 404, 'Client not found.');

    const payments = db
      .prepare('SELECT * FROM payments WHERE client_id = ? ORDER BY paid_at DESC, id DESC')
      .all(req.params.id);

    return ok(res, payments);
  } catch (err) {
    console.error('[GET /clients/:id/payments]', err);
    return fail(res, 500, 'Failed to fetch payments.');
  }
});

// ── POST /api/clients/:id/payments ────────────────────────────────────────────

router.post('/clients/:id/payments', (req, res) => {
  try {
    const client = db.prepare('SELECT id FROM clients WHERE id = ?').get(req.params.id);
    if (!client) return fail(res, 404, 'Client not found.');

    const { amount, paid_at, note } = req.body;
    if (!amount || isNaN(Number(amount)) || Number(amount) <= 0) {
      return fail(res, 400, 'amount must be a positive number.');
    }
    if (!paid_at) return fail(res, 400, 'paid_at is required.');

    const result = db
      .prepare(
        'INSERT INTO payments (client_id, amount, paid_at, note) VALUES (@client_id, @amount, @paid_at, @note)'
      )
      .run({
        client_id: Number(req.params.id),
        amount: Number(amount),
        paid_at,
        note: note || null,
      });

    syncPaymentStatus(req.params.id);

    const payment = db.prepare('SELECT * FROM payments WHERE id = ?').get(result.lastInsertRowid);
    const updatedClient = db.prepare('SELECT payment_status FROM clients WHERE id = ?').get(req.params.id);

    return ok(res, { payment, payment_status: updatedClient.payment_status });
  } catch (err) {
    console.error('[POST /clients/:id/payments]', err);
    return fail(res, 500, 'Failed to add payment.');
  }
});

// ── DELETE /api/payments/:id ──────────────────────────────────────────────────

router.delete('/payments/:id', (req, res) => {
  try {
    const payment = db.prepare('SELECT * FROM payments WHERE id = ?').get(req.params.id);
    if (!payment) return fail(res, 404, 'Payment not found.');

    db.prepare('DELETE FROM payments WHERE id = ?').run(req.params.id);
    syncPaymentStatus(payment.client_id);

    const updatedClient = db.prepare('SELECT payment_status FROM clients WHERE id = ?').get(payment.client_id);
    return ok(res, {
      id: Number(req.params.id),
      client_id: payment.client_id,
      payment_status: updatedClient?.payment_status ?? 'unpaid',
    });
  } catch (err) {
    console.error('[DELETE /payments/:id]', err);
    return fail(res, 500, 'Failed to delete payment.');
  }
});

module.exports = router;

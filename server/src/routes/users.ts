import { Router, Response } from 'express';
import { AuthenticatedRequest, authenticate, requireRole } from '../auth';
import db from '../db';

const router = Router();

// List users (Admin only)
router.get('/', authenticate, requireRole(['admin']), async (req: AuthenticatedRequest, res: Response) => {
  const { search } = req.query;
  let query = 'SELECT id, full_name, email, role, is_verified, created_date, updated_date FROM users WHERE 1=1';
  const params: any[] = [];

  if (search && typeof search === 'string') {
    const s = `%${search.trim().toLowerCase()}%`;
    query += ' AND (LOWER(full_name) LIKE ? OR LOWER(email) LIKE ?)';
    params.push(s, s);
  }

  query += ' ORDER BY full_name ASC';
  const rows = await db.prepare(query).all(...params);
  return res.json(rows);
});

// Update user role (Admin only)
router.put('/:id/role', authenticate, requireRole(['admin']), async (req: AuthenticatedRequest, res: Response) => {
  const { id } = req.params;
  const { role } = req.body;
  const adminUser = req.user!;

  const validRoles = ['agency', 'mid', 'mid_gcc', 'admin'];
  if (!validRoles.includes(role)) {
    return res.status(400).json({ error: 'Invalid role' });
  }

  const existing = (await db.prepare('SELECT * FROM users WHERE id = ?').get(id)) as any;
  if (!existing) {
    return res.status(404).json({ error: 'User not found' });
  }

  const now = new Date().toISOString();
  await db.prepare('UPDATE users SET role = ?, updated_date = ? WHERE id = ?').run(role, now, id);

  await db.prepare(`
    INSERT INTO audit_logs (id, entity_type, entity_id, entity_number, action, performed_by, performed_by_name, field_changed, old_value, new_value, details, created_date)
    VALUES (?, 'User', ?, ?, 'UPDATE_ROLE', ?, ?, 'role', ?, ?, ?, ?)
  `).run(
    `aud-${Date.now()}`,
    id,
    existing.email,
    adminUser.id,
    adminUser.full_name,
    existing.role,
    role,
    `Admin changed role of ${existing.full_name} (${existing.email}) from ${existing.role} to ${role}`,
    now
  );

  return res.json({
    message: 'User role updated successfully',
    user: {
      id: existing.id,
      full_name: existing.full_name,
      email: existing.email,
      role,
      updated_date: now,
    }
  });
});

export default router;

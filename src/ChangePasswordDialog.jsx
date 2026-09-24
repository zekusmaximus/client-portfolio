import { useState } from 'react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { apiClient, apiErrorMessage } from './api';

const EMPTY = { currentPassword: '', newPassword: '', confirmPassword: '' };

/**
 * ChangePasswordDialog – lets the signed-in partner change their own password
 * (POST /api/auth/change-password). The only check here is that the new
 * password was typed the same twice; the server enforces the policy and
 * verifies the current password, and its message is shown as is.
 */
export default function ChangePasswordDialog({ open, onOpenChange }) {
  const [form, setForm] = useState(EMPTY);
  const [error, setError] = useState(null);
  const [done, setDone] = useState(false);
  const [loading, setLoading] = useState(false);

  if (!open) return null;

  const close = () => {
    setForm(EMPTY);
    setError(null);
    setDone(false);
    onOpenChange(false);
  };

  const update = (field) => (e) => setForm((f) => ({ ...f, [field]: e.target.value }));

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError(null);
    if (form.newPassword !== form.confirmPassword) {
      setError('The new passwords do not match.');
      return;
    }
    setLoading(true);
    try {
      await apiClient.post('/auth/change-password', {
        currentPassword: form.currentPassword,
        newPassword: form.newPassword,
      });
      setForm(EMPTY);
      setDone(true);
    } catch (err) {
      setError(apiErrorMessage(err, 'Could not change the password.'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4 backdrop-blur-sm"
      onClick={(e) => { if (e.target === e.currentTarget && !loading) close(); }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="change-password-title"
        className="w-full max-w-md rounded-lg border bg-card p-6 shadow-2xl"
      >
        <h2 id="change-password-title" className="mb-4 text-lg font-semibold">
          Change password
        </h2>

        {done ? (
          <div className="space-y-4">
            <p className="text-sm">Your password has been changed.</p>
            <div className="flex justify-end">
              <Button onClick={close}>Close</Button>
            </div>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <Label htmlFor="current-password">Current password</Label>
              <Input
                id="current-password"
                type="password"
                autoComplete="current-password"
                value={form.currentPassword}
                disabled={loading}
                onChange={update('currentPassword')}
                required
                className="mt-1"
              />
            </div>

            <div>
              <Label htmlFor="new-password">New password</Label>
              <Input
                id="new-password"
                type="password"
                autoComplete="new-password"
                value={form.newPassword}
                disabled={loading}
                onChange={update('newPassword')}
                required
                className="mt-1"
              />
              <p className="mt-1 text-xs text-muted-foreground">
                At least 8 characters, with an uppercase letter, a lowercase letter, a number and a symbol.
              </p>
            </div>

            <div>
              <Label htmlFor="confirm-password">Confirm new password</Label>
              <Input
                id="confirm-password"
                type="password"
                autoComplete="new-password"
                value={form.confirmPassword}
                disabled={loading}
                onChange={update('confirmPassword')}
                required
                className="mt-1"
              />
            </div>

            {error && <p role="alert" className="text-sm text-red-500">{error}</p>}

            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" disabled={loading} onClick={close}>
                Cancel
              </Button>
              <Button type="submit" disabled={loading}>
                {loading ? 'Saving...' : 'Change password'}
              </Button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}

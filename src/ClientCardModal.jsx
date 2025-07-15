import React, { useState, useEffect } from 'react';
import { Tabs, TabsList, TabsTrigger, TabsContent } from './components/ui/tabs';
import { Input } from './components/ui/input';
import { Button } from './components/ui/button';
import { postClient, putClient, postRevenue, putRevenue } from './api';
import usePortfolioStore from './portfolioStore';

/**
 * Build an empty client record for “create” mode
 */
const emptyClient = {
  name: '',
  status: 'Prospect',
  practice_area: '',
  primary_lobbyist: '',
  client_originator: '',
  lobbyist_team: '',
  notes: '',
  relationship_strength: 5,
  conflict_risk: 'Medium',
  renewal_probability: 0.7,
  strategic_fit_score: 5,
  interaction_frequency: '',
  relationship_intensity: '',
  revenues: [],
};

/**
 * Very lightweight modal using Tailwind – avoids external dialog deps.
 * NOTE: Esc key / focus-trap not implemented – sufficient for Phase-3 skeleton.
 */
export default function ClientCardModal({ open, onOpenChange, client }) {
  const isEdit = Boolean(client);
  const [profile, setProfile] = useState(emptyClient);
  const [revenues, setRevenues] = useState([]);
  const [saving, setSaving] = useState(false);
  const fetchClients = usePortfolioStore((s) => s.fetchClients);

  /* Sync incoming client -> state */
  useEffect(() => {
    if (open) {
      setProfile(client ? { ...emptyClient, ...client } : emptyClient);
      setRevenues(client?.revenues ?? []);
    }
  }, [open, client]);

  const handleProfileChange = (e) => {
    const { name, value } = e.target;
    setProfile((p) => ({ ...p, [name]: value }));
  };

  const saveProfile = async () => {
    try {
      setSaving(true);
      if (isEdit) {
        await putClient(client.id, profile);
      } else {
        await postClient(profile);
      }
      await fetchClients();
      onOpenChange(false);
    } catch (err) {
      console.error('Save client failed', err);
      alert(err.message);
    } finally {
      setSaving(false);
    }
  };

  /* Revenue helpers */
  const upsertRevenue = async (rev) => {
    const isExisting = Boolean(rev.id);
    try {
      setSaving(true);
      if (isExisting) {
        await putRevenue(rev.id, rev);
      } else {
        await postRevenue(client.id, rev);
      }
      await fetchClients();
    } catch (err) {
      console.error('Save revenue failed', err);
      alert(err.message);
    } finally {
      setSaving(false);
    }
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 bg-black/30 z-40 flex items-center justify-center">
      <div className="bg-card rounded-lg shadow-lg w-full max-w-3xl max-h-[90vh] overflow-y-auto p-6">
        <h2 className="text-xl font-semibold mb-4">
          {isEdit ? 'Edit Client' : 'Add New Client'}
        </h2>

        <Tabs defaultValue="profile">
          <TabsList className="grid grid-cols-2 mb-4">
            <TabsTrigger value="profile">Client Profile</TabsTrigger>
            {isEdit && <TabsTrigger value="revenues">Annual Revenue</TabsTrigger>}
          </TabsList>

          <TabsContent value="profile" className="space-y-4">
            {/* Simple subset of fields for Phase-3 */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <Input
                label="Name"
                name="name"
                value={profile.name}
                onChange={handleProfileChange}
              />
              <Input
                label="Practice Area"
                name="practice_area"
                value={profile.practice_area}
                onChange={handleProfileChange}
              />
              <Input
                label="Primary Lobbyist"
                name="primary_lobbyist"
                value={profile.primary_lobbyist}
                onChange={handleProfileChange}
              />
              <Input
                label="Status"
                name="status"
                value={profile.status}
                onChange={handleProfileChange}
              />
            </div>

            <div className="flex justify-end gap-2 pt-4">
              <Button variant="ghost" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button onClick={saveProfile} disabled={saving}>
                {saving ? 'Saving…' : 'Save'}
              </Button>
            </div>
          </TabsContent>

          {isEdit && (
            <TabsContent value="revenues" className="space-y-4">
              <div className="space-y-2">
                {revenues.map((rev, idx) => (
                  <div key={rev.id ?? idx} className="flex gap-2 items-center">
                    <Input
                      type="number"
                      min="2000"
                      placeholder="Year"
                      value={rev.year}
                      onChange={(e) =>
                        setRevenues((arr) => {
                          const copy = [...arr];
                          copy[idx] = { ...copy[idx], year: e.target.value };
                          return copy;
                        })
                      }
                    />
                    <Input
                      type="number"
                      placeholder="Amount"
                      value={rev.revenue_amount}
                      onChange={(e) =>
                        setRevenues((arr) => {
                          const copy = [...arr];
                          copy[idx] = { ...copy[idx], revenue_amount: e.target.value };
                          return copy;
                        })
                      }
                    />
                    <Button
                      size="sm"
                      onClick={() => upsertRevenue(revenues[idx])}
                      disabled={saving}
                    >
                      Save
                    </Button>
                  </div>
                ))}
              </div>

              <Button
                variant="secondary"
                onClick={() =>
                  setRevenues((arr) => [...arr, { year: '', revenue_amount: '' }])
                }
                className="mt-2"
              >
                Add Year
              </Button>
            </TabsContent>
          )}
        </Tabs>
      </div>
    </div>
  );
}
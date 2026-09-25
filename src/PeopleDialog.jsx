import { useEffect, useState } from 'react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { NativeSelect } from '@/components/ui/native-select';
import usePortfolioStore from './portfolioStore';
import { apiErrorMessage } from './api';
import { groupPeople, ROLE_LABELS, ROLE_ORDER } from './utils/people';

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

function usage(person) {
  const parts = [];
  if (person.lead_count) parts.push(`leads ${plural(person.lead_count, 'client')}`);
  if (person.second_chair_count) parts.push(`second chair on ${person.second_chair_count}`);
  if (person.originator_count) parts.push(`originated ${person.originator_count}`);
  return parts.join(' · ') || 'no clients';
}

function RoleSelect({ id, value, onChange, disabled }) {
  return (
    <NativeSelect id={id} value={value} onChange={(e) => onChange(e.target.value)} disabled={disabled}>
      {ROLE_ORDER.map((role) => (
        <option key={role} value={role}>{ROLE_LABELS[role]}</option>
      ))}
    </NativeSelect>
  );
}

// One row: the person, and an inline editor for name, role and active.
function PersonRow({ person }) {
  const updatePerson = usePortfolioStore((s) => s.updatePerson);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState({ name: person.name, role: person.role, active: person.active });
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);

  const start = () => {
    setDraft({ name: person.name, role: person.role, active: person.active });
    setError(null);
    setEditing(true);
  };

  const save = async (e) => {
    e.preventDefault();
    const changes = {};
    if (draft.name.trim() !== person.name) changes.name = draft.name;
    if (draft.role !== person.role) changes.role = draft.role;
    if (draft.active !== person.active) changes.active = draft.active;
    if (Object.keys(changes).length === 0) {
      setEditing(false);
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await updatePerson(person.id, changes);
      setEditing(false);
    } catch (err) {
      setError(apiErrorMessage(err, 'Could not save the change.'));
    } finally {
      setSaving(false);
    }
  };

  if (!editing) {
    return (
      <li className="flex items-center justify-between gap-3 py-2">
        <div>
          <p className="text-sm font-medium">{person.name}</p>
          <p className="text-xs text-muted-foreground">
            {!person.active && `${ROLE_LABELS[person.role]} · `}{usage(person)}
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={start}>Edit</Button>
      </li>
    );
  }

  const fieldId = `person-${person.id}`;
  return (
    <li className="py-2">
      <form onSubmit={save} className="space-y-2 rounded-md border p-3">
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <div>
            <Label htmlFor={`${fieldId}-name`}>Name</Label>
            <Input
              id={`${fieldId}-name`}
              value={draft.name}
              disabled={saving}
              onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
              className="mt-1"
            />
          </div>
          <div>
            <Label htmlFor={`${fieldId}-role`}>Role</Label>
            <div className="mt-1">
              <RoleSelect
                id={`${fieldId}-role`}
                value={draft.role}
                disabled={saving}
                onChange={(role) => setDraft((d) => ({ ...d, role }))}
              />
            </div>
          </div>
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={draft.active}
            disabled={saving}
            onChange={(e) => setDraft((d) => ({ ...d, active: e.target.checked }))}
          />
          Active (can be assigned to clients)
        </label>
        {error && <p role="alert" className="text-sm text-red-500">{error}</p>}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" size="sm" disabled={saving} onClick={() => setEditing(false)}>
            Cancel
          </Button>
          <Button type="submit" size="sm" disabled={saving}>{saving ? 'Saving...' : 'Save'}</Button>
        </div>
      </form>
    </li>
  );
}

/**
 * PeopleDialog – the People list (docs/plans/people-and-second-chair.md, P1-P5):
 * everyone who can lead or second-chair a client. Adds a person, renames,
 * changes a role, deactivates or reactivates. Nobody is deleted, and the server
 * refuses a change that would leave a client without an active partner lead or
 * with an inactive second chair; its reason is shown as is.
 */
export default function PeopleDialog({ open, onOpenChange }) {
  const people = usePortfolioStore((s) => s.people);
  const peopleError = usePortfolioStore((s) => s.peopleError);
  const fetchPeople = usePortfolioStore((s) => s.fetchPeople);
  const addPerson = usePortfolioStore((s) => s.addPerson);

  const [newName, setNewName] = useState('');
  const [newRole, setNewRole] = useState('associate');
  const [addError, setAddError] = useState(null);
  const [adding, setAdding] = useState(false);

  // Counts change with every client edit, so refresh whenever the dialog opens
  useEffect(() => {
    if (open) fetchPeople();
  }, [open, fetchPeople]);

  if (!open) return null;

  const close = () => {
    setNewName('');
    setNewRole('associate');
    setAddError(null);
    onOpenChange(false);
  };

  const add = async (e) => {
    e.preventDefault();
    setAdding(true);
    setAddError(null);
    try {
      await addPerson({ name: newName, role: newRole });
      setNewName('');
    } catch (err) {
      setAddError(apiErrorMessage(err, 'Could not add the person.'));
    } finally {
      setAdding(false);
    }
  };

  return (
    <div
      className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4 backdrop-blur-sm"
      onClick={(e) => { if (e.target === e.currentTarget && !adding) close(); }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="people-title"
        className="w-full max-w-2xl max-h-[90vh] overflow-y-auto rounded-lg border bg-card p-6 shadow-2xl"
      >
        <h2 id="people-title" className="text-lg font-semibold">People</h2>
        <p className="mb-4 text-sm text-muted-foreground">
          Every client has one active partner as lead, and may have a second chair: anyone else who is active.
          Nobody is deleted; mark someone inactive once their clients have been reassigned.
        </p>

        {peopleError && <p role="alert" className="mb-4 text-sm text-red-500">{peopleError}</p>}

        <div className="space-y-4">
          {groupPeople(people).filter((g) => g.people.length > 0).map((group) => (
            <section key={group.key}>
              <h3 className="text-sm font-semibold">
                {group.label} <span className="font-normal text-muted-foreground">({group.people.length})</span>
              </h3>
              <ul className="divide-y">
                {group.people.map((person) => <PersonRow key={person.id} person={person} />)}
              </ul>
            </section>
          ))}
        </div>

        <form onSubmit={add} className="mt-6 space-y-2 border-t pt-4">
          <h3 className="text-sm font-semibold">Add a person</h3>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_12rem_auto] sm:items-end">
            <div>
              <Label htmlFor="new-person-name">Name</Label>
              <Input
                id="new-person-name"
                value={newName}
                disabled={adding}
                onChange={(e) => setNewName(e.target.value)}
                required
                className="mt-1"
              />
            </div>
            <div>
              <Label htmlFor="new-person-role">Role</Label>
              <div className="mt-1">
                <RoleSelect id="new-person-role" value={newRole} onChange={setNewRole} disabled={adding} />
              </div>
            </div>
            <Button type="submit" disabled={adding || !newName.trim()}>{adding ? 'Adding...' : 'Add'}</Button>
          </div>
          {addError && <p role="alert" className="text-sm text-red-500">{addError}</p>}
        </form>

        <div className="mt-6 flex justify-end">
          <Button variant="outline" onClick={close}>Close</Button>
        </div>
      </div>
    </div>
  );
}

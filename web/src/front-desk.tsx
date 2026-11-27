import { useEffect, useState, type FormEvent } from 'react';

import { api, displayPhone, errorMessage, memberNumber, RequestError, rupees } from './front-desk-api';
import { BillingRecovery, MemberBilling, pendingOperation, pendingStorageKey, type BillingMember } from './billing';
type Member = { memberNumber: number; fullName: string; phone: string };
type Directory = { members: Member[]; hasNext: boolean };
type Plan = {
  id: string; name: string; duration: number; durationUnit: 'MONTHS' | 'DAYS';
  pricePaise: number; active: boolean;
};
export function FrontDesk({ username, owner, busy, onLogout, message }: {
  username: string; owner: boolean; busy: boolean; onLogout: () => void; message: string;
}) {
  const [section, setSection] = useState<'members' | 'plans'>('members');
  const [billingMember, setBillingMember] = useState<BillingMember | null>(null);
  const [billingPending, setBillingPending] = useState(false);
  const storageKey = pendingStorageKey(username);
  const [recovery, setRecovery] = useState(() => pendingOperation(storageKey));
  const locked = billingPending || Boolean(recovery);

  function openSection(next: 'members' | 'plans') {
    setBillingMember(null);
    setSection(next);
  }
  return (
    <div className="workspace">
      <header className="workspace-header no-print">
        <div className="wordmark">Lion Gym</div>
        <div className="account-actions">
          <span>{username} · {owner ? 'Owner' : 'Staff'}</span>
          <button className="secondary" disabled={busy || billingPending} onClick={onLogout}>Sign out</button>
        </div>
      </header>
      <nav className="workspace-nav no-print" aria-label="Workspace">
        <button disabled={locked} aria-current={section === 'members' ? 'page' : undefined} onClick={() => openSection('members')}>Members</button>
        {owner && <button disabled={locked} aria-current={section === 'plans' ? 'page' : undefined} onClick={() => openSection('plans')}>Membership plans</button>}
      </nav>
      <main className="workspace-content">
        {message && <p role="alert">{message}</p>}
        {recovery ? <BillingRecovery operation={recovery} storageKey={storageKey} onClose={() => setRecovery(null)} />
          : billingMember ? <MemberBilling key={billingMember.memberNumber} member={billingMember} storageKey={storageKey} owner={owner}
            onPending={setBillingPending} onClose={() => setBillingMember(null)} />
          : section === 'members' ? <Members onBilling={setBillingMember} /> : owner && <Plans />}
      </main>
    </div>
  );
}

function Members({ onBilling }: { onBilling: (member: Member) => void }) {
  const [draft, setDraft] = useState('');
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(1);
  const [revision, setRevision] = useState(0);
  const [directory, setDirectory] = useState<Directory | null>(null);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState<Member | null>(null);
  const [registering, setRegistering] = useState(false);

  useEffect(() => {
    if (registering) return;
    const controller = new AbortController();
    setError('');
    setDirectory(null);
    void api<Directory>('members?' + new URLSearchParams({ q: query, page: String(page) }), undefined, controller.signal)
      .then((result) => { if (!controller.signal.aborted) setDirectory(result); })
      .catch((failure) => { if (!controller.signal.aborted) setError(errorMessage(failure)); });
    return () => controller.abort();
  }, [query, page, revision, registering]);

  if (registering) return <Registration onCancel={() => setRegistering(false)} onSaved={(member, addMembership) => {
    if (addMembership) {
      onBilling(member);
      return;
    }
    const number = memberNumber(member.memberNumber);
    setSaved(member);
    setDraft(number);
    setQuery(number);
    setPage(1);
    setRegistering(false);
  }} />;

  return (
    <>
      <div className="page-heading"><h1>Members</h1><button className="primary" onClick={() => {
        setSaved(null); setRegistering(true);
      }}>Add member</button></div>
      {saved && <p className="notice" role="status">{saved.fullName} saved as {memberNumber(saved.memberNumber)}.</p>}
      <form className="search-form" role="search" onSubmit={(event) => {
        event.preventDefault();
        setSaved(null);
        setQuery(draft.trim());
        setPage(1);
        setRevision((value) => value + 1);
      }}>
        <label className="visually-hidden" htmlFor="member-search">Search by name, phone or member number</label>
        <input id="member-search" type="search" placeholder="Search by name, phone or member number" maxLength={120}
          value={draft} onChange={(event) => setDraft(event.target.value)} />
        <button className="secondary" type="submit">Search</button>
      </form>
      <div className="panel directory">
        {error ? <p role="alert">{error} <button className="secondary" onClick={() => setRevision((value) => value + 1)}>Retry</button></p>
          : !directory ? <p role="status">Loading members…</p>
          : !directory.members.length ? <p>{query ? 'No members match this search.' : 'No members registered yet.'}</p>
          : <table>
              <thead><tr><th scope="col">Member</th><th scope="col">Member number</th><th scope="col">Mobile number</th><th scope="col">Billing</th></tr></thead>
              <tbody>{directory.members.map((member) => <tr key={member.memberNumber}>
                <td>{member.fullName}</td><td>{memberNumber(member.memberNumber)}</td><td>{displayPhone(member.phone)}</td>
                <td><button className="secondary" aria-label={'Membership and dues for ' + member.fullName}
                  onClick={() => onBilling(member)}>Open</button></td>
              </tr>)}</tbody>
            </table>}
      </div>
      {directory && (page > 1 || directory.hasNext) && <div className="pagination">
        <button className="secondary" disabled={page === 1} onClick={() => setPage(page - 1)}>Previous</button>
        <span>Page {page}</span>
        <button className="secondary" disabled={!directory.hasNext} onClick={() => setPage(page + 1)}>Next</button>
      </div>}
    </>
  );
}

function Registration({ onCancel, onSaved }: { onCancel: () => void; onSaved: (member: Member, addMembership: boolean) => void }) {
  const [duplicates, setDuplicates] = useState<Member[]>([]);
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = Object.fromEntries(new FormData(event.currentTarget));
    const addMembership = (event.nativeEvent as SubmitEvent).submitter?.getAttribute('value') === 'membership';
    setError('');
    setBusy(true);
    try {
      onSaved(await api<Member>('members', { method: 'POST', data: { ...data, confirmSharedPhone: confirmed } }), addMembership);
    } catch (failure) {
      if (failure instanceof RequestError && failure.problem.code === 'SHARED_PHONE' && failure.problem.existing?.length) {
        setDuplicates(failure.problem.existing);
        setConfirmed(false);
      } else setError(errorMessage(failure));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div className="page-heading"><h1>Register member</h1></div>
      <form className="panel editor" onSubmit={submit}>
        <fieldset disabled={busy}>
          <div className="field"><label htmlFor="fullName">Full name</label><input id="fullName" name="fullName" maxLength={120} required /></div>
          <div className="field"><label htmlFor="phone">Indian mobile number</label><input id="phone" name="phone" type="tel"
            placeholder="+91" maxLength={32} aria-describedby={duplicates.length ? 'shared-phone' : undefined} required
            onChange={() => { setDuplicates([]); setConfirmed(false); }} /></div>
          {!!duplicates.length && <div className="notice" id="shared-phone">
            <strong role="alert">This number is already registered.</strong>
            <ul>{duplicates.map((member) => <li key={member.memberNumber}>{member.fullName} · {memberNumber(member.memberNumber)}</li>)}</ul>
            <label className="checkbox"><input type="checkbox" checked={confirmed}
              onChange={(event) => setConfirmed(event.target.checked)} /> This is a shared family number</label>
          </div>}
          <details><summary>Optional details</summary><div className="optional-grid">
            <div className="field"><label htmlFor="dateOfBirth">Date of birth</label><input id="dateOfBirth" name="dateOfBirth" type="date" /></div>
            <div className="field"><label htmlFor="gender">Gender</label><input id="gender" name="gender" maxLength={50} /></div>
            <div className="field"><label htmlFor="address">Address</label><input id="address" name="address" maxLength={250} /></div>
            <div className="field"><label htmlFor="emergencyContact">Emergency contact</label><input id="emergencyContact" name="emergencyContact" maxLength={100} /></div>
            <div className="field"><label htmlFor="guardianName">Guardian name</label><input id="guardianName" name="guardianName" maxLength={120} /></div>
            <div className="field"><label htmlFor="guardianContact">Guardian contact</label><input id="guardianContact" name="guardianContact" maxLength={100} /></div>
          </div></details>
        </fieldset>
        {error && <p role="alert">{error}</p>}
        <div className="editor-actions">
          <button className="secondary" type="button" disabled={busy} onClick={onCancel}>Cancel</button>
          <button className="secondary" disabled={busy || (!!duplicates.length && !confirmed)}>Save member</button>
          <button className="primary" value="membership" disabled={busy || (!!duplicates.length && !confirmed)}>
            {busy ? 'Saving…' : 'Save and add membership'}
          </button>
        </div>
      </form>
    </>
  );
}

function Plans() {
  const [plans, setPlans] = useState<Plan[] | null>(null);
  const [editing, setEditing] = useState<Plan | 'new' | null>(null);
  const [revision, setRevision] = useState(0);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  useEffect(() => {
    const controller = new AbortController();
    setError('');
    void api<Plan[]>('plans', undefined, controller.signal)
      .then((result) => { if (!controller.signal.aborted) setPlans(result); })
      .catch((failure) => { if (!controller.signal.aborted) setError(errorMessage(failure)); });
    return () => controller.abort();
  }, [revision]);

  return <>
    <div className="page-heading"><h1>Membership plans</h1>{!editing && <button className="primary" onClick={() => {
      setMessage(''); setEditing('new');
    }}>Add plan</button>}</div>
    {message && <p className="notice" role="status">{message}</p>}
    {editing ? <PlanEditor plan={editing === 'new' ? undefined : editing} onCancel={() => setEditing(null)} onSaved={(saved) => {
      setEditing(null);
      setMessage(saved.name + ' saved.');
      setRevision((value) => value + 1);
    }} /> : <div className="panel directory">
      {error ? <p role="alert">{error} <button className="secondary" onClick={() => setRevision((value) => value + 1)}>Retry</button></p>
        : !plans ? <p role="status">Loading plans…</p>
        : !plans.length ? <p>No membership plans yet.</p>
        : <table>
            <thead><tr><th scope="col">Plan</th><th scope="col">Duration</th><th scope="col">Price</th><th scope="col">Status</th><th scope="col">Actions</th></tr></thead>
            <tbody>{plans.map((plan) => <tr key={plan.id}>
              <td>{plan.name}</td><td>{plan.duration} {plan.durationUnit === 'MONTHS' ? 'mo.' : 'day(s)'}</td>
              <td>{rupees.format(plan.pricePaise / 100)}</td><td>{plan.active ? 'Active' : 'Inactive'}</td>
              <td><button className="secondary" aria-label={'Edit ' + plan.name} onClick={() => {
                setMessage(''); setEditing(plan);
              }}>Edit</button></td>
            </tr>)}</tbody>
          </table>}
    </div>}
  </>;
}

function PlanEditor({ plan, onCancel, onSaved }: { plan?: Plan; onCancel: () => void; onSaved: (plan: Plan) => void }) {
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const price = String(form.get('price')).trim();
    if (!/^\d+(?:\.\d{1,2})?$/.test(price)) {
      setError('Enter an INR amount with up to two decimal places.');
      return;
    }
    const [whole, fraction = ''] = price.split('.');
    const pricePaise = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
    setBusy(true);
    setError('');
    try {
      onSaved(await api<Plan>(plan ? 'plans/' + plan.id : 'plans', {
        method: plan ? 'PATCH' : 'POST',
        data: {
          name: form.get('name'), duration: Number(form.get('duration')),
          durationUnit: form.get('durationUnit'), pricePaise, active: form.has('active'),
        },
      }));
    } catch (failure) {
      setError(errorMessage(failure));
    } finally {
      setBusy(false);
    }
  }

  return <form className="panel editor" onSubmit={submit}>
    <h2>{plan ? 'Edit plan' : 'New plan'}</h2>
    <fieldset disabled={busy}>
      <div className="field"><label htmlFor="plan-name">Plan name</label><input id="plan-name" name="name" defaultValue={plan?.name} maxLength={100} required /></div>
      <div className="optional-grid">
        <div className="field"><label htmlFor="duration">Duration</label><input id="duration" name="duration" type="number" min={1} max={2147483647}
          step={1} defaultValue={plan?.duration ?? 1} required /></div>
        <div className="field"><label htmlFor="durationUnit">Duration unit</label><select id="durationUnit" name="durationUnit" defaultValue={plan?.durationUnit ?? 'MONTHS'}>
          <option value="MONTHS">Calendar months</option><option value="DAYS">Days</option>
        </select></div>
      </div>
      <div className="field"><label htmlFor="price">Price (₹)</label><input id="price" name="price" inputMode="decimal" maxLength={12}
        defaultValue={plan ? (plan.pricePaise / 100).toFixed(2) : undefined} required /></div>
      <label className="checkbox"><input type="checkbox" name="active" defaultChecked={plan?.active ?? true} /> Active plan</label>
    </fieldset>
    {error && <p role="alert">{error}</p>}
    <div className="editor-actions">
      <button type="button" className="secondary" disabled={busy} onClick={onCancel}>Cancel</button>
      <button className="primary" disabled={busy}>{busy ? 'Saving…' : 'Save plan'}</button>
    </div>
  </form>;
}


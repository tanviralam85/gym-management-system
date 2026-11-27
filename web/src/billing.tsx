import { useEffect, useRef, useState, type FormEvent } from 'react';
import { api, errorMessage, memberNumber, RequestError, rupees } from './front-desk-api';
import { adjustmentLabels, OwnerAdjustments } from './owner-adjustments';

export type BillingMember = { memberNumber: number; fullName: string };
type Method = 'CASH' | 'UPI';
type Input = { planId: string | null; amountPaise: number; method: Method; dueDate: string | null; reference: string | null };
type Term = { planName: string; pricePaise: number; startsOn: string; expiresOn: string };
type Allocation = { label: string; amountPaise: number };
type Summary = {
  today: string; balancePaise: number;
  charges: { id: number; label: string; dueDate: string | null; balancePaise: number }[];
  plans: { id: string; name: string; pricePaise: number }[];
  purchases: (Term & { id: string })[];
  receipts: { receiptNumber: number; amountPaise: number; method: Method; businessDate: string; supersededBy: number | null }[];
};
type Receipt = {
  receiptNumber: number; memberNumber: number; memberName: string; actor: string;
  amountPaise: number; balancePaise: number; method: Method; reference: string | null;
  businessDate: string; recordedAt: string; allocations: Allocation[];
  supersededBy?: number | null; replaces?: number | null;
  refunds?: (Allocation & { method: Method; reference: string | null; businessDate: string; kind: keyof typeof adjustmentLabels })[];
};
type Review = {
  token: string; memberName: string; actor: string; today: string; purchase: Term | null;
  dueDate: string | null; priorPaise: number; amountPaise: number; balancePaise: number;
  method: Method; reference: string | null; allocations: Allocation[];
};
export type Result = { receipt: Receipt | null; balancePaise: number; purchase: Term | null;
  adjustmentKind?: keyof typeof adjustmentLabels; refundPaise?: number };

const dayFormat = new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium', timeZone: 'UTC' });
const recordedFormat = new Intl.DateTimeFormat('en-IN', {
  dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Kolkata',
});
const money = (paise: number) => rupees.format(paise / 100);
const dateLabel = (value: string) => dayFormat.format(new Date(value));
const methodLabel = (method: Method) => method === 'CASH' ? 'Cash' : 'UPI';
const receiptLabel = (number: number) => 'R-' + String(number).padStart(6, '0');
export const pendingStorageKey = (username: string) => 'lion-gym.pending-billing.' + username;

export function pendingOperation(storageKey: string) {
  try { return sessionStorage.getItem(storageKey); } catch { return null; }
}

function rememberOperation(storageKey: string, value: string | null) {
  try {
    if (value) sessionStorage.setItem(storageKey, value);
    else sessionStorage.removeItem(storageKey);
  } catch {
    // The in-memory retry remains available if browser storage is unavailable.
  }
}

function TermDetails({ purchase }: { purchase: Term }) {
  return <p><strong>{purchase.planName}</strong> · {dateLabel(purchase.startsOn)} to {dateLabel(purchase.expiresOn)} (inclusive)</p>;
}

function ReceiptView({ receipt, onClose, onOpen }: { receipt: Receipt; onClose: () => void; onOpen?: (number: number) => void }) {
  return <section className="panel editor receipt">
    <div className="wordmark">Lion Gym</div>
    <h2>Payment receipt {receiptLabel(receipt.receiptNumber)}</h2>
    <p>{receipt.memberName} · {memberNumber(receipt.memberNumber)}</p>
    {receipt.supersededBy && <p className="notice"><strong>Superseded</strong> · Replacement {receiptLabel(receipt.supersededBy)}
      {onOpen && <button className="secondary no-print" onClick={() => onOpen(receipt.supersededBy!)}>Open replacement</button>}</p>}
    {receipt.replaces && <p>Replaces {receiptLabel(receipt.replaces)}
      {onOpen && <button className="secondary no-print" onClick={() => onOpen(receipt.replaces!)}>Open original</button>}</p>}
    <dl className="billing-lines">
      <div><dt>Amount received</dt><dd>{money(receipt.amountPaise)}</dd></div>
      <div><dt>Method</dt><dd>{methodLabel(receipt.method)}</dd></div>
      {receipt.reference && <div><dt>Payment reference</dt><dd>{receipt.reference}</dd></div>}
      <div><dt>Business date</dt><dd>{dateLabel(receipt.businessDate)}</dd></div>
      <div><dt>Recorded at (IST)</dt><dd>{recordedFormat.format(new Date(receipt.recordedAt))}</dd></div>
      <div><dt>Recorded by</dt><dd>{receipt.actor}</dd></div>
      {receipt.allocations.map((allocation, index) => <div key={index}>
        <dt>Applied to {allocation.label}</dt><dd>{money(allocation.amountPaise)}</dd>
      </div>)}
      <div className="billing-total"><dt>Balance after this payment</dt><dd>{money(receipt.balancePaise)}</dd></div>
    </dl>
    {!!receipt.refunds?.length && <><h3>Refund history</h3><ul className="adjustment-history">
      {receipt.refunds.map((refund, index) => <li key={index}>
        {money(refund.amountPaise)} · {methodLabel(refund.method)} · {dateLabel(refund.businessDate)} · {refund.label}
        {refund.kind === 'CANCELLATION' && ' · Queued cancellation'}{refund.reference && ' · ' + refund.reference}
      </li>)}
    </ul></>}
    <div className="editor-actions no-print">
      <button className="secondary" onClick={onClose}>Done</button>
      <button className="primary" onClick={() => window.print()}>Print receipt</button>
    </div>
  </section>;
}

function SavedBilling({ result, onClose }: { result: Result; onClose: () => void }) {
  return <>
    <div className="notice no-print" role="status">
      <strong>{result.adjustmentKind ? adjustmentLabels[result.adjustmentKind] + ' saved.'
        : result.receipt ? 'Payment recorded.' : 'Membership saved.'}</strong>
      {result.purchase && <TermDetails purchase={result.purchase} />}
      {!!result.refundPaise && <p>Returned: <strong>{money(result.refundPaise)}</strong></p>}
      <p>Remaining dues after this transaction: <strong>{money(result.balancePaise)}</strong></p>
    </div>
    {result.receipt ? <ReceiptView receipt={result.receipt} onClose={onClose} />
      : <button className="secondary" onClick={onClose}>Done</button>}
  </>;
}

async function resolveOperation(storageKey: string, key: string) {
  const outcome = await api<Result | { abandoned: true }>('billing/operations/' + key + '/resolve',
    { method: 'POST', data: {} }, AbortSignal.timeout(25_000));
  rememberOperation(storageKey, null);
  return outcome;
}

export function BillingRecovery({ storageKey, operation, onClose }: {
  storageKey: string; operation: string; onClose: () => void;
}) {
  const [result, setResult] = useState<Result | null>(null);
  const [closed, setClosed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function resolve() {
    setBusy(true);
    setError('');
    try {
      const outcome = await resolveOperation(storageKey, operation);
      if ('abandoned' in outcome) setClosed(true);
      else setResult(outcome);
    } catch {
      setError('Could not check the previous attempt. Try again before entering another payment.');
    } finally {
      setBusy(false);
    }
  }
  if (result) return <SavedBilling result={result} onClose={onClose} />;
  return <section className="panel editor">
    <h1>{closed ? 'Previous attempt closed' : 'Check previous payment attempt'}</h1>
    <p>{closed ? 'The previous attempt did not save. You can start again.'
      : 'Check the previous attempt before starting another. If it was saved, the original result will open. If it was not saved, this action closes the attempt so it cannot post later.'}</p>
    {error && <p role="alert">{error}</p>}
    <button className="primary" disabled={busy} onClick={closed ? onClose : resolve}>
      {closed ? 'Back to members' : busy ? 'Checking…' : 'Check and resolve attempt'}
    </button>
  </section>;
}

export function MemberBilling({ member, storageKey, owner, onClose, onPending }: {
  member: BillingMember; storageKey: string; owner: boolean; onClose: () => void; onPending: (pending: boolean) => void;
}) {
  const [summary, setSummary] = useState<Summary | null>(null);
  const [revision, setRevision] = useState(0);
  const [mode, setMode] = useState<'purchase' | 'collection'>('purchase');
  const [draft, setDraft] = useState({ planId: '', amount: '', method: 'CASH' as Method, dueDate: '', reference: '' });
  const [review, setReview] = useState<{ input: Input; preview: Review; key: string } | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const [existingReceipt, setExistingReceipt] = useState<Receipt | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const [adjusting, setAdjusting] = useState(false);
  const inFlight = useRef(false);
  const path = 'billing/members/' + member.memberNumber;

  useEffect(() => {
    const controller = new AbortController();
    void api<Summary>(path, undefined, controller.signal)
      .then((value) => { if (!controller.signal.aborted) setSummary(value); })
      .catch((failure) => { if (!controller.signal.aborted) setError(errorMessage(failure)); });
    return () => controller.abort();
  }, [path, revision]);

  const selected = summary?.plans.find((plan) => plan.id === draft.planId);
  const amountText = draft.amount.trim() || '0';
  const [whole, fraction = ''] = amountText.split('.');
  const amountPaise = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
  const dueRequired = Boolean(mode === 'purchase' && selected && summary &&
    selected.pricePaise > Math.max(0, amountPaise - summary.balancePaise));

  async function preview(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!/^\d+(?:\.\d{1,2})?$/.test(amountText)) {
      setError('Enter an INR amount with up to two decimal places.');
      return;
    }
    const input = { planId: mode === 'purchase' ? draft.planId : null, amountPaise,
      dueDate: dueRequired ? draft.dueDate : null, method: draft.method,
      reference: amountPaise > 0 && draft.method === 'UPI' ? draft.reference.trim() || null : null };
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const response = await api<Review>(path + '/preview', { method: 'POST', data: input }, AbortSignal.timeout(10_000));
      setReview({ input, preview: response, key: crypto.randomUUID() });
    } catch (failure) {
      setError(errorMessage(failure));
      setRevision((value) => value + 1);
    } finally { setBusy(false); }
  }

  function settle(outcome: Result | { abandoned: true }) {
    rememberOperation(storageKey, null);
    onPending(false);
    setUncertain(false);
    setReview(null);
    setError('');
    setRevision((value) => value + 1);
    if ('abandoned' in outcome) setNotice('The previous attempt did not save. Review the details to start again.');
    else {
      setDraft({ planId: '', amount: '', method: 'CASH', dueDate: '', reference: '' });
      setResult(outcome);
    }
  }

  async function confirm() {
    if (!review || inFlight.current) return;
    inFlight.current = true;
    rememberOperation(storageKey, review.key);
    onPending(true);
    setBusy(true);
    setError('');
    try {
      const response = await api<Result>(path + '/confirm', { method: 'POST',
        data: { ...review.input, key: review.key, token: review.preview.token } }, AbortSignal.timeout(20_000));
      settle(response);
    } catch (failure) {
      if (failure instanceof RequestError && failure.status === 409) {
        rememberOperation(storageKey, null);
        onPending(false);
        setUncertain(false);
        setReview(null);
        setError(failure.message);
        setRevision((value) => value + 1);
      } else {
        setUncertain(true);
        setError(failure instanceof RequestError && failure.status === 401
          ? 'Your session expired. Sign in again in another tab, then use Retry here.'
          : 'Save status is unknown. Retry this same request or check the attempt before starting again.');
      }
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  async function resolve() {
    if (!review || inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError('');
    try { settle(await resolveOperation(storageKey, review.key)); }
    catch { setError('Could not check the attempt. Try again before entering another payment.'); }
    finally { inFlight.current = false; setBusy(false); }
  }

  async function openReceipt(number: number) {
    setBusy(true);
    setError('');
    try { setExistingReceipt(await api<Receipt>('billing/receipts/' + number)); }
    catch (failure) { setError(errorMessage(failure)); }
    finally { setBusy(false); }
  }

  if (result) return <SavedBilling result={result} onClose={() => setResult(null)} />;
  if (existingReceipt) return <>
    {error && <p className="notice" role="alert">{error}</p>}
    <ReceiptView receipt={existingReceipt} onClose={() => setExistingReceipt(null)} onOpen={openReceipt} />
  </>;
  if (adjusting && owner && summary) return <OwnerAdjustments memberNumber={member.memberNumber}
    today={summary.today} queued={summary.purchases.filter((purchase) => purchase.startsOn > summary.today)}
    onBack={() => setAdjusting(false)} onPending={onPending}
    remember={(key) => rememberOperation(storageKey, key)} resolve={(key) => resolveOperation(storageKey, key)}
    onSaved={(adjustment) => {
      setAdjusting(false);
      setError('');
      setRevision((value) => value + 1);
      setResult(adjustment);
    }} />;
  return <>
    <div className="page-heading">
      <div><h1>{review ? (review.preview.amountPaise ? 'Confirm payment' : 'Confirm membership') : 'Membership and dues'}</h1>
        <p>{member.fullName} · {memberNumber(member.memberNumber)}</p></div>
      <div className="editor-actions">
        {owner && summary && !review && <button className="primary" onClick={() => setAdjusting(true)}>Owner adjustments</button>}
        <button className="secondary" disabled={busy || uncertain} onClick={onClose}>Back to members</button>
      </div>
    </div>
    {error && <p className="notice" role="alert">{error}</p>}
    {notice && <p className="notice" role="status">{notice}</p>}
    {review ? <>
      <div className="billing-grid">
        <section className="panel editor">
          <h2>{review.preview.purchase ? 'Membership' : 'Collection'}</h2>
          {review.preview.purchase && <TermDetails purchase={review.preview.purchase} />}
          <p>{dateLabel(review.preview.today)} · Recorded by {review.preview.actor}</p>
          {!!review.preview.amountPaise && <p>{methodLabel(review.preview.method)}{review.preview.reference && ' · ' + review.preview.reference}</p>}
          {review.preview.allocations.length > 0 && <dl className="billing-lines">
            {review.preview.allocations.map((allocation, index) => <div key={index}>
              <dt>Applied to {allocation.label}</dt><dd>{money(allocation.amountPaise)}</dd>
            </div>)}
          </dl>}
        </section>
        <section className="panel editor">
          <h2>Balance summary</h2>
          <dl className="billing-lines">
            <div><dt>Prior dues</dt><dd>{money(review.preview.priorPaise)}</dd></div>
            {review.preview.purchase && <div><dt>New plan charge</dt><dd>{money(review.preview.purchase.pricePaise)}</dd></div>}
            <div><dt>Amount received</dt><dd>{money(review.preview.amountPaise)}</dd></div>
            <div className="billing-total"><dt>Remaining dues</dt><dd>{money(review.preview.balancePaise)}</dd></div>
            {review.preview.dueDate && <div><dt>New plan due date</dt><dd>{dateLabel(review.preview.dueDate)}</dd></div>}
          </dl>
        </section>
      </div>
      <div className="editor-actions billing-actions">
        {uncertain ? <button className="secondary" disabled={busy} onClick={resolve}>Check and resolve attempt</button>
          : <button className="secondary" disabled={busy} onClick={() => { setReview(null); setError(''); }}>Edit details</button>}
        <button className="primary" disabled={busy} onClick={confirm}>{busy ? 'Checking…' : uncertain ? 'Retry same request'
          : review.preview.amountPaise ? 'Record ' + money(review.preview.amountPaise) + ' payment' : 'Save membership'}</button>
      </div>
    </> : !summary ? error
      ? <button className="secondary" onClick={() => { setError(''); setRevision((value) => value + 1); }}>Retry</button>
      : <p role="status">Loading member balance…</p>
      : <div className="billing-grid">
        <form className="panel editor" onSubmit={preview}>
          <fieldset disabled={busy}>
            <div className="field"><label htmlFor="billing-mode">Transaction</label>
              <select id="billing-mode" value={mode} onChange={(event) => setMode(event.target.value === 'purchase' ? 'purchase' : 'collection')}>
                <option value="purchase">Buy or renew membership</option>
                <option value="collection">Collect existing dues</option>
              </select></div>
            {mode === 'purchase' && <div className="field"><label htmlFor="billing-plan">Membership plan</label>
              <select id="billing-plan" required value={draft.planId} onChange={(event) => setDraft({ ...draft, planId: event.target.value })}>
                <option value="">Choose a plan</option>
                {summary.plans.map((plan) => <option key={plan.id} value={plan.id}>{plan.name} · {money(plan.pricePaise)}</option>)}
              </select>
              {!summary.plans.length && <small>An Owner needs to add an active membership plan.</small>}
            </div>}
            <div className="field"><label htmlFor="billing-amount">Amount received (₹)</label>
              <input id="billing-amount" inputMode="decimal" maxLength={12} required={mode === 'collection'}
                placeholder="0.00" value={draft.amount} onChange={(event) => setDraft({ ...draft, amount: event.target.value })} /></div>
            <div className="field"><label htmlFor="billing-method">Payment method</label>
              <select id="billing-method" value={draft.method} onChange={(event) => setDraft({ ...draft, method: event.target.value === 'UPI' ? 'UPI' : 'CASH' })}>
                <option value="CASH">Cash</option><option value="UPI">UPI already received</option>
              </select></div>
            {draft.method === 'UPI' && <div className="field"><label htmlFor="billing-reference">UPI reference (optional)</label>
              <input id="billing-reference" maxLength={100} value={draft.reference} onChange={(event) => setDraft({ ...draft, reference: event.target.value })} /></div>}
            {dueRequired && <div className="field"><label htmlFor="billing-due">New plan due date</label>
              <input id="billing-due" type="date" min={summary.today} required value={draft.dueDate}
                onChange={(event) => setDraft({ ...draft, dueDate: event.target.value })} /></div>}
          </fieldset>
          <div className="editor-actions"><button className="primary" disabled={busy ||
            (mode === 'purchase' ? !summary.plans.length : !summary.balancePaise)}>{busy ? 'Checking…' : 'Review transaction'}</button></div>
        </form>
        <div className="billing-aside">
          <section className="panel editor">
            <h2>Current balance</h2>
            <dl className="billing-lines">
              {summary.charges.map((charge) => <div key={charge.id}><dt>{charge.label}
                {charge.dueDate && <small> · Due {dateLabel(charge.dueDate)}</small>}</dt><dd>{money(charge.balancePaise)}</dd></div>)}
              <div className="billing-total"><dt>Outstanding dues</dt><dd>{money(summary.balancePaise)}</dd></div>
            </dl>
            {summary.purchases.map((purchase) => <TermDetails key={purchase.startsOn} purchase={purchase} />)}
          </section>
          {summary.receipts.length > 0 && <section className="panel editor">
            <h2>Recent receipts</h2>
            <ul className="receipt-list">{summary.receipts.map((receipt) => <li key={receipt.receiptNumber}>
              <button className="secondary" disabled={busy} onClick={() => openReceipt(receipt.receiptNumber)}>{receiptLabel(receipt.receiptNumber)}</button>
              <span>{money(receipt.amountPaise)} · {methodLabel(receipt.method)} · {dateLabel(receipt.businessDate)}
                {receipt.supersededBy && ' · Superseded'}</span>
            </li>)}</ul>
          </section>}
        </div>
      </div>}
  </>;
}

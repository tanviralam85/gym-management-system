import { useEffect, useRef, useState, type FormEvent } from 'react';
import { api, errorMessage, RequestError, rupees } from './front-desk-api';
import type { Result } from './billing';

export const adjustmentLabels = {
  CORRECTION: 'Payment correction', BACKDATE: 'Backdated payment',
  REFUND: 'Refund', CANCELLATION: 'Queued cancellation',
};
type Kind = keyof typeof adjustmentLabels;
type Method = 'CASH' | 'UPI';
type PaymentOption = {
  receiptNumber: number; amountPaise: number; method: Method; correctable: boolean; businessOn: string;
  allocations: { chargeId: number; label: string; refundablePaise: number }[];
};
type ReturnLine = { receiptNumber: number; amountPaise: number; returnMethod: Method | null };
type History = {
  id: string; kind: Kind; reason: string; owner: string; businessOn: string; recordedAt: string;
  originalReceiptNumber: number | null; replacementReceiptNumber: number | null; backdatedReceiptNumber: number | null;
  canceledPlan?: string; returns: ReturnLine[];
};
type Review = {
  kind: Kind; owner: string; today: string; reason: string; balanceBefore: number; balanceAfter: number; refundPaise: number;
  original: { receiptNumber: number; amountPaise: number; businessOn: string; actor: string } | null;
  cancellation: { planName: string; startsOn: string; expiresOn: string; chargePaise: number } | null;
  newPayment: { amountPaise: number; businessOn: string; actorUsername: string; method: Method;
    allocations: { chargeId: number; label: string; amountPaise: number }[] } | null;
  reversals: (ReturnLine & { chargeId: number; label: string })[];
};
const money = (paise: number) => rupees.format(paise / 100);
const receiptLabel = (number: number) => 'R-' + String(number).padStart(6, '0');
const methodLabel = (method: Method) => method === 'CASH' ? 'cash' : 'UPI';
const dateFormat = new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium', timeZone: 'UTC' });
const dateLabel = (value: string) => dateFormat.format(new Date(value));

export function OwnerAdjustments({ memberNumber, today, queued, onBack, onSaved, onPending, remember, resolve }: {
  memberNumber: number; today: string; queued: { id: string; planName: string; startsOn: string }[];
  onBack: () => void; onSaved: (result: Result) => void; onPending: (pending: boolean) => void;
  remember: (key: string | null) => void; resolve: (key: string) => Promise<Result | { abandoned: true }>;
}) {
  const path = 'billing/owner/members/' + memberNumber;
  const [options, setOptions] = useState<{ payments: PaymentOption[]; history: History[] } | null>(null);
  const [kind, setKind] = useState<Kind>('CORRECTION');
  const [receiptNumber, setReceiptNumber] = useState('');
  const [amount, setAmount] = useState('');
  const [chargeId, setChargeId] = useState('');
  const [method, setMethod] = useState<Method>('CASH');
  const [date, setDate] = useState('');
  const [purchaseId, setPurchaseId] = useState('');
  const [reason, setReason] = useState('');
  const [reference, setReference] = useState('');
  const [pending, setPending] = useState<{ input: object; review: Review; token: string; key: string } | null>(null);
  const [confirmReturn, setConfirmReturn] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const [revision, setRevision] = useState(0);
  const inFlight = useRef(false);
  const yesterday = new Date(Date.parse(today) - 86_400_000).toISOString().slice(0, 10);
  const payments = options?.payments.filter((payment) => kind === 'CORRECTION' ? payment.correctable : payment.allocations.length > 0) ?? [];
  const selected = payments.find((payment) => payment.receiptNumber === Number(receiptNumber));

  useEffect(() => {
    const controller = new AbortController();
    void api<{ payments: PaymentOption[]; history: History[] }>(path, undefined, controller.signal)
      .then((data) => { if (!controller.signal.aborted) setOptions(data); })
      .catch((failure) => { if (!controller.signal.aborted) setError(errorMessage(failure)); });
    return () => controller.abort();
  }, [path, revision]);

  async function preview(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const value = amount.trim();
    if (kind !== 'CANCELLATION' && !/^\d+(?:\.\d{1,2})?$/.test(value)) {
      setError('Enter an INR amount with up to two decimal places.');
      return;
    }
    const [whole, fraction = ''] = value.split('.');
    const amountPaise = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
    const input = { kind, reason, reference: reference || null, amountPaise, method,
      receiptNumber: Number(receiptNumber), chargeId: Number(chargeId), businessOn: date, purchaseId };
    setBusy(true);
    setError('');
    try {
      const result = await api<{ review: Review; token: string }>(path + '/preview',
        { method: 'POST', data: input }, AbortSignal.timeout(10_000));
      setPending({ ...result, input, key: crypto.randomUUID() });
      setConfirmReturn(false);
    } catch (failure) { setError(errorMessage(failure)); }
    finally { setBusy(false); }
  }

  function closeAttempt() {
    remember(null);
    onPending(false);
    setUncertain(false);
    setPending(null);
  }

  async function confirm(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!pending || inFlight.current) return;
    const field = event.currentTarget.elements.namedItem('ownerPassword') as HTMLInputElement;
    const password = field.value;
    field.value = '';
    inFlight.current = true;
    remember(pending.key);
    onPending(true);
    setBusy(true);
    setError('');
    try {
      const result = await api<Result>(path + '/confirm', { method: 'POST',
        data: { ...pending.input, token: pending.token, key: pending.key, confirmedReturn: confirmReturn, password },
      }, AbortSignal.timeout(20_000));
      closeAttempt();
      onSaved(result);
    } catch (failure) {
      if (failure instanceof RequestError && failure.status === 409) {
        closeAttempt();
        setOptions(null);
        setRevision((value) => value + 1);
        setError(failure.message);
      } else if (failure instanceof RequestError && [400, 401, 403, 429].includes(failure.status)) {
        if (!uncertain) {
          remember(null);
          onPending(false);
        }
        setError(failure.status === 429 ? 'Too many attempts. Wait a minute and try again.' : failure.message);
      } else {
        setUncertain(true);
        setError('Save status is unknown. Retry this same adjustment or check the attempt before continuing.');
      }
    } finally { inFlight.current = false; setBusy(false); }
  }

  async function check() {
    if (!pending || inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError('');
    try {
      const result = await resolve(pending.key);
      closeAttempt();
      if ('abandoned' in result) setError('The previous attempt did not save. Review it again before confirming.');
      else onSaved(result);
    } catch { setError('Could not check the previous attempt. Try again.'); }
    finally { inFlight.current = false; setBusy(false); }
  }

  const review = pending?.review;
  return <>
    <div className="page-heading"><h1>Owner adjustments</h1>
      <button className="secondary" disabled={busy || uncertain} onClick={onBack}>Back to dues</button>
    </div>
    {error && <p className="notice" role="alert">{error}</p>}
    {review ? <>
      <div className="billing-grid">
        <section className="panel editor">
          <h2>{adjustmentLabels[review.kind]}</h2>
          <p>{review.reason}</p>
          {review.original && <p>Original {receiptLabel(review.original.receiptNumber)} · {money(review.original.amountPaise)} · {dateLabel(review.original.businessOn)}</p>}
          {review.cancellation && <p>Cancel {review.cancellation.planName}, {dateLabel(review.cancellation.startsOn)} to {dateLabel(review.cancellation.expiresOn)}. Remove the {money(review.cancellation.chargePaise)} plan charge.</p>}
          {review.newPayment && <><p>{money(review.newPayment.amountPaise)} · {methodLabel(review.newPayment.method)} · effective {dateLabel(review.newPayment.businessOn)} · collector {review.newPayment.actorUsername}</p>
            <ul>{review.newPayment.allocations.map((line) => <li key={line.chargeId}>
              Apply {money(line.amountPaise)} to {line.label}</li>)}</ul></>}
          {review.reversals.length > 0 && <ul>{review.reversals.map((line) => <li key={line.receiptNumber + ':' + line.chargeId}>
            {line.returnMethod ? 'Return' : 'Reverse'} {money(line.amountPaise)} from {receiptLabel(line.receiptNumber)} · {line.label}
            {line.returnMethod && ' · ' + methodLabel(line.returnMethod)}
          </li>)}</ul>}
          {review.kind === 'CORRECTION' && <p>The correction records no cash movement.</p>}
        </section>
        <section className="panel editor">
          <h2>Balance summary</h2>
          <dl className="billing-lines">
            <div><dt>Before adjustment</dt><dd>{money(review.balanceBefore)}</dd></div>
            {review.refundPaise > 0 && <div><dt>Money actually returned</dt><dd>{money(review.refundPaise)}</dd></div>}
            <div className="billing-total"><dt>Dues after adjustment</dt><dd>{money(review.balanceAfter)}</dd></div>
          </dl>
          <p>Confirmed by {review.owner} · {dateLabel(review.today)}</p>
        </section>
      </div>
      <form className="panel editor adjustment-confirm" onSubmit={confirm}>
        <fieldset disabled={busy}>
          {review.refundPaise > 0 && <label className="checkbox">
            <input type="checkbox" required checked={confirmReturn} disabled={uncertain}
              onChange={(event) => setConfirmReturn(event.target.checked)} />
            I have already returned the amounts shown above.
          </label>}
          <div className="field"><label htmlFor="owner-password">Confirm with your Owner password</label>
            <input id="owner-password" name="ownerPassword" type="password" autoComplete="current-password" maxLength={128} required /></div>
        </fieldset>
        <div className="editor-actions">
          {uncertain ? <button type="button" className="secondary" disabled={busy} onClick={check}>Check and resolve attempt</button>
            : <button type="button" className="secondary" disabled={busy} onClick={() => { setPending(null); setError(''); }}>Edit details</button>}
          <button className="primary" disabled={busy}>{busy ? 'Checking…' : uncertain ? 'Retry same adjustment' : 'Confirm adjustment'}</button>
        </div>
      </form>
    </> : !options ? error
      ? <button className="secondary" onClick={() => { setError(''); setRevision((value) => value + 1); }}>Retry</button>
      : <p role="status">Loading adjustments…</p>
      : <div className="billing-grid">
        <form className="panel editor" onSubmit={preview}>
          <fieldset disabled={busy}>
            <div className="field"><label htmlFor="adjustment-kind">Adjustment type</label>
              <select id="adjustment-kind" value={kind} onChange={(event) => {
                setKind(event.target.value as Kind); setReceiptNumber(''); setChargeId(''); setAmount('');
                setMethod('CASH'); setReference(''); setError('');
              }}>
                {Object.entries(adjustmentLabels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
              </select></div>
            {(kind === 'CORRECTION' || kind === 'REFUND') && <div className="field"><label htmlFor="adjustment-receipt">Original receipt</label>
              <select id="adjustment-receipt" required value={receiptNumber} onChange={(event) => {
                setReceiptNumber(event.target.value); setChargeId(''); setAmount('');
                const payment = payments.find((line) => line.receiptNumber === Number(event.target.value));
                if (payment) setMethod(payment.method);
              }}>
                <option value="">Choose a receipt</option>
                {payments.map((p) => <option key={p.receiptNumber} value={p.receiptNumber}>
                  {receiptLabel(p.receiptNumber)} · {money(p.amountPaise)} · {dateLabel(p.businessOn)}</option>)}
              </select>
              {!payments.length && <small>No eligible receipts.</small>}</div>}
            {kind === 'REFUND' && <div className="field"><label htmlFor="refund-charge">Charge to refund</label>
              <select id="refund-charge" required value={chargeId} onChange={(event) => setChargeId(event.target.value)}>
                <option value="">Choose a charge</option>
                {selected?.allocations.map((row) => <option key={row.chargeId} value={row.chargeId}>
                  {row.label} · up to {money(row.refundablePaise)}</option>)}
              </select></div>}
            {kind === 'CANCELLATION' ? <div className="field"><label htmlFor="cancel-purchase">Queued membership</label>
              <select id="cancel-purchase" required value={purchaseId} onChange={(event) => setPurchaseId(event.target.value)}>
                <option value="">Choose a queued membership</option>
                {queued.map((p) => <option key={p.id} value={p.id}>{p.planName} · starts {dateLabel(p.startsOn)}</option>)}
              </select>
              {!queued.length && <small>This member has no queued membership.</small>}</div>
              : <div className="field"><label htmlFor="adjustment-amount">{kind === 'CORRECTION' ? 'Correct amount (₹)' : kind === 'REFUND' ? 'Amount returned (₹)' : 'Amount received (₹)'}</label>
                <input id="adjustment-amount" required maxLength={12} inputMode="decimal" value={amount}
                  onChange={(event) => setAmount(event.target.value)} /></div>}
            {kind === 'BACKDATE' && <div className="field"><label htmlFor="adjustment-date">Date payment was received</label>
              <input id="adjustment-date" required type="date" max={yesterday} value={date} onChange={(event) => setDate(event.target.value)} /></div>}
            {(kind === 'REFUND' || kind === 'BACKDATE') && <div className="field"><label htmlFor="adjustment-method">{kind === 'REFUND' ? 'Return method' : 'Payment method'}</label>
              <select id="adjustment-method" value={method} onChange={(event) => setMethod(event.target.value as Method)}>
                <option value="CASH">Cash</option><option value="UPI">UPI</option>
              </select></div>}
            <div className="field"><label htmlFor="adjustment-reference">Reference (optional)</label>
              <input id="adjustment-reference" maxLength={100} value={reference} onChange={(event) => setReference(event.target.value)} /></div>
            <div className="field"><label htmlFor="adjustment-reason">Reason</label>
              <input id="adjustment-reason" required maxLength={500} value={reason} onChange={(event) => setReason(event.target.value)} /></div>
          </fieldset>
          <div className="editor-actions"><button className="primary" disabled={busy}>{busy ? 'Checking…' : 'Review adjustment'}</button></div>
        </form>
        <section className="panel editor">
          <h2>Adjustment history</h2>
          {options.history.length === 0 ? <p>No adjustments recorded.</p> : <ul className="adjustment-history">
            {options.history.map((row) => <li key={row.id}>
              <strong>{adjustmentLabels[row.kind]}</strong> · {dateLabel(row.businessOn)} · {row.owner}
              <p>{row.reason}</p>
              {row.originalReceiptNumber && row.replacementReceiptNumber && <p>{receiptLabel(row.originalReceiptNumber)} → {receiptLabel(row.replacementReceiptNumber)}</p>}
              {row.backdatedReceiptNumber && <p>{receiptLabel(row.backdatedReceiptNumber)}</p>}
              {row.canceledPlan && <p>{row.canceledPlan}</p>}
              {row.returns.map((line, index) => <p key={index}>{money(line.amountPaise)} returned from {receiptLabel(line.receiptNumber)}{line.returnMethod && ' · ' + methodLabel(line.returnMethod)}</p>)}
            </li>)}
          </ul>}
        </section>
      </div>}
  </>;
}

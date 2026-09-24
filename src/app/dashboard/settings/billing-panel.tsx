'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { PLANS, type PlanKey } from '@/lib/billing/plans';
import { cancelPrompt, defaultPlan, PLAN_NOTES, planChoices, planFacts, planPriceLabel, type PlanCard } from '@/lib/billing/presentation';

export default function BillingPanel({ card }: { card: PlanCard }) {
  const router = useRouter();
  const [plan, setPlan] = useState<PlanKey>(() => defaultPlan(card));
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [confirmingCancel, setConfirmingCancel] = useState(false);

  const options = planChoices(card);

  async function post(path: string, body: Record<string, unknown>) {
    const response = await fetch(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const payload = (await response.json().catch(() => ({}))) as { error?: string };
    if (!response.ok) throw new Error(payload.error || 'Billing is temporarily unavailable. Please retry later.');
    return payload as { url?: string; message?: string };
  }

  async function run(action: string, task: () => Promise<void>) {
    setBusy(action);
    setMessage('');
    setError('');
    try {
      await task();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Billing is temporarily unavailable. Please retry later.');
    } finally {
      setBusy(null);
    }
  }

  const subscribe = () => run('subscribe', async () => {
    const { url } = await post('/api/billing/checkout', { plan });
    if (url) window.location.assign(url);
  });

  const manage = () => run('manage', async () => {
    const { url } = await post('/api/billing/portal', {});
    if (url) window.location.assign(url);
  });

  const cancel = () => run('cancel', async () => {
    const result = await post('/api/billing/subscription', { action: 'cancel' });
    setConfirmingCancel(false);
    setMessage(result.message || 'Cancellation scheduled.');
    router.refresh();
  });

  const changePlan = () => run('change_plan', async () => {
    const result = await post('/api/billing/subscription', { action: 'change_plan', plan });
    setMessage(result.message || 'Plan change scheduled.');
    router.refresh();
  });

  const facts = planFacts(card);
  const headline = card.state === 'Free' || card.state === 'Canceled' ? 'RekodJa Free' : 'RekodJa Pro';
  const { label: cancelLabel, body: cancelBody } = cancelPrompt(card);

  return <div className="plan-card">
    <div className="plan-status">
      <span className={`plan-state plan-state-${card.slug}`}>{card.state}</span>
      <p className="plan-headline">{headline}</p>
    </div>

    {facts.length > 0
      ? <dl className="plan-facts">{facts.map(([term, value]) => <div key={term}><dt>{term}</dt><dd>{value}</dd></div>)}</dl>
      : <p className="muted">{card.usedTrial ? 'No active subscription. Your free trial has already been used.' : 'No active subscription.'}</p>}

    {(card.canSubscribe || card.canChangePlan) && <fieldset className="plan-options" disabled={busy !== null}>
      <legend>{card.canChangePlan ? 'Change plan' : 'Choose a plan'}</legend>
      {options.map((key) => <label key={key} className="plan-option">
        <input type="radio" name="billing-plan" value={key} checked={plan === key} onChange={() => setPlan(key)} />
        <span>{PLANS[key].label}</span>
        <span className="plan-option-price">{planPriceLabel(key)}</span>
      </label>)}
    </fieldset>}

    <div className="button-row">
      {card.canSubscribe && <button className="button primary" disabled={busy !== null} onClick={subscribe}>
        {busy === 'subscribe' ? 'Opening Checkout…' : 'Continue to subscribe'}
      </button>}
      {card.canChangePlan && <button className="button" disabled={busy !== null} onClick={changePlan}>
        {busy === 'change_plan' ? 'Scheduling…' : 'Change plan'}
      </button>}
      {card.canManage && <button className="button" disabled={busy !== null} onClick={manage}>
        {busy === 'manage' ? 'Opening…' : 'Manage billing'}
      </button>}
      {card.canCancel && <button className="button danger" disabled={busy !== null} onClick={() => setConfirmingCancel(true)}>
        {cancelLabel}
      </button>}
    </div>

    <ul className="plan-notes">{PLAN_NOTES.map((note) => <li key={note}>{note}</li>)}</ul>

    {error
      ? <p className="plan-feedback plan-error" role="alert">{error}</p>
      : <p className="plan-feedback" role="status" aria-live="polite">{message}</p>}

    {confirmingCancel && <div className="importing-overlay" role="dialog" aria-modal="true" aria-labelledby="plan-cancel-title">
      <div className="importing-dialog sync-dialog">
        <p className="popup-title" id="plan-cancel-title">{cancelLabel}?</p>
        <p>{cancelBody}</p>
        <div className="button-row">
          <button className="button danger" disabled={busy !== null} onClick={cancel}>
            {busy === 'cancel' ? 'Cancelling…' : 'Yes, cancel'}
          </button>
          <button className="button" disabled={busy !== null} onClick={() => setConfirmingCancel(false)}>Keep my plan</button>
        </div>
      </div>
    </div>}
  </div>;
}

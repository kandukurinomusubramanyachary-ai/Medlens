'use client';

import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowRight, Check, FileSearch, FlaskConical, Play, Plus, ShieldCheck, UserRound } from 'lucide-react';
import { AppShell } from './AppShell';
import { Button, ErrorState } from './ui';
import { jsonOptions, requestRecord } from '@/lib/client';
import { intakeInputSchema } from '@/lib/schema';

export function IntakePage() {
  const router = useRouter();
  const [busy, setBusy] = useState<'create' | 'demo' | null>(null);
  const [error, setError] = useState('');
  async function demo() {
    setBusy('demo'); setError('');
    try { const record = await requestRecord('/api/demo', jsonOptions({})); router.push(`/record/${record.id}`); }
    catch (error) { setError(error instanceof Error ? error.message : 'Please try again.'); setBusy(null); }
  }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const data = new FormData(event.currentTarget);
    const parsed = intakeInputSchema.safeParse({ ...Object.fromEntries(data), age: data.get('age') ? Number(data.get('age')) : null, sex: data.get('sex') || null });
    if (!parsed.success) { setError(parsed.error.issues[0].message); return; }
    setBusy('create'); setError('');
    try { const record = await requestRecord('/api/intake', jsonOptions(parsed.data)); router.push(`/record/${record.id}?upload=true`); }
    catch (error) { setError(error instanceof Error ? error.message : 'Please try again.'); setBusy(null); }
  }
  return <AppShell><div className="welcome-header"><div className="welcome-symbol"><FileSearch size={26} /></div><h1>A clearer picture.<br /><span>One source at a time.</span></h1><p>Turn medical reports into a structured, traceable<br className="desktop-break" /> patient record you can review and verify.</p></div>
    <div className="intake-layout" id="new-record"><section className="panel intake-panel"><div className="section-heading"><div className="section-icon"><UserRound size={19} /></div><div><h2>Start a patient record</h2><p>A few details to put the reports in context.</p></div><span className="optional-note">* Required</span></div>
      <form className="intake-form" onSubmit={submit}><label className="field">Patient name or identifier *<input name="nameOrIdentifier" required maxLength={120} autoComplete="off" placeholder="e.g. Patient 001" /></label><div className="form-two"><label className="field">Age<input name="age" type="number" min="0" max="130" placeholder="Years" /></label><label className="field">Sex as recorded<select name="sex" defaultValue=""><option value="">Not provided</option><option value="FEMALE">Female</option><option value="MALE">Male</option><option value="OTHER">Other</option><option value="PREFER_NOT_TO_SAY">Prefer not to say</option></select></label></div>
      <label className="field">Symptoms or reason for visit<textarea name="symptoms" rows={2} maxLength={5000} placeholder="Include when symptoms began, if known" /></label>
      <details className="intake-details"><summary><Plus size={16} />Add medical context <span>Optional</span></summary><div className="details-fields"><label className="field">Known conditions<textarea name="conditions" rows={2} maxLength={5000} /></label><label className="field">Allergies<textarea name="allergies" rows={2} maxLength={5000} placeholder="Leave blank if unknown; state none only if confirmed" /></label><label className="field">Medications as recorded<textarea name="medications" rows={2} maxLength={5000} placeholder="Name, dose and frequency if available" /></label><label className="field">Additional notes<textarea name="notes" rows={2} maxLength={5000} /></label></div></details>
      {error && <ErrorState message={error} />}<div className="form-footer"><span><ShieldCheck size={14} />Details stay in this session</span><Button variant="primary" type="submit" busy={busy === 'create'} disabled={busy !== null}>Create record<ArrowRight size={16} /></Button></div></form></section>
      <aside className="intake-aside"><div className="workflow-note"><h2>Messy reports.<br />Clear, connected records.</h2><div className="workflow-step"><span>1</span><div><strong>Add your sources</strong><p>Upload PDFs or images, or paste report text.</p></div></div><div className="workflow-step"><span>2</span><div><strong>See the structured details</strong><p>Values, source ranges, and context, organized automatically.</p></div></div><div className="workflow-step"><span>3</span><div><strong>Review with confidence</strong><p>Check each detail against the source. Correct, verify, and export.</p></div></div></div>
      <div className="demo-card"><div className="demo-card-top"><FlaskConical size={20} /><span>EXPLORE MEDLENS</span></div><h3>See a record come together.</h3><p>Explore a fictional patient with two reports, extracted results, and details to review.</p><Button onClick={demo} busy={busy === 'demo'} disabled={busy !== null}><Play size={15} />Try demo record<ArrowRight size={16} /></Button><span className="demo-caption"><Check size={12} />No uploads or API key needed</span></div></aside></div>
  </AppShell>;
}

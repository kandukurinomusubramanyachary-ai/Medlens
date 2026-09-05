'use client';
import { useState } from 'react';
import { Pencil, UserRound } from 'lucide-react';
import type { ClinicalItem, MedicalRecord } from '@/lib/schema';
import type { PatchRecord } from '@/lib/client';
import { terms } from '@/lib/clinicalTerms';
import { Button, ProvenanceChip } from './ui';

function ClinicalField({ item, patch, busy }: { item: ClinicalItem; patch: PatchRecord; busy: boolean }) {
  const [editing, setEditing] = useState(false); const [text, setText] = useState(item.text);
  return <div className="clinical-field">{editing ? <div className="clinical-edit"><label className="field">Recorded detail<input value={text} onChange={e => setText(e.target.value)} maxLength={1200} /></label><div className="button-row"><Button variant="primary" disabled={!text.trim()} busy={busy} onClick={async () => { if (await patch({ updates: [{ id: item.id, field: 'text', value: text, reason: 'Patient context updated during review' }] }, 'Patient details saved')) setEditing(false); }}>Save</Button><Button onClick={() => setEditing(false)}>Cancel</Button></div></div> : <><div><strong>{item.text}</strong><ProvenanceChip source={item.source} />{item.onset && <p>Onset: {item.onset}</p>}{item.dose && <p>Recorded dose: {item.dose}</p>}</div><Button variant="ghost" onClick={() => setEditing(true)}><Pencil size={14} />Edit</Button></>}</div>;
}
export function PatientDetails({ record, patch, busy }: { record: MedicalRecord; patch: PatchRecord; busy: boolean }) {
  const sections = [{ label: 'Symptoms & reason for visit', items: record.intake.symptoms }, { label: 'Known conditions', items: record.intake.conditions }, { label: 'Allergies', items: record.intake.allergies }, { label: 'Recorded medications', items: record.intake.medications }, { label: 'Report observations', items: record.observations }];
  return <div className="patient-details-layout"><section className="panel"><div className="panel-heading"><h2><UserRound size={18} />Patient information</h2><ProvenanceChip source={record.patient.source} /></div><dl className="patient-info-grid"><div><dt>Name or identifier</dt><dd>{record.patient.nameOrIdentifier}</dd></div><div><dt>Age</dt><dd>{record.patient.age ?? terms.notProvided}</dd></div><div><dt>Sex as recorded</dt><dd>{record.patient.sex ? record.patient.sex.replaceAll('_', ' ').toLowerCase() : terms.notProvided}</dd></div></dl>{record.intake.notes && <div className="patient-notes"><strong>Additional notes</strong><p>{record.intake.notes}</p><ProvenanceChip source={record.patient.source} /></div>}</section>{sections.map(section => <section className="panel" key={section.label}><div className="panel-heading"><h2>{section.label}</h2></div>{section.items.length ? section.items.map(item => <ClinicalField key={item.id} item={item} patch={patch} busy={busy} />) : <p className="empty-inline">{terms.notProvided}</p>}</section>)}</div>;
}

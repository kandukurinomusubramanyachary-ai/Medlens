'use client';

import { useRef, useState, type DragEvent } from 'react';
import { Check, FileText, LoaderCircle, LockKeyhole, UploadCloud, X } from 'lucide-react';
import type { MedicalRecord } from '@/lib/schema';
import { RequestError, requestRecord } from '@/lib/client';
import { terms } from '@/lib/clinicalTerms';
import { formatBytes } from '@/lib/utils/display';
import { AccessibleDialog, Button, ErrorState } from './ui';

export function UploadDialog({ record, open, onClose, onRecord }: { record: MedicalRecord; open: boolean; onClose: () => void; onRecord: (record: MedicalRecord) => void }) {
  const [mode, setMode] = useState<'file' | 'text'>('file');
  const [text, setText] = useState(''); const [file, setFile] = useState<File | null>(null);
  const [role, setRole] = useState('current'); const [busy, setBusy] = useState(false);
  const [error, setError] = useState(''); const [duplicate, setDuplicate] = useState(false); const [dragging, setDragging] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  function selectFile(candidate: File | undefined) { setError(''); setDuplicate(false); if (!candidate) return; if (candidate.size > 10 * 1024 * 1024) { setError('This file exceeds the 10 MB limit. Choose a smaller report.'); return; } setFile(candidate); }
  function drop(event: DragEvent) { event.preventDefault(); setDragging(false); selectFile(event.dataTransfer.files[0]); }
  async function process(keepBoth = false) {
    setBusy(true); setError(''); const body = new FormData(); body.set('recordId', record.id); body.set('role', role); if (keepBoth) body.set('keepBoth', 'true'); if (mode === 'file' && file) body.set('file', file); else body.set('text', text);
    try { const next = await requestRecord('/api/extract', { method: 'POST', body }); onRecord(next); setText(''); setFile(null); setDuplicate(false); onClose(); }
    catch (error) { setError(error instanceof Error ? error.message : terms.processError); setDuplicate(error instanceof RequestError && error.code === 'DUPLICATE_DOCUMENT'); }
    finally { setBusy(false); }
  }
  return <AccessibleDialog open={open} onOpenChange={value => { if (!value && !busy) onClose(); }} title="Add a medical report" description="Extract structured details while keeping every value connected to its source."><div className="dialog-body"><div className="segmented" aria-label="Report input method"><button className={mode === 'file' ? 'selected' : ''} onClick={() => setMode('file')} disabled={busy}>Upload a file</button><button className={mode === 'text' ? 'selected' : ''} onClick={() => setMode('text')} disabled={busy}>Paste report text</button></div>
      <label className="field report-role">Report type<select value={role} onChange={e => setRole(e.target.value)} disabled={busy}><option value="current">Current report</option><option value="previous">Previous report · compare over time</option></select></label>
      {mode === 'file' ? <><input ref={input} className="sr-only" tabIndex={-1} type="file" accept=".pdf,.png,.jpg,.jpeg,.webp" onChange={e => selectFile(e.target.files?.[0])} disabled={busy} /><button className={`upload-zone ${dragging ? 'dragging' : ''}`} onClick={() => input.current?.click()} onDragOver={e => { e.preventDefault(); setDragging(true); }} onDragLeave={() => setDragging(false)} onDrop={drop} disabled={busy}><span className="upload-symbol"><UploadCloud size={29} /></span><strong>Drop your report here</strong><span>or <b>browse files</b> on your device</span><small>PDF, PNG, JPG or WebP · up to 10 MB · 20 pages</small></button>{file && <div className="selected-file"><FileText size={20} /><div><strong>{file.name}</strong><small>{formatBytes(file.size)}</small></div><button className="icon-button" onClick={() => setFile(null)} disabled={busy} aria-label="Remove selected file"><X size={16} /></button>}</> : <label className="field">Report text<textarea className="report-text-input" rows={10} maxLength={100000} value={text} onChange={e => { setText(e.target.value); setDuplicate(false); }} placeholder={'Paste the report exactly as it appears, including dates, units and reference ranges.'} disabled={busy} /><span className="field-hint">{text.length.toLocaleString()} / 100,000 characters</span></label>}
      {error && <ErrorState message={error} />}{duplicate && <div className="duplicate-actions"><Button onClick={() => process(true)} busy={busy}>Keep both reports</Button><Button onClick={onClose}>Cancel</Button></div>}
      {busy && <div className="processing-live" role="status"><LoaderCircle size={21} className="spin" /><div><strong>Processing your report</strong><p>Reading the source and building the structured record. Image OCR may take a little longer.</p></div></div>}
      <div className="upload-trust"><LockKeyhole size={14} /><p>{terms.uploadHelper}</p></div><div className="modal-footer"><span><Check size={14} />No reference ranges are inferred</span><Button variant="primary" onClick={() => process()} busy={busy} disabled={mode === 'file' ? !file : !text.trim()}><UploadCloud size={16} />Process report</Button></div>
    </div></AccessibleDialog>;
}

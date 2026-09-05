'use client';

import type { ReactNode, ButtonHTMLAttributes } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { ArrowDown, ArrowUp, BadgeCheck, Check, FileText, LoaderCircle, Minus, Pencil, Sparkles, TriangleAlert, UserRound, X } from 'lucide-react';
import clsx from 'clsx';
import { terms } from '@/lib/clinicalTerms';
import type { LabResult, Provenance, RangeStatus } from '@/lib/schema';

export function Button({ children, className, variant = 'secondary', busy, ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'secondary' | 'ghost' | 'danger'; busy?: boolean }) {
  return <button className={clsx('button', `button-${variant}`, className)} disabled={busy || props.disabled} {...props}>{busy && <LoaderCircle size={16} className="spin" />}{children}</button>;
}
export function StatusBadge({ status }: { status: RangeStatus }) {
  const Icon = { WITHIN: Check, BELOW: ArrowDown, ABOVE: ArrowUp, NO_SOURCE_RANGE: Minus, UNABLE_TO_DETERMININE: TriangleAlert }[status];
  return <span className={`badge status-${status.toLowerCase()}`}><Icon size={13} aria-hidden="true" />{terms.status[status]}</span>;
}
export function VerificationBadge({ lab }: { lab: LabResult }) {
  const [Icon, label, variant] = lab.rejected ? [X, terms.rejected, 'rejected'] as const : lab.verified ? [BadgeCheck, terms.verified, 'verified'] as const : lab.corrected ? [Pencil, terms.edited, 'edited'] as const : [TriangleAlert, terms.review, 'review'] as const;
  return <span className={`badge badge-${variant}`}><Icon size={13} aria-hidden="true" />{label}</span>;
}
export function ProvenanceChip({ source }: { source: Provenance }) {
  const user = source.kind === 'PATIENT_PROVIDED', corrected = source.kind === 'USER_CORRECTED', ai = source.kind === 'AI_GENERATED';
  const Icon = user ? UserRound : corrected ? Pencil : ai ? Sparkles : FileText;
  const text = user ? terms.provenance.user : corrected ? terms.edited : ai ? terms.provenance.ai : source.kind === 'AI_EXTRACTED' ? terms.provenance.aiExtracted : terms.provenance.report;
  return <span className="provenance"><Icon size={12} aria-hidden="true" />{text}</span>;
}
export function EmptyState({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) { return <div className="empty-state"><div className="empty-icon"><FileText size={24} /></div><h3>{title}</h3>{children && <p>{children}</p>}{action}</div>; }
export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) { return <div className="error-state" role="alert"><TriangleAlert size={20} /><div><strong>We couldn’t complete that action.</strong><p>{message}</p>{onRetry && <Button onClick={onRetry}>Try again</Button>}</div></div>; }
export function AccessibleDialog({ open, onOpenChange, title, description, children, wide = false }: { open: boolean; onOpenChange: (open: boolean) => void; title: string; description?: string; children: ReactNode; wide?: boolean }) {
  return <Dialog.Root open={open} onOpenChange={onOpenChange}><Dialog.Portal><Dialog.Overlay className="dialog-overlay" /><Dialog.Content className={clsx('dialog-content', wide && 'dialog-wide')} aria-describedby={description ? undefined : undefined}><div className="dialog-heading"><div><Dialog.Title>{title}</Dialog.Title>{description && <Dialog.Description>{description}</Dialog.Description>}</div><Dialog.Close className="icon-button" aria-label="Close dialog"><X size={20} /></Dialog.Close></div>{children}</Dialog.Content></Dialog.Portal></Dialog.Root>;
}
export function Skeleton() { return <div className="skeleton-layout" role="status" aria-label="Loading patient record"><span className="sr-only">Loading patient record</span><div className="skeleton skeleton-title" aria-hidden="true" /><div className="skeleton skeleton-header" aria-hidden="true" /><div className="skeleton skeleton-table" aria-hidden="true" /></div>; }

'use client';
import { ErrorState } from '@/components/ui';
export default function ErrorPage({ reset }: { reset: () => void }) { return <main className="standalone-state"><ErrorState message="Your record could not be displayed. Reload this view to try again." onRetry={reset} /><a href="/">Return to workspace</a></main>; }

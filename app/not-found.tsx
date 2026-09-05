import Link from 'next/link';
export default function NotFound() { return <main className="standalone-state"><h1>This page isn’t available.</h1><p>Return to your workspace to open or create a patient record.</p><Link className="button button-primary" href="/">Return to workspace</Link></main>; }

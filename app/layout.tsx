import type { Metadata } from 'next';
import '@fontsource-variable/geist';
import '@fontsource-variable/geist-mono';
import '@/styles/tokens.css';
import './globals.css';
export const metadata: Metadata = { title: 'MedLens · Clinical information, clearly connected', description: 'Turn medical reports into structured, traceable records you can review and verify.', robots: { index: false, follow: false } };
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) { return <html lang="en"><body>{children}</body></html>; }

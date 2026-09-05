import { RecordWorkspace } from '@/components/RecordWorkspace';
export default async function RecordPage({ params }: { params: Promise<{ id: string }> }) { const { id } = await params; return <RecordWorkspace id={id} />; }

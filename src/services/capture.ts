import { insertInbox } from '@/db';

import { processPendingInbox, type BatchResult } from './inbox';

export type CaptureResult = {
  inboxId: number;
  processing: Promise<BatchResult>;
};

export async function captureInbox(rawText: string): Promise<CaptureResult> {
  const inboxId = await insertInbox(rawText);
  return { inboxId, processing: processPendingInbox() };
}

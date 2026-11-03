// Turns a listener event from McSdk.onAnyEvent into a log line. Kept apart from
// index.ts so it stays pure: nothing here reaches the native module.

import type { LogEntry } from '../shared/types';

export interface ListenerLogLine {
    msg:   string;
    level: LogEntry['level'];
    /** Too long for the console, so it goes to the file log only. */
    fileDetail?: string;
}

function levelOf(event: string, payload: any): LogEntry['level'] {
    if (event === 'McSdkSdkError') return 'error';
    if (event === 'McSdkRegistration' && payload?.state === 'FAILED') return 'error';
    if (event === 'McSdkAlarm') return 'warn';
    return 'info';
}

/**
 * Documents are the one payload not printed whole: a profile runs to many KB
 * and arrives as a JSON string. The console gets each document's metadata, the
 * file log the content.
 */
function describeDocuments(docsJson: string): string {
    try {
        const docs: Array<{ content?: string }> = JSON.parse(docsJson);
        return JSON.stringify({
            docs: docs.map(({ content, ...meta }) => ({
                ...meta,
                contentLength: content?.length ?? 0,
            })),
        });
    } catch {
        return `<unparseable docsJson, ${docsJson.length} chars>`;
    }
}

/** McSdkCallUpdated → "onCallUpdated {…}", the name McSdk subscribes it under. */
export function formatListenerEvent(event: string, payload: unknown): ListenerLogLine {
    const name  = event.replace(/^McSdk/, 'on');
    const level = levelOf(event, payload);
    const docsJson = (payload as { docsJson?: unknown } | null)?.docsJson;
    if (event === 'McSdkStoreDocuments' && typeof docsJson === 'string') {
        return {
            msg: `${name} ${describeDocuments(docsJson)}`,
            level,
            fileDetail: `${name} content: ${docsJson}`,
        };
    }
    return { msg: `${name} ${JSON.stringify(payload ?? {})}`, level };
}

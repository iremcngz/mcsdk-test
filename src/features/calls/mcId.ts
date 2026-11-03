/**
 * features/calls/mcId.ts — the MC ID out of a SIP URI, for display.
 */

/**
 * `sip:mcptt.mcuser-222@ims.mnc001.mcc001.3gppnetwork.org` → `mcuser-222`.
 *
 * Drops the scheme, any angle brackets, the host and URI parameters, and the
 * service prefix the server puts on the user part (`mcptt.`, `mcvideo.`,
 * `mcdata.`). Display only: calls are still addressed by the full URI. Falls
 * back to the input if nothing is left.
 */
export function displayMcId(uri: string): string {
  const id = uri
    .trim()
    .replace(/^<|>$/g, '')
    .replace(/^(sips?|tel):/i, '')
    .split(/[@;]/)[0]
    .replace(/^(mcptt|mcvideo|mcdata)\./i, '');
  return id || uri;
}

/**
 * The domain MC IDs live under on the MCX server this app is tested against.
 * The app is never told its own realm — setIdentity takes the bare user name —
 * so a contact typed as just an MC ID is completed with this.
 */
export const DEFAULT_MCPTT_DOMAIN = 'ims.mnc001.mcc001.3gppnetwork.org';

/**
 * What a contact is called at, from what someone typed: a URI is kept as it
 * is, `user@host` gains the scheme, and a bare MC ID becomes the server's own
 * form — `mcuser-222` → `sip:mcptt.mcuser-222@ims.mnc001.mcc001.3gppnetwork.org`,
 * the URI the server itself names that user by. Empty in, empty out.
 */
export function toMcpttUri(input: string, domain: string = DEFAULT_MCPTT_DOMAIN): string {
  const s = input.trim();
  if (!s) return '';
  if (/^(sips?|tel):/i.test(s)) return s;
  if (s.includes('@')) return `sip:${s}`;
  return `sip:mcptt.${s.replace(/^mcptt\./i, '')}@${domain}`;
}

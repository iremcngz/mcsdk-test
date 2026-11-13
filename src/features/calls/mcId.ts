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

/**
 * The MCVideo ID of a contact, for addressing an MCVideo call.
 *
 * Each service names a user differently — the IdMS token carries `mcptt_id`,
 * `mcvideo_id` and `mcdata_id` separately — and a contact is stored under its
 * MCPTT form. The MCVideo server does not know `sip:mcptt.mcuser-111@…` as one
 * of its users and refuses the INVITE with `403` and
 * `Warning: 399 … "144 user not authorized to call this particular user"`.
 *
 * So a service prefix on the user part (`mcptt.`, `mcdata.`) becomes
 * `mcvideo.`, and a bare MC ID gets the full MCVideo form. A URI with no
 * service prefix (`sip:bob@example.org`) is kept as it is: nothing in it says
 * the server builds its IDs this way.
 */
export function toMcvideoUri(input: string, domain: string = DEFAULT_MCPTT_DOMAIN): string {
  const s = input.trim();
  if (!s) return '';
  if (!/^(sips?|tel):/i.test(s) && !s.includes('@'))
    return `sip:mcvideo.${s.replace(/^(mcptt|mcvideo|mcdata)\./i, '')}@${domain}`;
  return s.replace(/^(<?sips?:)(mcptt|mcdata)\./i, '$1mcvideo.');
}

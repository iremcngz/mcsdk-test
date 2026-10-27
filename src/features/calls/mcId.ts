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

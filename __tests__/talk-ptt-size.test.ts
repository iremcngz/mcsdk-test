/**
 * __tests__/talk-ptt-size.test.ts — the PTT button's size.
 *
 * It used to be a flat 230 dp with a 266 dp ring around it. A fixed size is a
 * different share of the screen on every phone, and on the narrow one it overlapped
 * the buttons under it:
 *
 *   Galaxy A20   720 px @ 280 dpi → 411 dp wide → the 266 dp ring was 65% of it
 *   Galaxy S25  1080 px @ 480 dpi → 360 dp wide → the same ring was 74%, and overlapped
 *
 * Both phones' real numbers are measured here, so the fix is checked against the
 * devices that showed the bug rather than against round numbers.
 */

import { PTT_RING_PEAK_SCALE, pttSizes } from '../src/features/talk/styles';

/** dp = px / (dpi / 160), as Android computes it. */
const dpWidth = (px: number, dpi: number) => px / (dpi / 160);

const A20 = dpWidth(720, 280);    // 411 dp wide
const A20_H = dpWidth(1560, 280); // 891 dp tall
const S25 = dpWidth(1080, 480);   // 360 dp wide
const S25_H = dpWidth(2340, 480); // 780 dp tall

/** The room the card leaves the PTT block, measured on the S25 with a call up. */
const S25_BUDGET = 235;

describe('pttSizes', () => {
  it('measures the two handsets as Android does', () => {
    expect(Math.round(A20)).toBe(411);
    expect(Math.round(A20_H)).toBe(891);
    expect(Math.round(S25)).toBe(360);
    expect(Math.round(S25_H)).toBe(780);
  });

  // The first regression: a flat 266 dp ring was 65% of the A20's width and 74% of
  // the S25's. Both are now held by the shorter of their width and height budgets,
  // so neither takes a bigger share of its screen than the other.
  it('keeps the ring to a similar share of both screens', () => {
    const a20 = pttSizes(A20, A20_H).ring / A20;
    const s25 = pttSizes(S25, S25_H).ring / S25;
    expect(a20).toBeLessThan(0.7);
    expect(s25).toBeLessThan(0.7);
    expect(Math.abs(a20 - s25)).toBeLessThan(0.05);
  });

  /**
   * The real constraint, and the one the earlier fixes missed.
   *
   * centerBody is `flex: 1` and centres its content, so growing the wrapper splits
   * the new room evenly above and below and the ring keeps reaching down: the ring
   * itself has to fit the card's vertical budget. On the S25 that budget is ~235 dp
   * and 56% of the width came to a ring of 253 dp at the peak of the pulse.
   */
  it('fits the S25 ring inside the card, pulse included', () => {
    const { ring } = pttSizes(S25, S25_H);
    expect(ring * PTT_RING_PEAK_SCALE).toBeLessThanOrEqual(S25_BUDGET);
  });

  it('is bound by the height on the short phone and the width on the tall one', () => {
    // Same width, more height: the S25's size is the height's doing.
    expect(pttSizes(S25, S25_H).button).toBeLessThan(pttSizes(S25, 1200).button);
    // A phone as wide as the A20 but short is held down just the same.
    expect(pttSizes(A20, 600).button).toBeLessThan(pttSizes(A20, A20_H).button);
  });

  it('makes the S25 smaller than the fixed size that overlapped', () => {
    const { button, ring } = pttSizes(S25, S25_H);
    expect(button).toBeLessThan(230);
    expect(ring).toBeLessThan(266);
    // Under three quarters of the width, where the first overlap was.
    expect(ring / S25).toBeLessThan(0.7);
  });

  /**
   * The second overlap, the one that only showed once a call was up.
   *
   * TalkScreen scales the ring by `pulseAnim * 1.05` while a call is active, and a
   * transform does not grow the layout: the drawn ring was ~18 dp wider than the
   * wrapper and was painted over the buttons below. The wrapper has to hold the ring
   * at its peak, not at rest.
   */
  it('holds the ring even at the peak of the pulse', () => {
    for (const width of [320, 360, 411, 480, 600, 800]) {
      const { button, ring, wrapper } = pttSizes(width);
      expect(ring).toBeGreaterThan(button);
      expect(wrapper).toBeGreaterThanOrEqual(ring * PTT_RING_PEAK_SCALE);
    }
  });

  /**
   * The glow, which is what still crossed the Receive button after the pulse had
   * been accounted for.
   *
   * The active and talking rings carry `shadowRadius: 20` with a zero offset, and a
   * shadow is drawn outside the layout box: sizing the wrapper to exactly the pulsed
   * ring left ~0 dp under it, so the glow fell straight onto the buttons below. On
   * the S25 that was measured at 6 dp of overlap with a 16 dp margin.
   */
  it('reserves room for the pulse and the glow on both handsets', () => {
    for (const width of [A20, S25]) {
      const { ring, wrapper } = pttSizes(width);
      const belowPeak = (wrapper - ring * PTT_RING_PEAK_SCALE) / 2;
      expect(belowPeak).toBeGreaterThanOrEqual(20);
    }
  });

  it('stays usable on a very narrow phone and bounded on a tablet', () => {
    expect(pttSizes(200, 400).button).toBe(150);    // the floor, not 112
    expect(pttSizes(1200, 1600).button).toBe(230);  // the ceiling, not 672
  });

  it('grows with the width between those bounds', () => {
    expect(pttSizes(300, 1000).button).toBeLessThan(pttSizes(380, 1000).button);
  });
});

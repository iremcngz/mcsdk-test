/**
 * Unit tests for the parsePrometheus utility.
 *
 * ┌─ HOW TO RUN ────────────────────────────────────────────────────────────────┐
 * │  npx jest __tests__/parsePrometheus.test.ts          # run only this file  │
 * │  npx jest __tests__/parsePrometheus.test.ts --watch  # watch mode          │
 * └────────────────────────────────────────────────────────────────────────────┘
 *
 * WHY these tests matter:
 *   parsePrometheus is a pure function with no dependencies — it is the
 *   single piece of logic in this project that is fully testable without a
 *   device or simulator.  Verifying it here means that if SDK output ever
 *   changes format, we know *exactly* which parsing rule broke.
 */

import { parsePrometheus } from '../src/utils/parsePrometheus';

// ─────────────────────────────────────────────────────────────────────────────
// Edge cases — empty / trivial input
// ─────────────────────────────────────────────────────────────────────────────

describe('parsePrometheus — empty / trivial input', () => {
  it('returns [] for an empty string', () => {
    expect(parsePrometheus('')).toEqual([]);
  });

  it('returns [] for a string with only whitespace and newlines', () => {
    expect(parsePrometheus('   \n  \n   ')).toEqual([]);
  });

  it('ignores the # EOF sentinel line', () => {
    expect(parsePrometheus('# EOF')).toEqual([]);
  });

  it('ignores unknown comment lines', () => {
    // Lines starting with # but not HELP/TYPE should be silently skipped
    expect(parsePrometheus('# UNIT http_requests_total some_unit\n')).toEqual([]);
  });

  it('drops samples that appear before any # HELP line', () => {
    // Orphan samples have no family to attach to
    const raw = 'orphan_metric 999\n# HELP real gauge\n# TYPE real gauge\nreal 1\n';
    const result = parsePrometheus(raw);
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('real');
    expect(result[0].samples).toHaveLength(1);
    expect(result[0].samples[0].value).toBe('1');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Single metric family — basic parsing
// ─────────────────────────────────────────────────────────────────────────────

describe('parsePrometheus — single metric family', () => {
  const RAW = `
# HELP http_requests_total Total number of HTTP requests
# TYPE http_requests_total counter
http_requests_total 1234
`;

  it('returns one MetricFamily', () => {
    expect(parsePrometheus(RAW)).toHaveLength(1);
  });

  it('parses the family name correctly', () => {
    expect(parsePrometheus(RAW)[0].name).toBe('http_requests_total');
  });

  it('parses the help docstring correctly', () => {
    expect(parsePrometheus(RAW)[0].help).toBe('Total number of HTTP requests');
  });

  it('parses the type correctly', () => {
    expect(parsePrometheus(RAW)[0].type).toBe('counter');
  });

  it('parses one sample', () => {
    expect(parsePrometheus(RAW)[0].samples).toHaveLength(1);
  });

  it('parses sample name and value', () => {
    const sample = parsePrometheus(RAW)[0].samples[0];
    expect(sample.name).toBe('http_requests_total');
    expect(sample.value).toBe('1234');
    expect(sample.labels).toBe('');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Labels
// ─────────────────────────────────────────────────────────────────────────────

describe('parsePrometheus — labels', () => {
  const RAW = `
# HELP rpc_duration_seconds RPC call duration in seconds
# TYPE rpc_duration_seconds summary
rpc_duration_seconds{quantile="0.5"} 4770
rpc_duration_seconds{quantile="0.9"} 9150
rpc_duration_seconds{quantile="0.99"} 76394
rpc_duration_seconds_sum 1.7560473e+07
rpc_duration_seconds_count 2693
`;

  it('parses all 5 samples', () => {
    expect(parsePrometheus(RAW)[0].samples).toHaveLength(5);
  });

  it('extracts label string between braces', () => {
    const samples = parsePrometheus(RAW)[0].samples;
    expect(samples[0].labels).toBe('quantile="0.5"');
    expect(samples[1].labels).toBe('quantile="0.9"');
    expect(samples[2].labels).toBe('quantile="0.99"');
  });

  it('parses samples without labels as empty string', () => {
    const samples = parsePrometheus(RAW)[0].samples;
    expect(samples[3].labels).toBe('');  // _sum
    expect(samples[4].labels).toBe('');  // _count
  });

  it('parses float values with scientific notation', () => {
    const sum = parsePrometheus(RAW)[0].samples[3];
    expect(sum.value).toBe('1.7560473e+07');
  });

  it('parses multi-label samples', () => {
    const raw = `
# HELP requests_total Requests
# TYPE requests_total counter
requests_total{method="GET",status="200"} 10
`;
    const sample = parsePrometheus(raw)[0].samples[0];
    expect(sample.labels).toBe('method="GET",status="200"');
    expect(sample.value).toBe('10');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Multiple metric families
// ─────────────────────────────────────────────────────────────────────────────

describe('parsePrometheus — multiple metric families', () => {
  const RAW = `
# HELP sip_rx_packets SIP received packets
# TYPE sip_rx_packets counter
sip_rx_packets 100
# HELP sip_active_calls Active SIP calls
# TYPE sip_active_calls gauge
sip_active_calls 3
# HELP http_latency_seconds HTTP latency
# TYPE http_latency_seconds histogram
http_latency_seconds_bucket{le="0.1"} 5
http_latency_seconds_bucket{le="0.5"} 20
http_latency_seconds_sum 4.2
http_latency_seconds_count 20
`;

  it('returns 3 families', () => {
    expect(parsePrometheus(RAW)).toHaveLength(3);
  });

  it('assigns correct names to each family', () => {
    const names = parsePrometheus(RAW).map(f => f.name);
    expect(names).toEqual(['sip_rx_packets', 'sip_active_calls', 'http_latency_seconds']);
  });

  it('assigns correct types to each family', () => {
    const types = parsePrometheus(RAW).map(f => f.type);
    expect(types).toEqual(['counter', 'gauge', 'histogram']);
  });

  it('assigns the right number of samples to each family', () => {
    const counts = parsePrometheus(RAW).map(f => f.samples.length);
    expect(counts).toEqual([1, 1, 4]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Histogram — bucket / sum / count / +Inf
// ─────────────────────────────────────────────────────────────────────────────

describe('parsePrometheus — histogram', () => {
  const RAW = `
# HELP http_request_duration_seconds HTTP request duration
# TYPE http_request_duration_seconds histogram
http_request_duration_seconds_bucket{le="0.05"} 24054
http_request_duration_seconds_bucket{le="0.1"} 33444
http_request_duration_seconds_bucket{le="+Inf"} 144320
http_request_duration_seconds_sum 53423
http_request_duration_seconds_count 144320
`;

  it('parses all 5 histogram samples', () => {
    expect(parsePrometheus(RAW)[0].samples).toHaveLength(5);
  });

  it('parses the +Inf bucket label', () => {
    const infBucket = parsePrometheus(RAW)[0].samples[2];
    expect(infBucket.labels).toBe('le="+Inf"');
    expect(infBucket.value).toBe('144320');
  });

  it('parses _sum sample with no labels', () => {
    const sum = parsePrometheus(RAW)[0].samples[3];
    expect(sum.name).toBe('http_request_duration_seconds_sum');
    expect(sum.labels).toBe('');
    expect(sum.value).toBe('53423');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Robustness — unusual but valid input
// ─────────────────────────────────────────────────────────────────────────────

describe('parsePrometheus — robustness', () => {
  it('handles # HELP with no help text (just the name)', () => {
    const raw = '# HELP metric_with_no_help\n# TYPE metric_with_no_help gauge\nmetric_with_no_help 0\n';
    const family = parsePrometheus(raw)[0];
    expect(family.name).toBe('metric_with_no_help');
    expect(family.help).toBe('');
  });

  it('handles # TYPE appearing without a preceding # HELP (dropped)', () => {
    // When # TYPE comes before any # HELP, `current` is null — should not crash
    const raw = '# TYPE orphan_type gauge\norphan_type 1\n# HELP real_metric Real\n# TYPE real_metric counter\nreal_metric 5\n';
    const result = parsePrometheus(raw);
    // orphan_type has no family, real_metric does
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('real_metric');
  });

  it('handles NaN and special float values', () => {
    const raw = '# HELP special Special values\n# TYPE special gauge\nspecial NaN\n';
    expect(parsePrometheus(raw)[0].samples[0].value).toBe('NaN');
  });

  it('handles metric with only # HELP (no # TYPE, no samples)', () => {
    const raw = '# HELP lonely_metric No type or samples\n';
    const families = parsePrometheus(raw);
    expect(families).toHaveLength(1);
    expect(families[0].type).toBe('');
    expect(families[0].samples).toHaveLength(0);
  });
});

/**
 * Prometheus text-format parser.
 *
 * Converts the plain-text Prometheus exposition format (OpenMetrics compatible)
 * returned by McSdk.listMetrics() into structured JavaScript objects.
 *
 * Supported constructs:
 *   # HELP <name> <docstring>
 *   # TYPE <name> <type>
 *   <name>[{<labels>}] <value>
 *   # EOF  (ignored)
 *
 * Reference: https://prometheus.io/docs/instrumenting/exposition_formats/
 */

export interface MetricSample {
  /** Metric name (e.g. "http_requests_total") */
  name: string;
  /** Raw label string without braces (e.g. `method="GET",code="200"`), or '' */
  labels: string;
  /** String representation of the value (e.g. "42", "3.14", "+Inf") */
  value: string;
}

export interface MetricFamily {
  /** Metric family name from `# HELP` line */
  name: string;
  /** Documentation string from `# HELP` line */
  help: string;
  /** Type string from `# TYPE` line (counter, gauge, histogram, summary, …) */
  type: string;
  /** All samples belonging to this family */
  samples: MetricSample[];
}

/**
 * Parse raw Prometheus text output into an array of MetricFamily objects.
 *
 * Rules:
 * - Lines that start with `# HELP` open a new MetricFamily.
 * - Lines that start with `# TYPE` set the type on the current family.
 * - Any other non-comment, non-empty line is parsed as a MetricSample.
 * - `# EOF` and blank lines are ignored.
 * - Samples that appear before any `# HELP` line are silently dropped.
 */
export function parsePrometheus(raw: string): MetricFamily[] {
  const families: MetricFamily[] = [];
  let current: MetricFamily | null = null;

  for (const line of raw.split('\n')) {
    const t = line.trim();
    if (!t || t === '# EOF') { continue; }

    if (t.startsWith('# HELP ')) {
      const rest = t.slice(7);
      const sp = rest.indexOf(' ');
      const name = sp >= 0 ? rest.slice(0, sp) : rest;
      const help = sp >= 0 ? rest.slice(sp + 1) : '';
      current = { name, help, type: '', samples: [] };
      families.push(current);
    } else if (t.startsWith('# TYPE ')) {
      if (current) {
        const parts = t.slice(7).trim().split(/\s+/);
        current.type = parts[1] ?? '';
      }
    } else if (!t.startsWith('#') && current) {
      const braceOpen = t.indexOf('{');
      const sp = t.lastIndexOf(' ');
      if (sp < 0) { continue; }
      const value = t.slice(sp + 1);
      let sampleName: string;
      let labels: string;
      if (braceOpen >= 0 && braceOpen < sp) {
        sampleName = t.slice(0, braceOpen);
        const braceClose = t.indexOf('}', braceOpen);
        labels = t.slice(braceOpen + 1, braceClose);
      } else {
        sampleName = t.slice(0, sp);
        labels = '';
      }
      current.samples.push({ name: sampleName, labels, value });
    }
  }
  return families;
}

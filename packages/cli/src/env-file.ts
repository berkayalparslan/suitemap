// Minimal dotenv-style parser: `KEY=value`, optional `export `, `#` comments, single/double quotes.
// No interpolation and no multi-line values. Errors name the line, never its content: the file
// holds secrets.
export function parseEnvFile(text: string): Record<string, string> {
  const env: Record<string, string> = Object.create(null) as Record<string, string>;
  const lines = text.split(/\r?\n/);
  for (const [i, raw] of lines.entries()) {
    const line = raw.trim();
    if (line === '' || line.startsWith('#')) continue;
    const m = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_.-]*)\s*=\s*(.*)$/.exec(line);
    if (!m) throw new Error(`line ${i + 1} is not KEY=value`);
    let value = (m[2] ?? '').trim();
    const quote = value[0];
    if (quote === '"' || quote === "'") {
      const end = value.indexOf(quote, 1);
      if (end === -1) throw new Error(`line ${i + 1} has an unterminated quote`);
      value = value.slice(1, end);
      if (quote === '"')
        value = value.replace(/\\([n"\\])/g, (_, c: string) => (c === 'n' ? '\n' : c));
    } else {
      value = value.replace(/(^|\s+)#.*$/, '');
    }
    env[m[1] as string] = value;
  }
  return env;
}

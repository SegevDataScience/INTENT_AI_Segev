// Minimal robots.txt evaluator (RFC 9309) for the "User-agent: *" group only.
// The capture script never claims another crawler's identity, so only the wildcard group applies to it.

function toRegex(pattern) {
  const anchored = pattern.endsWith('$');
  const body = (anchored ? pattern.slice(0, -1) : pattern)
    .split('*').map(part => part.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*');
  return new RegExp('^' + body + (anchored ? '$' : ''));
}

function wildcardRules(text) {
  const rules = [];
  let inStar = false;
  let lastWasAgent = false;
  for (const raw of String(text).split(/\r?\n/)) {
    const line = raw.replace(/#.*/, '').trim();
    const m = /^([A-Za-z-]+)\s*:\s*(.*)$/.exec(line);
    if (!m) continue;
    const key = m[1].toLowerCase();
    const value = m[2].trim();
    if (key === 'user-agent') {
      // Consecutive User-agent lines share one group.
      inStar = (lastWasAgent && inStar) || value === '*';
      lastWasAgent = true;
      continue;
    }
    lastWasAgent = false;
    if (!inStar || (key !== 'allow' && key !== 'disallow')) continue;
    if (key === 'disallow' && value === '') continue; // "Disallow:" with no value allows everything
    rules.push({ allow: key === 'allow', pattern: value, re: toRegex(value) });
  }
  return rules;
}

export function isPathAllowed(robotsTxt, path) {
  let best = null;
  for (const rule of wildcardRules(robotsTxt)) {
    if (!rule.re.test(path)) continue;
    const better = !best || rule.pattern.length > best.pattern.length ||
      (rule.pattern.length === best.pattern.length && rule.allow && !best.allow);
    if (better) best = rule;
  }
  return best ? best.allow : true;
}

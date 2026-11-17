// How headlines and market numbers read, shared by the Today card and the
// newsletter (copied to functions/shared by scripts/share.mjs).
const number = (value, digits) => value.toLocaleString('en-US', { minimumFractionDigits:digits, maximumFractionDigits:digits });

// "7,416.59" for indexes, "5.15%" for rates.
export const marketValue = market => market.kind === 'index' ? number(market.value, 2) : `${number(market.value, 2)}%`;
// Indexes move in percent; rates move in percentage points. Only index moves are
// colored (`tone`): a falling rate isn't bad news for a borrower.
export function marketChange(market) {
  const move = market.kind === 'index' ? market.changePct : market.change;
  if (move == null) return { text:'', direction:'flat', tone:'flat' };
  if (Math.abs(move) < 0.005) return { text:'unchanged', direction:'flat', tone:'flat' };
  const direction = move > 0 ? 'up' : 'down', arrow = move > 0 ? '▲' : '▼';
  return { text:market.kind === 'index' ? `${arrow} ${number(Math.abs(move), 2)}%` : `${arrow} ${number(Math.abs(move), 2)} pt`, direction, tone:market.kind === 'index' ? direction : 'flat' };
}
// "Nov 16" from FRED's YYYY-MM-DD.
export const marketDate = date => new Date(`${date}T12:00:00Z`).toLocaleDateString('en-US', { month:'short', day:'numeric', timeZone:'UTC' });
// One line for the email's plain-text part or a summary.
export const marketLine = market => `${market.name} ${marketValue(market)}${marketChange(market).text ? ` ${marketChange(market).text}` : ''}`;

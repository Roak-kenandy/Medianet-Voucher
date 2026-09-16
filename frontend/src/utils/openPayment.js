export function openBmlPayment(url) {
  const tab = window.open(url, '_blank', 'noopener,noreferrer');
  return Boolean(tab);
}

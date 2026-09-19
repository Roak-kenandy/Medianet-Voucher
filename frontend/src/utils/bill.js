export function printBill(elementId) {
  const bill = document.getElementById(elementId);
  if (!bill) return;

  document.body.classList.add('printing-bill');
  bill.classList.add('wallet-topup-bill-print-target');

  window.print();

  document.body.classList.remove('printing-bill');
  bill.classList.remove('wallet-topup-bill-print-target');
}

export function downloadBillHtml(elementId, filename) {
  const bill = document.getElementById(elementId);
  if (!bill) return;

  const styles = Array.from(document.styleSheets)
    .map((sheet) => {
      try {
        return Array.from(sheet.cssRules || [])
          .map((rule) => rule.cssText)
          .join('\n');
      } catch {
        return '';
      }
    })
    .join('\n');

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>${filename}</title>
  <style>
    body { font-family: system-ui, sans-serif; background: #f5f7fa; padding: 24px; }
    ${styles}
    .wallet-topup-bill-wrap { max-width: 760px; margin: 0 auto; }
    .wallet-topup-bill-actions, .no-print { display: none !important; }
  </style>
</head>
<body>
  ${bill.outerHTML}
</body>
</html>`;

  const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

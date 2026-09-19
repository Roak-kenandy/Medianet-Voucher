import { Download, Printer } from 'lucide-react';
import Logo from '../Logo';
import { formatMoney } from '../../utils/money';
import { printBill, downloadBillHtml } from '../../utils/bill';

function formatBillDate(value) {
  if (!value) return '—';
  return new Date(value).toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatPercent(value) {
  const num = Number(value);
  if (Number.isNaN(num)) return '—';
  return Number.isInteger(num) ? `${num}%` : `${num.toFixed(2)}%`;
}

export default function WalletTopupBill({ bill }) {
  if (!bill) return null;

  const currencyCode = bill.currencyCode || 'MVR';
  const billId = `wallet-topup-bill-${bill.billNumber}`;

  const handlePrint = () => printBill(billId);
  const handleDownload = () => downloadBillHtml(billId, `wallet-topup-${bill.billNumber}.html`);

  return (
    <div className="wallet-topup-bill-wrap">
      <div className="wallet-topup-bill-actions no-print">
        <button type="button" className="btn btn-secondary btn-sm" onClick={handlePrint}>
          <Printer size={16} />
          Print bill
        </button>
        <button type="button" className="btn btn-secondary btn-sm" onClick={handleDownload}>
          <Download size={16} />
          Download bill
        </button>
      </div>

      <article id={billId} className="wallet-topup-bill">
        <header className="wallet-topup-bill-header">
          <div className="wallet-topup-bill-brand">
            <Logo size={48} framed className="wallet-topup-bill-logo" />
            <div>
              <p className="wallet-topup-bill-tagline">Voucher Portal · Wallet Top-up Receipt</p>
            </div>
          </div>
          <div className="wallet-topup-bill-meta">
            <div>
              <span className="wallet-topup-bill-meta-label">Bill no.</span>
              <strong>{bill.billNumber}</strong>
            </div>
            <div>
              <span className="wallet-topup-bill-meta-label">Date</span>
              <strong>{formatBillDate(bill.issuedAt)}</strong>
            </div>
            <div>
              <span className="wallet-topup-bill-meta-label">Status</span>
              <strong>Paid</strong>
            </div>
          </div>
        </header>

        <section className="wallet-topup-bill-section">
          <h4 className="wallet-topup-bill-section-title">Bill to</h4>
          <p className="wallet-topup-bill-party-name">{bill.operatorName}</p>
          {bill.operatorEmail && (
            <p className="wallet-topup-bill-party-meta">{bill.operatorEmail}</p>
          )}
        </section>

        <section className="wallet-topup-bill-section">
          <h4 className="wallet-topup-bill-section-title">Payment details</h4>
          <div className="wallet-topup-bill-lines">
            <div className="wallet-topup-bill-line">
              <span>Payment method</span>
              <span>{bill.paymentMethod}</span>
            </div>
            {bill.paymentRef && (
              <div className="wallet-topup-bill-line">
                <span>Payment reference</span>
                <span>{bill.paymentRef}</span>
              </div>
            )}
            <div className="wallet-topup-bill-line">
              <span>Description</span>
              <span>{bill.description}</span>
            </div>
          </div>
        </section>

        <section className="wallet-topup-bill-section">
          <h4 className="wallet-topup-bill-section-title">Amount breakdown</h4>
          <div className="wallet-topup-bill-lines">
            <div className="wallet-topup-bill-line">
              <span>Amount paid</span>
              <span>{formatMoney(bill.amountPaid, currencyCode)}</span>
            </div>
            {bill.commissionAmount > 0 && (
              <div className="wallet-topup-bill-line">
                <span>Operator bonus</span>
                <span>+ {formatMoney(bill.commissionAmount, currencyCode)}</span>
              </div>
            )}
            {bill.grossTotal > bill.amountPaid && (
              <div className="wallet-topup-bill-line">
                <span>Total before GST</span>
                <span>{formatMoney(bill.grossTotal, currencyCode)}</span>
              </div>
            )}
            <div className="wallet-topup-bill-line">
              <span>GST ({formatPercent(bill.gstRatePercent)})</span>
              <span>− {formatMoney(bill.gstAmount, currencyCode)}</span>
            </div>
            <div className="wallet-topup-bill-total">
              <span>Credited to wallet</span>
              <span>{formatMoney(bill.creditedAmount, currencyCode)}</span>
            </div>
          </div>
        </section>

        <section className="wallet-topup-bill-section">
          <h4 className="wallet-topup-bill-section-title">Wallet balance</h4>
          <div className="wallet-topup-bill-lines">
            <div className="wallet-topup-bill-line">
              <span>Balance before</span>
              <span>{formatMoney(bill.balanceBefore, currencyCode)}</span>
            </div>
            <div className="wallet-topup-bill-line wallet-topup-bill-line-highlight">
              <span>Balance after</span>
              <span>{formatMoney(bill.balanceAfter, currencyCode)}</span>
            </div>
          </div>
        </section>

        <footer className="wallet-topup-bill-footer">
          <p>Thank you for your payment. This receipt confirms your successful wallet top-up via Bank of Maldives.</p>
          <p className="wallet-topup-bill-footer-note">Generated by Medianet Voucher Portal</p>
        </footer>
      </article>
    </div>
  );
}

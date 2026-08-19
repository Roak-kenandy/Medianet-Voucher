import { useLocation } from 'react-router-dom';
import { HelpCircle, Mail, BookOpen, MessageCircle } from 'lucide-react';
import Layout from '../../components/Layout';
import Sidebar from '../../components/Sidebar';
import Header from '../../components/Header';
import { useAuth } from '../../context/AuthContext';
import { isStaffRole } from '../../constants/permissions';

const ADMIN_FAQ = [
  {
    q: 'What are the staff roles?',
    a: 'Admin has full access. Sales can manage operators, packages, and reports but cannot create staff accounts. Finance can manage operators, staff, and reports but cannot create or change packages.',
  },
  {
    q: 'How do I create a package?',
    a: 'Go to Packages in the sidebar, click Create Package, load the CRM catalog (OTT-tagged products), pick a service and OTT-segment price tier, then save. Finance users can view packages but cannot create them.',
  },
  {
    q: 'How do I create an operator?',
    a: 'Go to Operators, click Create Operator, select one or more packages from the admin-created list, fill in client details, quota, and optional notes, then save.',
  },
  {
    q: 'How do I add another staff account?',
    a: 'Open Staff in the sidebar and click Create Staff Account. Only Admin users can create new staff accounts and assign Admin, Sales, or Finance roles.',
  },
  {
    q: 'How do I generate reports?',
    a: 'Go to Reports, choose report type (client summary, by period, or package breakdown), set filters (defaults to the last 30 days), and click Generate. Export as CSV when needed.',
  },
];

const OPERATOR_FAQ = [
  {
    q: 'How do I create a single account?',
    a: 'Navigate to Create Account, enter the customer full name and their 7-digit Maldives mobile number (starts with 7 or 9, no +960), then submit. Your remaining quota is shown on the page.',
  },
  {
    q: 'How does bulk upload work?',
    a: 'Go to Bulk Upload. You can add up to 10 accounts at a time or import a CSV using the template. After submit, you will see per-row results showing which accounts succeeded or failed and why.',
  },
  {
    q: 'What packages are provisioned?',
    a: 'Your administrator assigns one or more packages to your operator account. When you create an account, all assigned packages are provisioned in CRM automatically.',
  },
  {
    q: 'How do I download my report?',
    a: 'Go to Reports, optionally adjust the date range (defaults to the last 30 days), click Generate Report, then Download CSV for your account activity and quota summary.',
  },
  {
    q: 'What is my account quota?',
    a: 'Your quota is set by your administrator. Check the Dashboard for used vs remaining accounts.',
  },
  {
    q: 'Why did an account fail?',
    a: 'Open Accounts and check the Details column for failed rows. Common reasons include invalid phone numbers or CRM provisioning errors. Contact support if you need help resolving a failure.',
  },
];

export default function HelpCenterPage() {
  const { pathname } = useLocation();
  const { user } = useAuth();
  const role = user?.role || (pathname.startsWith('/admin') ? 'admin' : 'operator');
  const faqs = isStaffRole(role) || role === 'admin' ? ADMIN_FAQ : OPERATOR_FAQ;

  return (
    <Layout sidebar={<Sidebar role={role} />} header={<Header />}>
      <div className="page-header">
        <h1 className="page-title">Help Center</h1>
        <p className="page-subtitle">Guides, FAQs, and support contacts</p>
      </div>

      <div className="content-grid">
        <div className="card">
          <div className="card-header">
            <h3 className="card-title"><BookOpen size={18} style={{ verticalAlign: 'middle', marginRight: 8 }} />FAQs</h3>
          </div>
          <div className="card-body">
            {faqs.map((item, i) => (
              <div key={i} style={{ marginBottom: 20 }}>
                <h4 style={{ fontSize: 14, fontWeight: 600, marginBottom: 6 }}>{item.q}</h4>
                <p style={{ fontSize: 14, color: 'var(--color-text-secondary)', lineHeight: 1.6 }}>{item.a}</p>
              </div>
            ))}
          </div>
        </div>

        <div className="card">
          <div className="card-header">
            <h3 className="card-title"><MessageCircle size={18} style={{ verticalAlign: 'middle', marginRight: 8 }} />Contact Support</h3>
          </div>
          <div className="card-body">
            <p style={{ fontSize: 14, color: 'var(--color-text-secondary)', marginBottom: 16 }}>
              For technical issues, quota changes, or CRM integration help:
            </p>
            <ul style={{ listStyle: 'none', fontSize: 14 }}>
              <li style={{ display: 'flex', gap: 10, marginBottom: 12 }}>
                <Mail size={18} color="var(--color-text-muted)" />
                <span>support@medianet.mv</span>
              </li>
              <li style={{ display: 'flex', gap: 10, marginBottom: 12 }}>
                <HelpCircle size={18} color="var(--color-text-muted)" />
                <span>Hours: Sun–Thu, 9:00 AM – 5:00 PM</span>
              </li>
            </ul>
            <div className="alert alert-info" style={{ marginTop: 16 }}>
              Include your client name, operator email, and screenshots when reporting issues.
            </div>
          </div>
        </div>
      </div>
    </Layout>
  );
}

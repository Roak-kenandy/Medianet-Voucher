import { useEffect, useMemo, useState } from 'react';
import { Lock, Copy } from 'lucide-react';
import Layout from '../../components/Layout';
import Sidebar from '../../components/Sidebar';
import Header from '../../components/Header';
import Markdown, { parseMarkdown } from '../../utils/markdown';
import { adminApi, operatorApi } from '../../api/client';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../context/ToastContext';
import { isStaffRole } from '../../constants/permissions';
import './developer-docs.css';

/** Where this portal's API lives, so the examples can be copied as they are. */
function apiBaseUrl() {
  const configured = import.meta.env.VITE_API_URL;
  const base = configured && /^https?:\/\//.test(configured) ? configured : `${window.location.origin}/api`;
  return `${base.replace(/\/+$/, '').replace(/\/api$/, '')}/api/v1`;
}

export default function DeveloperDocsPage() {
  const { user } = useAuth();
  const toast = useToast();
  const isStaff = isStaffRole(user?.role);
  const [docs, setDocs] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    (isStaff ? adminApi : operatorApi)
      .getDeveloperDocs()
      .then((result) => !cancelled && setDocs(result))
      .catch((err) => !cancelled && setError(err));
    return () => {
      cancelled = true;
    };
  }, [isStaff]);

  const baseUrl = apiBaseUrl();
  const blocks = useMemo(() => {
    if (!docs) return [];
    const host = baseUrl.replace(/\/api\/v1$/, '');
    // The guide is written for any deployment; show this one's address in its place.
    const parsed = parseMarkdown(docs.guide.replaceAll('https://<portal-host>', host));
    // The page has its own title and contents, so the guide's own are left out.
    const contentsAt = parsed.findIndex((block) => block.type === 'heading' && block.id === 'contents');
    return parsed.filter(
      (block, index) =>
        !(index === 0 && block.type === 'heading' && block.level === 1) &&
        !(contentsAt >= 0 && (index === contentsAt || index === contentsAt + 1))
    );
  }, [docs, baseUrl]);

  // Sidebar: the guide's sections, with each endpoint listed under "Endpoints".
  const sections = useMemo(() => {
    const result = [];
    for (const block of blocks) {
      if (block.type !== 'heading') continue;
      if (block.level === 2) {
        result.push({ id: block.id, text: block.text, endpoints: [] });
      } else if (block.level === 3 && result.length) {
        const endpoint = block.text.match(/^(GET|POST|PUT|PATCH|DELETE)\s+(\S+)$/);
        if (endpoint) result[result.length - 1].endpoints.push({ id: block.id, method: endpoint[1], path: endpoint[2] });
      }
    }
    return result;
  }, [blocks]);

  // Highlights the section being read.
  const [activeId, setActiveId] = useState('');
  useEffect(() => {
    const ids = sections.flatMap((section) => [section.id, ...section.endpoints.map((item) => item.id)]);
    const headings = ids.map((id) => document.getElementById(id)).filter(Boolean);
    if (!headings.length) return undefined;
    const update = () => {
      let current = headings[0].id;
      for (const heading of headings) {
        if (heading.getBoundingClientRect().top <= 120) current = heading.id;
        else break;
      }
      setActiveId(current);
    };
    update();
    // The page scrolls inside the layout on some screens and on the window on others.
    document.addEventListener('scroll', update, { capture: true, passive: true });
    return () => document.removeEventListener('scroll', update, { capture: true });
  }, [sections]);

  const handleLink = (href) => {
    if (href.startsWith('#')) {
      document.getElementById(href.slice(1))?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      return true;
    }
    return false;
  };
  const activeSectionId = sections.find(
    (section) => section.id === activeId || section.endpoints.some((item) => item.id === activeId)
  )?.id;

  const copyBaseUrl = async () => {
    try {
      await navigator.clipboard.writeText(baseUrl);
      toast.success('Base URL copied');
    } catch {
      toast.error('Could not copy. Select the address and copy it manually.');
    }
  };

  return (
    <Layout sidebar={<Sidebar role={user?.role || 'operator'} />} header={<Header />}>
      <div className="page-header">
        <h1 className="page-title">Developer API</h1>
        <p className="page-subtitle">
          {isStaff
            ? 'Operator API reference. Operators see this page only when API access is turned on for them.'
            : 'Connect your own systems to Medianet: find customers, top up, and sell, renew or upgrade packages.'}
        </p>
      </div>

      {error ? (
        <div className="card">
          <div className="empty-state">
            <Lock className="empty-state-icon" size={48} />
            <p className="empty-state-title">
              {error.code === 'API_ACCESS_DISABLED' ? 'API access is not enabled' : 'Documentation unavailable'}
            </p>
            <p>{error.message || 'Please try again later.'}</p>
          </div>
        </div>
      ) : !docs ? (
        <div className="loading-screen" style={{ height: 240 }}>
          <div className="spinner spinner-lg" />
        </div>
      ) : (
        <div className="doc-layout">
          <nav className="card doc-nav" aria-label="Documentation sections">
            <p className="doc-nav-title">On this page</p>
            <ul className="doc-nav-list">
              {sections.map((section) => (
                <li key={section.id}>
                  <a
                    href={`#${section.id}`}
                    className={`doc-nav-link${activeSectionId === section.id ? ' active' : ''}`}
                    onClick={(e) => {
                      e.preventDefault();
                      handleLink(`#${section.id}`);
                    }}
                  >
                    {section.text}
                  </a>
                  {section.endpoints.length > 0 && (
                    <ul className="doc-nav-endpoints">
                      {section.endpoints.map((item) => (
                        <li key={item.id}>
                          <a
                            href={`#${item.id}`}
                            className={`doc-nav-endpoint${activeId === item.id ? ' active' : ''}`}
                            title={`${item.method} ${item.path}`}
                            onClick={(e) => {
                              e.preventDefault();
                              handleLink(`#${item.id}`);
                            }}
                          >
                            <span className={`doc-method doc-method-${item.method.toLowerCase()}`}>{item.method}</span>
                            <span className="doc-nav-path">{item.path}</span>
                          </a>
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              ))}
            </ul>
          </nav>

          <article className="card doc-body">
            <div className="doc-callout">
              <div>
                <span className="doc-callout-label">Base URL</span>
                <code>{baseUrl}</code>
              </div>
              <button type="button" className="btn btn-secondary btn-sm" onClick={copyBaseUrl}>
                <Copy size={14} /> Copy
              </button>
            </div>
            <p className="doc-p doc-note">
              {isStaff
                ? 'API keys are created per operator under Operators → Edit Operator → API keys.'
                : 'API keys are issued by Medianet. Ask your Medianet contact for a key, and keep it on your servers only.'}
            </p>
            <Markdown blocks={blocks} onLink={handleLink} />
          </article>
        </div>
      )}
    </Layout>
  );
}

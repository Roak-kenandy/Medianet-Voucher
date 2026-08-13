import { cloneElement, isValidElement, useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import './Layout.css';

export default function Layout({ sidebar, header, children }) {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const location = useLocation();

  useEffect(() => {
    setSidebarOpen(false);
  }, [location.pathname]);

  useEffect(() => {
    document.body.style.overflow = sidebarOpen ? 'hidden' : '';
    return () => {
      document.body.style.overflow = '';
    };
  }, [sidebarOpen]);

  const sidebarElement = isValidElement(sidebar)
    ? cloneElement(sidebar, { onNavigate: () => setSidebarOpen(false) })
    : sidebar;

  const headerElement = isValidElement(header)
    ? cloneElement(header, {
        onMenuToggle: () => setSidebarOpen((open) => !open),
        sidebarOpen,
      })
    : header;

  return (
    <div className={`app-layout ${sidebarOpen ? 'sidebar-open' : ''}`}>
      <button
        type="button"
        className="sidebar-backdrop"
        aria-label="Close menu"
        onClick={() => setSidebarOpen(false)}
        tabIndex={sidebarOpen ? 0 : -1}
      />
      <aside className="app-sidebar">{sidebarElement}</aside>
      <div className="app-main">
        <header className="app-header">{headerElement}</header>
        <main className="app-content">{children}</main>
      </div>
    </div>
  );
}

import React from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useAuth } from '../auth';

export default function Navbar() {
  const { logout } = useAuth();
  const location = useLocation();

  const links = [
    { to: '/projects', label: 'Projects' },
    { to: '/library', label: 'Library' },
    { to: '/tenants', label: 'Tenant' },
  ];

  return (
    <nav className="bg-indigo-700 text-white shadow-lg">
      <div className="max-w-7xl mx-auto px-4 flex items-center justify-between h-14">
        <Link to="/" className="font-bold text-lg tracking-tight">
          EPC Planning Engine
        </Link>
        <div className="flex items-center gap-6">
          {links.map((l) => (
            <Link
              key={l.to}
              to={l.to}
              className={`text-sm hover:text-indigo-200 ${
                location.pathname.startsWith(l.to) ? 'text-white font-semibold' : 'text-indigo-200'
              }`}
            >
              {l.label}
            </Link>
          ))}
          <button
            onClick={logout}
            className="text-sm bg-indigo-600 hover:bg-indigo-500 px-3 py-1 rounded"
          >
            Logout
          </button>
        </div>
      </div>
    </nav>
  );
}

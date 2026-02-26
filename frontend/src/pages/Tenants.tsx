import React, { useEffect, useState } from 'react';
import api from '../api';

interface Tenant {
  id: string;
  name: string;
  plan: string;
  role: string;
}

export default function Tenants() {
  const [tenants, setTenants] = useState<Tenant[]>([]);

  useEffect(() => {
    api.get('/tenants').then(({ data }) => setTenants(data));
  }, []);

  return (
    <div>
      <h1 className="text-xl font-bold mb-4">Organization</h1>
      {tenants.map((t) => (
        <div key={t.id} className="bg-white rounded-lg border p-6 mb-4">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-lg font-semibold">{t.name}</h2>
              <p className="text-sm text-gray-500">Plan: {t.plan}</p>
            </div>
            <span className="text-xs bg-indigo-100 text-indigo-700 px-2 py-1 rounded font-medium uppercase">
              {t.role}
            </span>
          </div>
        </div>
      ))}
    </div>
  );
}

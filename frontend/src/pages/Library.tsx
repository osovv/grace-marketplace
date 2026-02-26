import React, { useEffect, useState } from 'react';
import api from '../api';

type Tab = 'templates' | 'norms' | 'areas';

export default function Library() {
  const [tab, setTab] = useState<Tab>('templates');
  const [templates, setTemplates] = useState<any[]>([]);
  const [norms, setNorms] = useState<any[]>([]);
  const [areas, setAreas] = useState<any[]>([]);

  useEffect(() => {
    api.get('/library/templates').then(({ data }) => setTemplates(data));
    api.get('/library/norms').then(({ data }) => setNorms(data));
    api.get('/library/areas').then(({ data }) => setAreas(data));
  }, []);

  const tabs: { key: Tab; label: string }[] = [
    { key: 'templates', label: 'Templates' },
    { key: 'norms', label: 'Productivity Norms' },
    { key: 'areas', label: 'Area Dictionary' },
  ];

  return (
    <div>
      <h1 className="text-xl font-bold mb-4">Library</h1>

      <div className="flex gap-1 mb-4 border-b">
        {tabs.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px ${
              tab === t.key
                ? 'border-indigo-600 text-indigo-700'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'templates' && (
        <div className="overflow-x-auto">
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="bg-gray-100">
                <th className="p-2 border text-left">Name</th>
                <th className="p-2 border text-left">Discipline</th>
                <th className="p-2 border text-left">Work Type</th>
                <th className="p-2 border text-center">Version</th>
                <th className="p-2 border text-center">Activities</th>
              </tr>
            </thead>
            <tbody>
              {templates.map((t) => {
                const actCount = (t.steps_json || []).reduce(
                  (sum: number, step: any) => sum + (step.activities?.length || 0),
                  0
                );
                return (
                  <tr key={t.id} className="hover:bg-gray-50">
                    <td className="p-2 border font-medium">{t.name}</td>
                    <td className="p-2 border">{t.discipline}</td>
                    <td className="p-2 border font-mono text-xs">{t.work_type}</td>
                    <td className="p-2 border text-center">v{t.version}</td>
                    <td className="p-2 border text-center">{actCount}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {tab === 'norms' && (
        <div className="overflow-x-auto">
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="bg-gray-100">
                <th className="p-2 border text-left">Discipline</th>
                <th className="p-2 border text-left">Work Type</th>
                <th className="p-2 border text-left">UOM</th>
                <th className="p-2 border text-right">MH/UOM</th>
                <th className="p-2 border text-right">Crew Size</th>
                <th className="p-2 border text-right">Labor Rate</th>
              </tr>
            </thead>
            <tbody>
              {norms.map((n) => (
                <tr key={n.id} className="hover:bg-gray-50">
                  <td className="p-2 border">{n.discipline}</td>
                  <td className="p-2 border font-mono text-xs">{n.work_type}</td>
                  <td className="p-2 border">{n.uom}</td>
                  <td className="p-2 border text-right">{n.mh_per_uom}</td>
                  <td className="p-2 border text-right">{n.crew_json?.crew_size || '-'}</td>
                  <td className="p-2 border text-right">${n.labor_rate}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {tab === 'areas' && (
        <div className="overflow-x-auto">
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="bg-gray-100">
                <th className="p-2 border text-left">Code</th>
                <th className="p-2 border text-left">Keywords</th>
                <th className="p-2 border text-right">Priority</th>
              </tr>
            </thead>
            <tbody>
              {areas.map((a) => (
                <tr key={a.id} className="hover:bg-gray-50">
                  <td className="p-2 border font-mono font-bold">{a.code}</td>
                  <td className="p-2 border text-xs">
                    {(a.keywords_json || []).join(', ') || '-'}
                  </td>
                  <td className="p-2 border text-right">{a.priority}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

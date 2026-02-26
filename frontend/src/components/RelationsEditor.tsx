import React, { useState } from 'react';
import api from '../api';

interface Activity {
  act_uid: string;
  act_id: string;
  name: string;
}

interface Relationship {
  id: string;
  pred_act_uid: string;
  succ_act_uid: string;
  rel_type: string;
  lag_hr: number;
}

interface Props {
  activities: Activity[];
  relationships: Relationship[];
  onRefresh: () => void;
}

export default function RelationsEditor({ activities, relationships, onRefresh }: Props) {
  const [predUid, setPredUid] = useState('');
  const [succUid, setSuccUid] = useState('');
  const [relType, setRelType] = useState('FS');
  const [lagHr, setLagHr] = useState('0');
  const [adding, setAdding] = useState(false);

  const actMap = new Map(activities.map((a) => [a.act_uid, a]));

  const handleAdd = async () => {
    if (!predUid || !succUid) return;
    setAdding(true);
    try {
      await api.post('/relationships', {
        pred_act_uid: predUid,
        succ_act_uid: succUid,
        rel_type: relType,
        lag_hr: parseFloat(lagHr) || 0,
      });
      setPredUid('');
      setSuccUid('');
      setLagHr('0');
      onRefresh();
    } catch {
      alert('Failed to add relationship');
    } finally {
      setAdding(false);
    }
  };

  return (
    <div className="mt-6">
      <h3 className="text-sm font-bold text-gray-700 mb-2">Relationships</h3>

      {/* Add form */}
      <div className="flex gap-2 items-end mb-4 flex-wrap">
        <div>
          <label className="text-xs text-gray-500 block">Predecessor</label>
          <select
            className="border rounded px-2 py-1 text-xs w-48"
            value={predUid}
            onChange={(e) => setPredUid(e.target.value)}
          >
            <option value="">Select...</option>
            {activities.map((a) => (
              <option key={a.act_uid} value={a.act_uid}>
                {a.act_id}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="text-xs text-gray-500 block">Successor</label>
          <select
            className="border rounded px-2 py-1 text-xs w-48"
            value={succUid}
            onChange={(e) => setSuccUid(e.target.value)}
          >
            <option value="">Select...</option>
            {activities.map((a) => (
              <option key={a.act_uid} value={a.act_uid}>
                {a.act_id}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="text-xs text-gray-500 block">Type</label>
          <select
            className="border rounded px-2 py-1 text-xs"
            value={relType}
            onChange={(e) => setRelType(e.target.value)}
          >
            <option>FS</option>
            <option>SS</option>
            <option>FF</option>
            <option>SF</option>
          </select>
        </div>
        <div>
          <label className="text-xs text-gray-500 block">Lag (hr)</label>
          <input
            className="border rounded px-2 py-1 text-xs w-16"
            value={lagHr}
            onChange={(e) => setLagHr(e.target.value)}
          />
        </div>
        <button
          onClick={handleAdd}
          disabled={adding}
          className="bg-indigo-600 text-white text-xs px-3 py-1.5 rounded hover:bg-indigo-500 disabled:opacity-50"
        >
          Add Link
        </button>
      </div>

      {/* Table */}
      <table className="w-full text-xs border-collapse">
        <thead>
          <tr className="bg-gray-50">
            <th className="p-1.5 border text-left">Predecessor</th>
            <th className="p-1.5 border text-left">Successor</th>
            <th className="p-1.5 border text-center">Type</th>
            <th className="p-1.5 border text-right">Lag (hr)</th>
          </tr>
        </thead>
        <tbody>
          {relationships.map((rel) => {
            const pred = actMap.get(rel.pred_act_uid);
            const succ = actMap.get(rel.succ_act_uid);
            return (
              <tr key={rel.id} className="hover:bg-gray-50">
                <td className="p-1.5 border font-mono">{pred?.act_id || rel.pred_act_uid}</td>
                <td className="p-1.5 border font-mono">{succ?.act_id || rel.succ_act_uid}</td>
                <td className="p-1.5 border text-center">{rel.rel_type}</td>
                <td className="p-1.5 border text-right">{rel.lag_hr}</td>
              </tr>
            );
          })}
          {relationships.length === 0 && (
            <tr>
              <td colSpan={4} className="p-4 text-center text-gray-400">
                No relationships yet
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

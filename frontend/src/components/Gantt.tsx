import React, { useState } from 'react';
import api from '../api';

interface Activity {
  id: string;
  act_uid: string;
  act_id: string;
  name: string;
  phase: string;
  area: string;
  discipline: string;
  package_code: string;
  dur_hr: number;
  mh: number;
  rom_cost: number;
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

export default function Gantt({ activities, relationships, onRefresh }: Props) {
  const [editingUid, setEditingUid] = useState<string | null>(null);
  const [editDur, setEditDur] = useState<string>('');

  const maxDur = Math.max(...activities.map((a) => a.dur_hr || 0), 1);

  // Group activities by phase
  const phases = ['ENG', 'PROC', 'CONST'];
  const grouped = phases.map((phase) => ({
    phase,
    items: activities.filter((a) => a.phase === phase),
  }));

  const saveDuration = async (actUid: string) => {
    try {
      await api.patch(`/activities/${actUid}`, { dur_hr: parseFloat(editDur) });
      setEditingUid(null);
      onRefresh();
    } catch {
      alert('Failed to update');
    }
  };

  // Build pred lookup for relationship display
  const predMap = new Map<string, string[]>();
  for (const rel of relationships) {
    const existing = predMap.get(rel.succ_act_uid) || [];
    // Find pred act_id
    const predAct = activities.find((a) => a.act_uid === rel.pred_act_uid);
    if (predAct) existing.push(predAct.act_id);
    predMap.set(rel.succ_act_uid, existing);
  }

  return (
    <div className="overflow-x-auto">
      {grouped.map((group) => (
        <div key={group.phase} className="mb-4">
          <h3 className="text-sm font-bold text-gray-700 bg-gray-100 px-3 py-1 rounded-t">
            {group.phase}
          </h3>
          <table className="w-full text-xs border-collapse">
            <thead>
              <tr className="bg-gray-50">
                <th className="p-1.5 border text-left w-32">Activity ID</th>
                <th className="p-1.5 border text-left w-48">Name</th>
                <th className="p-1.5 border text-right w-16">Dur (hr)</th>
                <th className="p-1.5 border text-right w-16">MH</th>
                <th className="p-1.5 border text-right w-20">ROM ($)</th>
                <th className="p-1.5 border text-left w-32">Predecessors</th>
                <th className="p-1.5 border text-left">Timeline</th>
              </tr>
            </thead>
            <tbody>
              {group.items.map((act) => {
                const barWidth = maxDur > 0 ? Math.max((act.dur_hr / maxDur) * 100, 2) : 2;
                const preds = predMap.get(act.act_uid) || [];
                return (
                  <tr key={act.act_uid} className="hover:bg-blue-50">
                    <td className="p-1.5 border font-mono">{act.act_id}</td>
                    <td className="p-1.5 border">{act.name}</td>
                    <td className="p-1.5 border text-right">
                      {editingUid === act.act_uid ? (
                        <span className="flex items-center gap-1 justify-end">
                          <input
                            className="w-14 border rounded px-1 text-right"
                            value={editDur}
                            onChange={(e) => setEditDur(e.target.value)}
                            onKeyDown={(e) => e.key === 'Enter' && saveDuration(act.act_uid)}
                            autoFocus
                          />
                          <button
                            onClick={() => saveDuration(act.act_uid)}
                            className="text-green-600 font-bold"
                          >
                            OK
                          </button>
                        </span>
                      ) : (
                        <span
                          className="cursor-pointer hover:text-indigo-600"
                          onClick={() => {
                            setEditingUid(act.act_uid);
                            setEditDur(String(act.dur_hr || 0));
                          }}
                        >
                          {act.dur_hr}
                        </span>
                      )}
                    </td>
                    <td className="p-1.5 border text-right">{act.mh?.toFixed(0) || 0}</td>
                    <td className="p-1.5 border text-right">
                      {act.rom_cost ? `$${act.rom_cost.toFixed(0)}` : '-'}
                    </td>
                    <td className="p-1.5 border text-xs text-gray-500">
                      {preds.length > 0 ? preds.join(', ') : '-'}
                    </td>
                    <td className="p-1.5 border">
                      <div className="relative h-4">
                        <div
                          className={`absolute top-0 left-0 h-full rounded ${
                            act.phase === 'ENG'
                              ? 'bg-blue-400'
                              : act.phase === 'PROC'
                              ? 'bg-amber-400'
                              : 'bg-green-500'
                          }`}
                          style={{ width: `${barWidth}%` }}
                        />
                      </div>
                    </td>
                  </tr>
                );
              })}
              {group.items.length === 0 && (
                <tr>
                  <td colSpan={7} className="p-4 text-center text-gray-400">
                    No activities in {group.phase}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      ))}
    </div>
  );
}

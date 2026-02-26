import React, { useState } from 'react';
import api from '../api';

interface BOQItem {
  id: string;
  code: string;
  description: string;
  qty: number;
  uom: string;
  area_raw: string;
  area_norm: string;
  discipline: string;
  work_type: string;
  package_code: string;
}

interface Props {
  items: BOQItem[];
  onRefresh: () => void;
}

export default function BOQTable({ items, onRefresh }: Props) {
  const [editing, setEditing] = useState<string | null>(null);
  const [editValues, setEditValues] = useState<Record<string, string>>({});

  const startEdit = (item: BOQItem) => {
    setEditing(item.id);
    setEditValues({
      area_norm: item.area_norm || '',
      discipline: item.discipline || '',
      work_type: item.work_type || '',
    });
  };

  const saveEdit = async (id: string) => {
    try {
      await api.patch(`/boq/${id}`, editValues);
      setEditing(null);
      onRefresh();
    } catch {
      alert('Failed to save');
    }
  };

  if (!items.length) {
    return <p className="text-gray-400 text-center py-8">No BOQ items. Upload a CSV/XLSX file.</p>;
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm border-collapse">
        <thead>
          <tr className="bg-gray-100 text-left">
            <th className="p-2 border">Code</th>
            <th className="p-2 border">Description</th>
            <th className="p-2 border text-right">Qty</th>
            <th className="p-2 border">UOM</th>
            <th className="p-2 border">Area</th>
            <th className="p-2 border">Discipline</th>
            <th className="p-2 border">Work Type</th>
            <th className="p-2 border">Package</th>
            <th className="p-2 border w-20">Actions</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => (
            <tr key={item.id} className="hover:bg-gray-50">
              <td className="p-2 border font-mono text-xs">{item.code}</td>
              <td className="p-2 border">{item.description}</td>
              <td className="p-2 border text-right">{item.qty}</td>
              <td className="p-2 border">{item.uom}</td>
              {editing === item.id ? (
                <>
                  <td className="p-1 border">
                    <input
                      className="w-full border rounded px-1 py-0.5 text-xs"
                      value={editValues.area_norm}
                      onChange={(e) => setEditValues({ ...editValues, area_norm: e.target.value })}
                    />
                  </td>
                  <td className="p-1 border">
                    <input
                      className="w-full border rounded px-1 py-0.5 text-xs"
                      value={editValues.discipline}
                      onChange={(e) => setEditValues({ ...editValues, discipline: e.target.value })}
                    />
                  </td>
                  <td className="p-1 border">
                    <input
                      className="w-full border rounded px-1 py-0.5 text-xs"
                      value={editValues.work_type}
                      onChange={(e) => setEditValues({ ...editValues, work_type: e.target.value })}
                    />
                  </td>
                  <td className="p-2 border">{item.package_code}</td>
                  <td className="p-1 border">
                    <button
                      onClick={() => saveEdit(item.id)}
                      className="text-xs bg-green-600 text-white px-2 py-0.5 rounded mr-1"
                    >
                      Save
                    </button>
                    <button
                      onClick={() => setEditing(null)}
                      className="text-xs text-gray-500"
                    >
                      Cancel
                    </button>
                  </td>
                </>
              ) : (
                <>
                  <td className="p-2 border">{item.area_norm || <span className="text-gray-300">-</span>}</td>
                  <td className="p-2 border">{item.discipline || <span className="text-gray-300">-</span>}</td>
                  <td className="p-2 border">{item.work_type || <span className="text-gray-300">-</span>}</td>
                  <td className="p-2 border font-mono text-xs">{item.package_code || '-'}</td>
                  <td className="p-2 border">
                    <button
                      onClick={() => startEdit(item)}
                      className="text-xs text-indigo-600 hover:underline"
                    >
                      Edit
                    </button>
                  </td>
                </>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

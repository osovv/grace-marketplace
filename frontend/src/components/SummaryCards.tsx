import React from 'react';

interface CardItem {
  label: string;
  value: string | number;
  color?: string;
}

export default function SummaryCards({ items }: { items: CardItem[] }) {
  const colors: Record<string, string> = {
    blue: 'bg-blue-50 border-blue-200 text-blue-800',
    green: 'bg-green-50 border-green-200 text-green-800',
    amber: 'bg-amber-50 border-amber-200 text-amber-800',
    red: 'bg-red-50 border-red-200 text-red-800',
    indigo: 'bg-indigo-50 border-indigo-200 text-indigo-800',
  };

  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-6">
      {items.map((item, i) => {
        const cls = colors[item.color || 'blue'] || colors.blue;
        return (
          <div key={i} className={`rounded-lg border p-4 ${cls}`}>
            <div className="text-xs uppercase tracking-wide opacity-70">{item.label}</div>
            <div className="text-2xl font-bold mt-1">{item.value}</div>
          </div>
        );
      })}
    </div>
  );
}

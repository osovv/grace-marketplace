import React, { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import api from '../api';
import BOQUpload from '../components/BOQUpload';
import BOQTable from '../components/BOQTable';
import SummaryCards from '../components/SummaryCards';

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

export default function ProjectBOQ() {
  const { id } = useParams<{ id: string }>();
  const [items, setItems] = useState<BOQItem[]>([]);
  const [projectName, setProjectName] = useState('');

  const load = async () => {
    const [boqRes, projRes] = await Promise.all([
      api.get(`/projects/${id}/boq`),
      api.get(`/projects/${id}`),
    ]);
    setItems(boqRes.data);
    setProjectName(projRes.data.name);
  };

  useEffect(() => {
    load();
  }, [id]);

  const classified = items.filter((i) => i.discipline && i.work_type).length;

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-xl font-bold">{projectName} - Bill of Quantities</h1>
          <Link to={`/projects/${id}/schedule`} className="text-sm text-indigo-600 hover:underline">
            Go to Schedule
          </Link>
        </div>
      </div>

      <SummaryCards
        items={[
          { label: 'Total Items', value: items.length, color: 'blue' },
          { label: 'Classified', value: classified, color: 'green' },
          { label: 'Unclassified', value: items.length - classified, color: 'amber' },
          {
            label: 'Classification %',
            value: items.length > 0 ? `${Math.round((classified / items.length) * 100)}%` : '0%',
            color: 'indigo',
          },
        ]}
      />

      <BOQUpload projectId={id!} onUploadComplete={load} />
      <BOQTable items={items} onRefresh={load} />
    </div>
  );
}

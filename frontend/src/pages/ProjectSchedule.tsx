import React, { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import api from '../api';
import SummaryCards from '../components/SummaryCards';
import Gantt from '../components/Gantt';
import RelationsEditor from '../components/RelationsEditor';

interface ScheduleData {
  wbs: any[];
  activities: any[];
  relationships: any[];
  total_mh: number;
  total_rom: number;
  total_dur_hr: number;
  warnings: string[];
}

export default function ProjectSchedule() {
  const { id } = useParams<{ id: string }>();
  const [schedule, setSchedule] = useState<ScheduleData | null>(null);
  const [projectName, setProjectName] = useState('');
  const [generating, setGenerating] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [showRelations, setShowRelations] = useState(false);
  const [message, setMessage] = useState('');

  const load = async () => {
    const [schedRes, projRes] = await Promise.all([
      api.get(`/projects/${id}/schedule`),
      api.get(`/projects/${id}`),
    ]);
    setSchedule(schedRes.data);
    setProjectName(projRes.data.name);
  };

  useEffect(() => {
    load();
  }, [id]);

  const handleGenerate = async () => {
    setGenerating(true);
    setMessage('');
    try {
      const { data } = await api.post(`/projects/${id}/schedule/generate`);
      setMessage(
        `Generated: ${data.activity_count} activities, ${data.wbs_count} WBS nodes. ${
          data.warnings?.length ? 'Warnings: ' + data.warnings.join('; ') : ''
        }`
      );
      load();
    } catch (err: any) {
      setMessage(err.response?.data?.detail || 'Generation failed');
    } finally {
      setGenerating(false);
    }
  };

  const handleExport = async () => {
    setExporting(true);
    try {
      const response = await api.get(`/projects/${id}/export/p6xml`, {
        responseType: 'blob',
      });
      const url = window.URL.createObjectURL(new Blob([response.data]));
      const link = document.createElement('a');
      link.href = url;
      link.setAttribute('download', `${projectName.replace(/\s+/g, '_')}_schedule.xml`);
      document.body.appendChild(link);
      link.click();
      link.remove();
    } catch (err: any) {
      alert(err.response?.data?.detail || 'Export failed');
    } finally {
      setExporting(false);
    }
  };

  const handleSaveBaseline = async () => {
    const label = prompt('Baseline label:', `Baseline ${new Date().toISOString().slice(0, 10)}`);
    if (!label) return;
    try {
      await api.post(`/projects/${id}/versions`, { label });
      alert('Baseline saved!');
    } catch {
      alert('Failed to save baseline');
    }
  };

  const acts = schedule?.activities || [];
  const rels = schedule?.relationships || [];

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-xl font-bold">{projectName} - Schedule</h1>
          <Link to={`/projects/${id}/boq`} className="text-sm text-indigo-600 hover:underline">
            Go to BOQ
          </Link>
        </div>
        <div className="flex gap-2">
          <button
            onClick={handleGenerate}
            disabled={generating}
            className="bg-indigo-600 text-white text-sm px-4 py-2 rounded-lg hover:bg-indigo-500 disabled:opacity-50"
          >
            {generating ? 'Generating...' : 'Generate Schedule'}
          </button>
          <button
            onClick={handleExport}
            disabled={exporting || acts.length === 0}
            className="bg-green-600 text-white text-sm px-4 py-2 rounded-lg hover:bg-green-500 disabled:opacity-50"
          >
            {exporting ? 'Exporting...' : 'Export P6XML'}
          </button>
          <button
            onClick={handleSaveBaseline}
            disabled={acts.length === 0}
            className="bg-gray-600 text-white text-sm px-4 py-2 rounded-lg hover:bg-gray-500 disabled:opacity-50"
          >
            Save Baseline
          </button>
        </div>
      </div>

      {message && (
        <div className="bg-blue-50 border border-blue-200 text-blue-800 rounded-lg p-3 mb-4 text-sm">
          {message}
        </div>
      )}

      {schedule && (
        <SummaryCards
          items={[
            { label: 'Activities', value: acts.length, color: 'blue' },
            { label: 'Total MH', value: Math.round(schedule.total_mh).toLocaleString(), color: 'green' },
            {
              label: 'Total ROM',
              value: `$${Math.round(schedule.total_rom).toLocaleString()}`,
              color: 'amber',
            },
            {
              label: 'Total Duration (hr)',
              value: Math.round(schedule.total_dur_hr).toLocaleString(),
              color: 'indigo',
            },
          ]}
        />
      )}

      {acts.length > 0 ? (
        <>
          <Gantt activities={acts} relationships={rels} onRefresh={load} />

          <div className="mt-4">
            <button
              onClick={() => setShowRelations(!showRelations)}
              className="text-sm text-indigo-600 hover:underline"
            >
              {showRelations ? 'Hide' : 'Show'} Relationships Editor ({rels.length} links)
            </button>
          </div>

          {showRelations && (
            <RelationsEditor activities={acts} relationships={rels} onRefresh={load} />
          )}
        </>
      ) : (
        <div className="text-center py-12 text-gray-400">
          <p>No schedule generated yet.</p>
          <p className="text-sm mt-1">Upload BOQ items first, then click "Generate Schedule".</p>
        </div>
      )}
    </div>
  );
}

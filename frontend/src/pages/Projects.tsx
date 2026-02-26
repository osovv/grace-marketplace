import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import api from '../api';

interface Project {
  id: string;
  name: string;
  calendar_code: string;
  created_at: string;
}

export default function Projects() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [newName, setNewName] = useState('');
  const [creating, setCreating] = useState(false);

  const load = () => api.get('/projects').then(({ data }) => setProjects(data));

  useEffect(() => {
    load();
  }, []);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newName.trim()) return;
    setCreating(true);
    try {
      await api.post('/projects', { name: newName });
      setNewName('');
      load();
    } catch {
      alert('Failed to create project');
    } finally {
      setCreating(false);
    }
  };

  return (
    <div>
      <h1 className="text-xl font-bold mb-4">Projects</h1>

      <form onSubmit={handleCreate} className="flex gap-2 mb-6">
        <input
          type="text"
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          placeholder="New project name"
          className="border rounded-lg px-3 py-2 flex-1"
        />
        <button
          type="submit"
          disabled={creating}
          className="bg-indigo-600 text-white px-4 py-2 rounded-lg hover:bg-indigo-500 disabled:opacity-50"
        >
          Create
        </button>
      </form>

      <div className="space-y-3">
        {projects.map((p) => (
          <div key={p.id} className="bg-white rounded-lg border p-4 flex items-center justify-between">
            <div>
              <h2 className="font-semibold">{p.name}</h2>
              <p className="text-xs text-gray-400">
                Created: {new Date(p.created_at).toLocaleDateString()}
              </p>
            </div>
            <div className="flex gap-2">
              <Link
                to={`/projects/${p.id}/boq`}
                className="text-xs bg-blue-50 text-blue-700 px-3 py-1.5 rounded hover:bg-blue-100"
              >
                BOQ
              </Link>
              <Link
                to={`/projects/${p.id}/schedule`}
                className="text-xs bg-green-50 text-green-700 px-3 py-1.5 rounded hover:bg-green-100"
              >
                Schedule
              </Link>
            </div>
          </div>
        ))}
        {projects.length === 0 && (
          <p className="text-gray-400 text-center py-8">No projects yet. Create one above.</p>
        )}
      </div>
    </div>
  );
}

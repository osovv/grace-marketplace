import React, { useRef, useState } from 'react';
import api from '../api';

interface Props {
  projectId: string;
  onUploadComplete: () => void;
}

export default function BOQUpload({ projectId, onUploadComplete }: Props) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [message, setMessage] = useState('');

  const handleUpload = async (file: File) => {
    setUploading(true);
    setMessage('');
    try {
      const form = new FormData();
      form.append('file', file);
      const { data } = await api.post(`/projects/${projectId}/boq/upload`, form);
      setMessage(`Uploaded ${data.length} items successfully.`);
      onUploadComplete();
    } catch (err: any) {
      setMessage(err.response?.data?.detail || 'Upload failed');
    } finally {
      setUploading(false);
    }
  };

  const onFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) handleUpload(file);
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (file) handleUpload(file);
  };

  return (
    <div className="mb-6">
      <div
        onDragOver={(e) => e.preventDefault()}
        onDrop={onDrop}
        onClick={() => fileRef.current?.click()}
        className="border-2 border-dashed border-gray-300 rounded-lg p-8 text-center cursor-pointer hover:border-indigo-400 hover:bg-indigo-50 transition"
      >
        <input
          ref={fileRef}
          type="file"
          accept=".csv,.xlsx"
          onChange={onFileChange}
          className="hidden"
        />
        {uploading ? (
          <p className="text-gray-500">Uploading...</p>
        ) : (
          <div>
            <p className="text-gray-600 font-medium">Drop CSV/XLSX file here or click to browse</p>
            <p className="text-xs text-gray-400 mt-1">Expected columns: code, description, qty, uom, area</p>
          </div>
        )}
      </div>
      {message && (
        <p className={`mt-2 text-sm ${message.includes('fail') ? 'text-red-600' : 'text-green-600'}`}>
          {message}
        </p>
      )}
    </div>
  );
}

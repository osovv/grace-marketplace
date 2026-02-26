import React from 'react';
import { Routes, Route, Navigate, Outlet } from 'react-router-dom';
import { useAuth } from './auth';
import Navbar from './components/Navbar';
import Login from './pages/Login';
import Tenants from './pages/Tenants';
import Projects from './pages/Projects';
import ProjectBOQ from './pages/ProjectBOQ';
import ProjectSchedule from './pages/ProjectSchedule';
import Library from './pages/Library';

function ProtectedLayout() {
  const { isAuthenticated, loading } = useAuth();
  if (loading) return <div className="p-8 text-center">Loading...</div>;
  if (!isAuthenticated) return <Navigate to="/login" />;
  return (
    <div className="min-h-screen">
      <Navbar />
      <main className="max-w-7xl mx-auto px-4 py-6">
        <Outlet />
      </main>
    </div>
  );
}

export function AppRoutes() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route element={<ProtectedLayout />}>
        <Route path="/" element={<Navigate to="/projects" />} />
        <Route path="/tenants" element={<Tenants />} />
        <Route path="/projects" element={<Projects />} />
        <Route path="/projects/:id/boq" element={<ProjectBOQ />} />
        <Route path="/projects/:id/schedule" element={<ProjectSchedule />} />
        <Route path="/library" element={<Library />} />
      </Route>
    </Routes>
  );
}

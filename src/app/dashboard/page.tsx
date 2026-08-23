import Dashboard from '@/components/Dashboard';

export default function DashboardPage() {
  return (
    <div className="w-full h-full relative">
      <div className="absolute inset-0 bg-gradient-to-br from-[#0d1117] via-[#161b22] to-[#0d1117] -z-10 opacity-80" />
      <Dashboard />
    </div>
  );
}

import React from 'react';
import { useNavigate } from 'react-router-dom';
import { Ship, ArrowLeft } from 'lucide-react';

export const NotFoundPage: React.FC = () => {
  const navigate = useNavigate();

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col items-center justify-center p-6 text-center">
      <div className="w-16 h-16 rounded-2xl bg-[#002B49] text-white flex items-center justify-center mb-4 shadow-md">
        <Ship className="w-8 h-8 text-[#ED1C24]" />
      </div>
      <h1 className="text-4xl font-extrabold text-slate-900 tracking-tight">404</h1>
      <h2 className="text-lg font-bold text-slate-800 mt-2">Page Not Found</h2>
      <p className="text-xs text-slate-500 max-w-sm mt-1 mb-6">
        The cargo claims or survey route you requested could not be located on the PIL platform.
      </p>
      <button
        type="button"
        onClick={() => navigate('/')}
        className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-xs font-semibold shadow-xs transition-colors cursor-pointer"
      >
        <ArrowLeft className="w-4 h-4" />
        Return to Landing (Queues)
      </button>
    </div>
  );
};

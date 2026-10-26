import React, { useState } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import {
  Inbox,
  LayoutDashboard,
  Users,
  LogOut,
  ChevronLeft,
  ChevronRight,
  Ship,
  Bell,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { StatusBadge } from './StatusBadge';

export const Sidebar: React.FC = () => {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [collapsed, setCollapsed] = useState(false);

  if (!user) return null;

  const isMidOrAdmin = ['mid', 'mid_gcc', 'admin'].includes(user.role);
  const isAdmin = user.role === 'admin';

  const handleSignOut = () => {
    logout();
    navigate('/login');
  };

  return (
    <aside
      className={`fixed top-0 left-0 bottom-0 bg-[#002B49] text-white flex flex-col transition-all duration-300 z-30 shadow-xl ${
        collapsed ? 'w-20' : 'w-64'
      }`}
    >
      {/* Brand Header */}
      <div className="h-16 flex items-center justify-between px-4 border-b border-blue-950/60 bg-[#001f35]">
        <div className="flex items-center gap-3 overflow-hidden">
          <div className="w-10 h-10 rounded-lg bg-[#ED1C24] flex items-center justify-center font-black text-white text-lg tracking-wider shadow-sm flex-shrink-0">
            PIL
          </div>
          {!collapsed && (
            <div className="truncate">
              <h1 className="font-bold text-sm tracking-wide text-white leading-tight">PIL Claims</h1>
              <p className="text-[10px] text-slate-300 tracking-wider uppercase">Cargo Claim Mgmt</p>
            </div>
          )}
        </div>
        <button
          type="button"
          onClick={() => setCollapsed(!collapsed)}
          className="p-1 rounded text-slate-400 hover:text-white hover:bg-white/10 cursor-pointer hidden md:flex"
        >
          {collapsed ? <ChevronRight className="w-4 h-4" /> : <ChevronLeft className="w-4 h-4" />}
        </button>
      </div>

      {/* Navigation Links */}
      <nav className="flex-1 py-4 px-3 space-y-1 overflow-y-auto">
        {/* Queues (All users) */}
        <NavLink
          to="/"
          end
          className={({ isActive }) =>
            `flex items-center gap-3 px-3 py-2.5 rounded-lg text-xs font-medium transition-colors ${
              isActive
                ? 'bg-blue-600 text-white shadow-sm'
                : 'text-slate-300 hover:bg-white/10 hover:text-white'
            }`
          }
          title={collapsed ? 'Queues' : undefined}
        >
          <Inbox className="w-4 h-4 flex-shrink-0" />
          {!collapsed && <span>Queues</span>}
        </NavLink>

        {/* Dashboard (MID/MID_GCC/Admin only) */}
        {isMidOrAdmin && (
          <NavLink
            to="/dashboard"
            className={({ isActive }) =>
              `flex items-center gap-3 px-3 py-2.5 rounded-lg text-xs font-medium transition-colors ${
                isActive
                  ? 'bg-blue-600 text-white shadow-sm'
                  : 'text-slate-300 hover:bg-white/10 hover:text-white'
              }`
            }
            title={collapsed ? 'Dashboard' : undefined}
          >
            <LayoutDashboard className="w-4 h-4 flex-shrink-0" />
            {!collapsed && <span>Dashboard</span>}
          </NavLink>
        )}

        {/* User Management (Admin only) */}
        {isAdmin && (
          <NavLink
            to="/users"
            className={({ isActive }) =>
              `flex items-center gap-3 px-3 py-2.5 rounded-lg text-xs font-medium transition-colors ${
                isActive
                  ? 'bg-blue-600 text-white shadow-sm'
                  : 'text-slate-300 hover:bg-white/10 hover:text-white'
              }`
            }
            title={collapsed ? 'User Management' : undefined}
          >
            <Users className="w-4 h-4 flex-shrink-0" />
            {!collapsed && <span>User Management</span>}
          </NavLink>
        )}
      </nav>

      {/* User Avatar & Logout */}
      <div className="p-3 border-t border-blue-950/60 bg-[#001f35]">
        <div className={`flex items-center gap-3 ${collapsed ? 'justify-center' : ''}`}>
          <div className="w-9 h-9 rounded-full bg-blue-700/80 border border-blue-400/30 flex items-center justify-center font-bold text-white text-xs flex-shrink-0">
            {user.full_name.charAt(0)}
          </div>
          {!collapsed && (
            <div className="flex-1 min-w-0">
              <p className="text-xs font-semibold text-white truncate">{user.full_name}</p>
              <div className="mt-0.5">
                <StatusBadge status={user.role} type="role" className="text-[10px] py-0 px-2" />
              </div>
            </div>
          )}
        </div>

        <button
          type="button"
          onClick={handleSignOut}
          className={`mt-3 w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-xs text-rose-300 hover:bg-rose-500/20 hover:text-rose-200 transition-colors cursor-pointer ${
            collapsed ? 'justify-center' : ''
          }`}
          title="Sign out"
        >
          <LogOut className="w-4 h-4 flex-shrink-0" />
          {!collapsed && <span>Sign out</span>}
        </button>
      </div>
    </aside>
  );
};

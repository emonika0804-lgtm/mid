import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Users, Search, ShieldAlert, Loader2, CheckCircle2 } from 'lucide-react';
import { api } from '../services/api';
import { useAuth } from '../context/AuthContext';
import { StatusBadge } from '../components/StatusBadge';

export const UserManagementPage: React.FC = () => {
  const { user, updateUserRole } = useAuth();
  const navigate = useNavigate();

  const [usersList, setUsersList] = useState<any[]>([]);
  const [search, setSearch] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const isAdmin = user?.role === 'admin';

  const loadUsers = async () => {
    setIsLoading(true);
    try {
      const data = await api.getUsers(search);
      setUsersList(data);
    } catch (err: any) {
      console.error('Failed to load users:', err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (isAdmin) {
      loadUsers();
    } else {
      setIsLoading(false);
    }
  }, [isAdmin]);

  const handleRoleChange = async (targetUser: any, newRole: string) => {
    if (!window.confirm(`Are you sure you want to change the role of ${targetUser.full_name} to ${newRole.toUpperCase()}?`)) {
      return;
    }

    setUpdatingId(targetUser.id);
    try {
      await api.updateUserRole(targetUser.id, newRole);

      setSuccessMessage(`Updated role for ${targetUser.full_name} to ${newRole.toUpperCase()}`);
      setTimeout(() => setSuccessMessage(null), 3500);

      // Section 11: If changing own role, page reloads after update
      if (targetUser.id === user?.id) {
        updateUserRole(newRole as any);
        alert('You have updated your own role. The application will now reload to apply revised permissions.');
        window.location.reload();
        return;
      }

      setUsersList((prev) =>
        prev.map((u) => (u.id === targetUser.id ? { ...u, role: newRole } : u))
      );
    } catch (err: any) {
      alert(`Failed to update user role: ${err.message || err}`);
    } finally {
      setUpdatingId(null);
    }
  };

  // Rule 18: Admin-only access
  if (!isAdmin) {
    return (
      <div className="min-h-[500px] flex flex-col items-center justify-center text-center p-6">
        <div className="w-14 h-14 rounded-full bg-rose-100 text-rose-600 flex items-center justify-center mb-4">
          <ShieldAlert className="w-8 h-8" />
        </div>
        <h2 className="text-xl font-bold text-slate-900">Access Denied</h2>
        <p className="text-sm text-slate-500 max-w-md mt-1 mb-6">
          User Management and Role Assignment are restricted to Administrator accounts.
        </p>
        <button
          type="button"
          onClick={() => navigate('/')}
          className="px-4 py-2 bg-blue-600 text-white rounded-lg text-xs font-semibold hover:bg-blue-700 cursor-pointer"
        >
          Return to Queues
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Title */}
      <div className="border-b border-slate-200 pb-4">
        <h1 className="text-2xl font-bold tracking-tight text-slate-900">User Management</h1>
        <p className="text-xs text-slate-500 mt-0.5">
          View users and assign roles — Agency, MID, MID (GCC), Admin
        </p>
      </div>

      {successMessage && (
        <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-lg text-xs text-emerald-800 flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4 text-emerald-600" />
          <span>{successMessage}</span>
        </div>
      )}

      {/* Search Toolbar */}
      <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-xs space-y-4">
        <div className="flex flex-col sm:flex-row items-center justify-between gap-3">
          <div className="relative w-full sm:w-80">
            <input
              type="text"
              placeholder="Search by full name or email..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && loadUsers()}
              className="w-full pl-9 pr-3 py-1.5 text-xs rounded-lg border border-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-2.5" />
          </div>

          <button
            type="button"
            onClick={loadUsers}
            className="px-3.5 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg text-xs font-medium cursor-pointer"
          >
            Search Users
          </button>
        </div>

        {/* Users Table */}
        <div className="overflow-x-auto rounded-lg border border-slate-200">
          <table className="w-full text-left text-xs text-slate-700">
            <thead className="bg-slate-50 text-[11px] font-semibold uppercase tracking-wider text-slate-500 border-b border-slate-200">
              <tr>
                <th className="py-3 px-4">User</th>
                <th className="py-3 px-4">Email</th>
                <th className="py-3 px-4">Current Role</th>
                <th className="py-3 px-4">Switch Role</th>
                <th className="py-3 px-4">Registered Date</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 bg-white">
              {isLoading ? (
                <tr>
                  <td colSpan={5} className="py-8 text-center text-slate-400">
                    <Loader2 className="w-5 h-5 animate-spin mx-auto text-blue-600 mb-1" />
                    Loading user directory...
                  </td>
                </tr>
              ) : usersList.length === 0 ? (
                <tr>
                  <td colSpan={5} className="py-8 text-center text-slate-400">
                    No users matching criteria.
                  </td>
                </tr>
              ) : (
                usersList.map((u) => {
                  const isCurrent = u.id === user?.id;
                  return (
                    <tr key={u.id} className="hover:bg-slate-50 transition-colors">
                      <td className="py-3 px-4">
                        <div className="flex items-center gap-2.5">
                          <div className="w-8 h-8 rounded-full bg-blue-100 text-blue-800 flex items-center justify-center font-bold text-xs">
                            {u.full_name?.charAt(0) || 'U'}
                          </div>
                          <div>
                            <span className="font-semibold text-slate-900 block">
                              {u.full_name}
                            </span>
                            {isCurrent && (
                              <span className="text-[10px] text-blue-600 font-semibold">(You)</span>
                            )}
                          </div>
                        </div>
                      </td>
                      <td className="py-3 px-4 text-slate-600 font-medium">{u.email}</td>
                      <td className="py-3 px-4">
                        <StatusBadge status={u.role} type="role" />
                      </td>
                      <td className="py-3 px-4">
                        <select
                          disabled={updatingId === u.id}
                          value={u.role}
                          onChange={(e) => handleRoleChange(u, e.target.value)}
                          className="rounded-lg border border-slate-200 px-2.5 py-1 text-xs bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50"
                        >
                          <option value="agency">Agency</option>
                          <option value="mid">MID</option>
                          <option value="mid_gcc">MID GCC</option>
                          <option value="admin">Admin</option>
                        </select>
                      </td>
                      <td className="py-3 px-4 text-slate-500">
                        {u.created_date ? new Date(u.created_date).toLocaleDateString() : '—'}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

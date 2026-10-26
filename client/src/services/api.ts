const getHeaders = () => {
  const token = localStorage.getItem('pil_token');
  return {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
};

export const api = {
  // LMS Lookup
  async lookupLMS(blNumber: string) {
    const res = await fetch(`/api/lms/lookup?bl_number=${encodeURIComponent(blNumber)}`, {
      headers: getHeaders(),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to fetch LMS data');
    return data;
  },

  // Currency Rates
  async getRates() {
    const res = await fetch('/api/rates', {
      headers: getHeaders(),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to fetch rates');
    return data;
  },

  // Claims
  async getClaims(search?: string, status?: string) {
    const params = new URLSearchParams();
    if (search) params.append('search', search);
    if (status && status !== 'all') params.append('status', status);

    const res = await fetch(`/api/claims?${params.toString()}`, {
      headers: getHeaders(),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to fetch claims');
    return data;
  },

  async getClaim(id: string) {
    const res = await fetch(`/api/claims/${id}`, {
      headers: getHeaders(),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to fetch claim');
    return data;
  },

  async createClaim(claimData: any) {
    const res = await fetch('/api/claims', {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify(claimData),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to create claim');
    return data;
  },

  async updateClaim(id: string, claimData: any) {
    const res = await fetch(`/api/claims/${id}`, {
      method: 'PUT',
      headers: getHeaders(),
      body: JSON.stringify(claimData),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to update claim');
    return data;
  },

  async deleteClaim(id: string) {
    const res = await fetch(`/api/claims/${id}`, {
      method: 'DELETE',
      headers: getHeaders(),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to delete claim');
    return data;
  },

  async getClaimAudit(id: string) {
    const res = await fetch(`/api/claims/${id}/audit`, {
      headers: getHeaders(),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to fetch audit log');
    return data;
  },

  // Surveys
  async getSurveys(search?: string, status?: string) {
    const params = new URLSearchParams();
    if (search) params.append('search', search);
    if (status && status !== 'all') params.append('status', status);

    const res = await fetch(`/api/surveys?${params.toString()}`, {
      headers: getHeaders(),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to fetch surveys');
    return data;
  },

  async getSurvey(id: string) {
    const res = await fetch(`/api/surveys/${id}`, {
      headers: getHeaders(),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to fetch survey');
    return data;
  },

  async createSurvey(surveyData: any) {
    const res = await fetch('/api/surveys', {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify(surveyData),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to create survey');
    return data;
  },

  async updateSurvey(id: string, surveyData: any) {
    const res = await fetch(`/api/surveys/${id}`, {
      method: 'PUT',
      headers: getHeaders(),
      body: JSON.stringify(surveyData),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to update survey');
    return data;
  },

  async convertSurveyToClaim(id: string) {
    const res = await fetch(`/api/surveys/${id}/convert-to-claim`, {
      method: 'POST',
      headers: getHeaders(),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to convert survey to claim');
    return data;
  },

  // Dashboard Metrics
  async getDashboardMetrics() {
    const res = await fetch('/api/dashboard/metrics', {
      headers: getHeaders(),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to fetch dashboard metrics');
    return data;
  },

  // Users
  async getUsers(search?: string) {
    const params = new URLSearchParams();
    if (search) params.append('search', search);
    const res = await fetch(`/api/users?${params.toString()}`, {
      headers: getHeaders(),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to fetch users');
    return data;
  },

  async updateUserRole(id: string, role: string) {
    const res = await fetch(`/api/users/${id}/role`, {
      method: 'PUT',
      headers: getHeaders(),
      body: JSON.stringify({ role }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to update role');
    return data;
  },

  // File Upload
  async uploadFile(file: File) {
    const token = localStorage.getItem('pil_token');
    const formData = new FormData();
    formData.append('file', file);

    const res = await fetch('/api/upload', {
      method: 'POST',
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      body: formData,
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to upload file');
    return data;
  },

  // Secure File Download (Authenticated)
  async downloadFile(fileUrl: string, originalFileName?: string): Promise<void> {
    const filename = fileUrl.split('/').pop() || '';
    const res = await fetch(`/api/files/${encodeURIComponent(filename)}`, {
      headers: getHeaders(),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || `Failed to download file (${res.status})`);
    }
    const blob = await res.blob();
    const downloadUrl = window.URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = downloadUrl;
    link.download = originalFileName || filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    window.URL.revokeObjectURL(downloadUrl);
  },

  // Notifications
  async getNotifications() {
    const res = await fetch('/api/notifications', {
      headers: getHeaders(),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to fetch notifications');
    return data;
  },

  async markNotificationRead(id: string) {
    const res = await fetch(`/api/notifications/${id}/read`, {
      method: 'PUT',
      headers: getHeaders(),
    });
    return res.json();
  },
};

const getHeaders = () => {
  const token = localStorage.getItem('pil_token');
  return {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
};

// Client-side cache & in-flight deduplication for exchange rates
let cachedRates: { data: any; timestamp: number } | null = null;
let inFlightRatesPromise: Promise<any> | null = null;
const RATES_CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes cache on client

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
  async getRates(forceRefresh = false) {
    const now = Date.now();
    if (!forceRefresh && cachedRates && (now - cachedRates.timestamp < RATES_CACHE_TTL_MS)) {
      return cachedRates.data;
    }

    if (!forceRefresh && inFlightRatesPromise) {
      return inFlightRatesPromise;
    }

    inFlightRatesPromise = (async () => {
      try {
        const res = await fetch('/api/rates', {
          headers: getHeaders(),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Failed to fetch rates');
        cachedRates = { data, timestamp: Date.now() };
        return data;
      } finally {
        inFlightRatesPromise = null;
      }
    })();

    return inFlightRatesPromise;
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

  async getSurveyAudit(id: string) {
    const res = await fetch(`/api/surveys/${id}/audit`, {
      headers: getHeaders(),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to fetch survey audit log');
    return data;
  },

  async deleteSurvey(id: string) {
    const res = await fetch(`/api/surveys/${id}`, {
      method: 'DELETE',
      headers: getHeaders(),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to delete survey');
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

  async markAllNotificationsRead() {
    const res = await fetch('/api/notifications/read-all', {
      method: 'PUT',
      headers: getHeaders(),
    });
    return res.json();
  },

  // Document Search & Management (Phase 4)
  async searchDocuments(params: {
    query?: string;
    bl_number?: string;
    claim_number?: string;
    survey_number?: string;
    cms_number?: string;
    document_type?: string;
    filename?: string;
    uploaded_by?: string;
    from_date?: string;
    to_date?: string;
    page?: number;
    limit?: number;
    sort_by?: string;
    sort_order?: 'ASC' | 'DESC';
  }) {
    const sp = new URLSearchParams();
    Object.entries(params).forEach(([k, v]) => {
      if (v !== undefined && v !== null && v !== '' && v !== 'all') {
        sp.append(k, String(v));
      }
    });
    const res = await fetch(`/api/attachments/search?${sp.toString()}`, {
      headers: getHeaders(),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to search documents');
    return data;
  },

  async getDocumentTypes(): Promise<string[]> {
    const res = await fetch('/api/attachments/types', {
      headers: getHeaders(),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to fetch document types');
    return data;
  },

  async getDocumentBlob(fileUrl: string): Promise<{ blob: Blob; mimeType: string }> {
    const filename = fileUrl.split('/').pop() || '';
    const res = await fetch(`/api/files/${encodeURIComponent(filename)}`, {
      headers: getHeaders(),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || `Failed to fetch document (${res.status})`);
    }
    const blob = await res.blob();
    const mimeType = res.headers.get('content-type') || 'application/octet-stream';
    return { blob, mimeType };
  },
};

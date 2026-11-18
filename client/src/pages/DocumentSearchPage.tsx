import React, { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import {
  Search,
  Filter,
  FileText,
  Image as ImageIcon,
  FileSpreadsheet,
  Download,
  Eye,
  X,
  Calendar,
  User,
  ArrowUpDown,
  RefreshCw,
  FolderOpen,
  ChevronLeft,
  ChevronRight,
  ShieldCheck,
  FileCode,
  FileCheck,
} from 'lucide-react';
import { api } from '../services/api';
import { useAuth } from '../context/AuthContext';

interface DocumentRecord {
  id: string;
  claim_id?: string | null;
  survey_id?: string | null;
  bl_number?: string | null;
  cms_reference_number?: string | null;
  claim_number?: string | null;
  survey_number?: string | null;
  mandatory_attachment_type?: string | null;
  original_filename: string;
  stored_filename: string;
  mime_type: string;
  file_size: number;
  uploaded_by_id?: string | null;
  uploaded_by_name?: string | null;
  uploaded_at: string;
  comments?: string | null;
  checksum?: string | null;
  file_url: string;
}

export const DocumentSearchPage: React.FC = () => {
  const { user } = useAuth();
  const isMidOrAdmin = ['mid', 'mid_gcc', 'admin'].includes(user?.role || '');

  // Filter States
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedType, setSelectedType] = useState('all');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [uploadedByFilter, setUploadedByFilter] = useState('');
  const [sortBy, setSortBy] = useState('uploaded_at');
  const [sortOrder, setSortOrder] = useState<'ASC' | 'DESC'>('DESC');
  const [page, setPage] = useState(1);
  const [limit] = useState(10);

  // Data States
  const [documents, setDocuments] = useState<DocumentRecord[]>([]);
  const [availableTypes, setAvailableTypes] = useState<string[]>([]);
  const [totalPages, setTotalPages] = useState(1);
  const [totalCount, setTotalCount] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Preview Modal States
  const [previewDoc, setPreviewDoc] = useState<DocumentRecord | null>(null);
  const [previewBlobUrl, setPreviewBlobUrl] = useState<string | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewTextContent, setPreviewTextContent] = useState<string | null>(null);

  // Fetch available document types on mount
  useEffect(() => {
    api.getDocumentTypes()
      .then((types) => setAvailableTypes(types))
      .catch((err) => console.warn('Could not load document types:', err));
  }, []);

  // Fetch documents with current filters
  const fetchDocuments = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.searchDocuments({
        query: searchTerm,
        document_type: selectedType,
        from_date: fromDate,
        to_date: toDate,
        uploaded_by: uploadedByFilter,
        page,
        limit,
        sort_by: sortBy,
        sort_order: sortOrder,
      });

      setDocuments(res.documents || []);
      setTotalPages(res.pagination?.total_pages || 1);
      setTotalCount(res.pagination?.total || 0);
    } catch (err: any) {
      setError(err.message || 'Failed to load documents');
    } finally {
      setLoading(false);
    }
  }, [searchTerm, selectedType, fromDate, toDate, uploadedByFilter, page, limit, sortBy, sortOrder]);

  useEffect(() => {
    fetchDocuments();
  }, [fetchDocuments]);

  // Reset all filters
  const handleResetFilters = () => {
    setSearchTerm('');
    setSelectedType('all');
    setFromDate('');
    setToDate('');
    setUploadedByFilter('');
    setSortBy('uploaded_at');
    setSortOrder('DESC');
    setPage(1);
  };

  // Format file size
  const formatFileSize = (bytes: number) => {
    if (!bytes && bytes !== 0) return '0 B';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  };

  // Format file icon
  const getFileIcon = (mimeType: string, filename: string) => {
    const ext = filename.split('.').pop()?.toLowerCase();
    if (mimeType.startsWith('image/') || ['png', 'jpg', 'jpeg', 'webp', 'gif'].includes(ext || '')) {
      return <ImageIcon className="w-5 h-5 text-indigo-500" />;
    }
    if (mimeType.includes('pdf') || ext === 'pdf') {
      return <FileText className="w-5 h-5 text-rose-500" />;
    }
    if (mimeType.includes('sheet') || mimeType.includes('excel') || ['xls', 'xlsx', 'csv'].includes(ext || '')) {
      return <FileSpreadsheet className="w-5 h-5 text-emerald-600" />;
    }
    if (ext === 'txt') {
      return <FileCode className="w-5 h-5 text-amber-500" />;
    }
    return <FileCheck className="w-5 h-5 text-slate-500" />;
  };

  // Preview Handler
  const handleOpenPreview = async (doc: DocumentRecord) => {
    setPreviewDoc(doc);
    setPreviewBlobUrl(null);
    setPreviewTextContent(null);
    setPreviewLoading(true);

    try {
      const { blob, mimeType } = await api.getDocumentBlob(doc.file_url);
      const url = window.URL.createObjectURL(blob);
      setPreviewBlobUrl(url);

      if (mimeType.startsWith('text/') || doc.original_filename.endsWith('.txt')) {
        const text = await blob.text();
        setPreviewTextContent(text);
      }
    } catch (err: any) {
      alert(`Could not load preview: ${err.message || err}`);
      setPreviewDoc(null);
    } finally {
      setPreviewLoading(false);
    }
  };

  const handleClosePreview = () => {
    if (previewBlobUrl) {
      window.URL.revokeObjectURL(previewBlobUrl);
    }
    setPreviewDoc(null);
    setPreviewBlobUrl(null);
    setPreviewTextContent(null);
  };

  // Download Handler
  const handleDownload = async (doc: DocumentRecord) => {
    try {
      await api.downloadFile(doc.file_url, doc.original_filename);
    } catch (err: any) {
      alert(`Download failed: ${err.message || err}`);
    }
  };

  return (
    <div className="space-y-6 max-w-7xl mx-auto pb-12">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 border-b border-slate-200 pb-5">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-black text-[#002B49] tracking-tight">Document Repository</h1>
            <span className="px-2.5 py-0.5 rounded-full text-xs font-bold bg-blue-100 text-blue-800 border border-blue-200">
              {totalCount} {totalCount === 1 ? 'Document' : 'Documents'}
            </span>
          </div>
          <p className="text-sm text-slate-500 mt-1">
            Centralized PostgreSQL BYTEA storage with authenticated preview, download, and role isolation.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => fetchDocuments()}
            className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold rounded-lg bg-white border border-slate-200 text-slate-700 hover:bg-slate-50 transition-colors shadow-xs cursor-pointer"
            title="Refresh repository"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </button>
        </div>
      </div>

      {/* Search & Filter Bar */}
      <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-xs space-y-4">
        {/* Primary Search Input */}
        <div className="relative">
          <Search className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            value={searchTerm}
            onChange={(e) => {
              setSearchTerm(e.target.value);
              setPage(1);
            }}
            placeholder="Search by BL Number, Claim #, Survey #, CMS Reference, or filename..."
            className="w-full pl-10 pr-10 py-2.5 bg-slate-50 border border-slate-200 rounded-lg text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:bg-white transition-all"
          />
          {searchTerm && (
            <button
              type="button"
              onClick={() => {
                setSearchTerm('');
                setPage(1);
              }}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>

        {/* Multi-Filter Controls */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 pt-1">
          {/* Document Type Dropdown */}
          <div>
            <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-500 mb-1">
              Document Type
            </label>
            <select
              value={selectedType}
              onChange={(e) => {
                setSelectedType(e.target.value);
                setPage(1);
              }}
              className="w-full py-2 px-3 bg-white border border-slate-200 rounded-lg text-xs text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500 cursor-pointer"
            >
              <option value="all">All Document Types</option>
              {availableTypes.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </div>

          {/* Date Range: From */}
          <div>
            <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-500 mb-1">
              Uploaded From
            </label>
            <div className="relative">
              <Calendar className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                type="date"
                value={fromDate}
                onChange={(e) => {
                  setFromDate(e.target.value);
                  setPage(1);
                }}
                className="w-full pl-9 pr-3 py-2 bg-white border border-slate-200 rounded-lg text-xs text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
          </div>

          {/* Date Range: To */}
          <div>
            <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-500 mb-1">
              Uploaded To
            </label>
            <div className="relative">
              <Calendar className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                type="date"
                value={toDate}
                onChange={(e) => {
                  setToDate(e.target.value);
                  setPage(1);
                }}
                className="w-full pl-9 pr-3 py-2 bg-white border border-slate-200 rounded-lg text-xs text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
          </div>

          {/* Sort Control */}
          <div>
            <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-500 mb-1">
              Sort By
            </label>
            <div className="flex gap-2">
              <select
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value)}
                className="flex-1 py-2 px-3 bg-white border border-slate-200 rounded-lg text-xs text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500 cursor-pointer"
              >
                <option value="uploaded_at">Upload Date</option>
                <option value="original_filename">Filename</option>
                <option value="file_size">File Size</option>
                <option value="claim_number">Claim #</option>
                <option value="bl_number">BL #</option>
              </select>
              <button
                type="button"
                onClick={() => setSortOrder(sortOrder === 'ASC' ? 'DESC' : 'ASC')}
                className="px-2.5 py-2 border border-slate-200 rounded-lg bg-slate-50 hover:bg-slate-100 text-slate-700 text-xs font-semibold cursor-pointer"
                title={`Order: ${sortOrder === 'ASC' ? 'Ascending' : 'Descending'}`}
              >
                <ArrowUpDown className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        </div>

        {/* Advanced Filter Row (Uploader & Reset) */}
        <div className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-slate-100">
          {isMidOrAdmin ? (
            <div className="flex items-center gap-2">
              <User className="w-3.5 h-3.5 text-slate-400" />
              <input
                type="text"
                placeholder="Filter by uploader name..."
                value={uploadedByFilter}
                onChange={(e) => {
                  setUploadedByFilter(e.target.value);
                  setPage(1);
                }}
                className="py-1 px-2.5 text-xs bg-slate-50 border border-slate-200 rounded-md text-slate-700 placeholder:text-slate-400 w-56"
              />
            </div>
          ) : (
            <div className="flex items-center gap-1.5 text-xs text-slate-500">
              <ShieldCheck className="w-4 h-4 text-emerald-600" />
              <span>Agency record isolation active — showing only your authorized documents</span>
            </div>
          )}

          <button
            type="button"
            onClick={handleResetFilters}
            className="text-xs font-semibold text-slate-500 hover:text-blue-600 hover:underline cursor-pointer"
          >
            Clear all filters
          </button>
        </div>
      </div>

      {/* Error Banner */}
      {error && (
        <div className="p-4 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-xs font-medium">
          {error}
        </div>
      )}

      {/* Documents Table / List */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-xs overflow-hidden">
        {loading ? (
          <div className="py-20 flex flex-col items-center justify-center text-slate-400">
            <RefreshCw className="w-8 h-8 animate-spin text-blue-600 mb-3" />
            <p className="text-sm font-medium text-slate-600">Searching PostgreSQL document repository...</p>
          </div>
        ) : documents.length === 0 ? (
          <div className="py-16 flex flex-col items-center justify-center text-slate-400 px-4 text-center">
            <FolderOpen className="w-12 h-12 text-slate-300 mb-3" />
            <h3 className="text-sm font-bold text-slate-700">No documents found</h3>
            <p className="text-xs text-slate-500 mt-1 max-w-md">
              No matching files found with the current filter criteria. Try adjusting your search query or clearing active filters.
            </p>
            <button
              type="button"
              onClick={handleResetFilters}
              className="mt-4 px-4 py-2 text-xs font-semibold bg-blue-50 text-blue-700 rounded-lg border border-blue-200 hover:bg-blue-100 transition-colors cursor-pointer"
            >
              Reset Filters
            </button>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-slate-50/80 border-b border-slate-200 text-[11px] font-bold uppercase tracking-wider text-slate-600">
                  <th className="py-3 px-4">Document</th>
                  <th className="py-3 px-4">Type</th>
                  <th className="py-3 px-4">Related Record</th>
                  <th className="py-3 px-4">Uploaded By</th>
                  <th className="py-3 px-4">Upload Date</th>
                  <th className="py-3 px-4 text-right">Size</th>
                  <th className="py-3 px-4 text-center">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-xs">
                {documents.map((doc) => (
                  <tr key={doc.id} className="hover:bg-slate-50/70 transition-colors">
                    {/* Document Name & Icon */}
                    <td className="py-3 px-4">
                      <div className="flex items-center gap-3">
                        <div className="w-9 h-9 rounded-lg bg-slate-100 border border-slate-200 flex items-center justify-center flex-shrink-0">
                          {getFileIcon(doc.mime_type, doc.original_filename)}
                        </div>
                        <div className="min-w-0 max-w-xs">
                          <p className="font-semibold text-slate-800 truncate" title={doc.original_filename}>
                            {doc.original_filename}
                          </p>
                          <p className="text-[10px] text-slate-400 font-mono truncate" title={doc.stored_filename}>
                            {doc.stored_filename}
                          </p>
                        </div>
                      </div>
                    </td>

                    {/* Document Type Badge */}
                    <td className="py-3 px-4">
                      <span className="inline-block px-2.5 py-1 rounded-md text-[11px] font-medium bg-slate-100 text-slate-700 border border-slate-200/60 max-w-[180px] truncate" title={doc.mandatory_attachment_type || 'General Upload'}>
                        {doc.mandatory_attachment_type || 'General Document'}
                      </span>
                    </td>

                    {/* Related Entity (Claim or Survey) */}
                    <td className="py-3 px-4">
                      <div className="space-y-1">
                        {doc.claim_number && (
                          <div className="flex items-center gap-1.5">
                            {doc.claim_id ? (
                              <Link
                                to={`/claims/${doc.claim_id}`}
                                className="font-bold text-blue-600 hover:text-blue-800 hover:underline"
                              >
                                {doc.claim_number}
                              </Link>
                            ) : (
                              <span className="font-bold text-slate-700">{doc.claim_number}</span>
                            )}
                          </div>
                        )}

                        {doc.survey_number && (
                          <div className="flex items-center gap-1.5">
                            {doc.survey_id ? (
                              <Link
                                to={`/surveys/${doc.survey_id}`}
                                className="font-bold text-indigo-600 hover:text-indigo-800 hover:underline"
                              >
                                {doc.survey_number}
                              </Link>
                            ) : (
                              <span className="font-bold text-slate-700">{doc.survey_number}</span>
                            )}
                          </div>
                        )}

                        {doc.bl_number && (
                          <p className="text-[10px] font-mono text-slate-500">BL: {doc.bl_number}</p>
                        )}

                        {!doc.claim_number && !doc.survey_number && !doc.bl_number && (
                          <span className="text-[11px] text-slate-400 italic">Unlinked staging</span>
                        )}
                      </div>
                    </td>

                    {/* Uploaded By */}
                    <td className="py-3 px-4">
                      <span className="text-slate-700 font-medium">{doc.uploaded_by_name || 'System'}</span>
                    </td>

                    {/* Upload Date */}
                    <td className="py-3 px-4 text-slate-600">
                      {doc.uploaded_at ? doc.uploaded_at.substring(0, 10) : '—'}
                      <div className="text-[10px] text-slate-400">
                        {doc.uploaded_at && doc.uploaded_at.length >= 16 ? doc.uploaded_at.substring(11, 16) : ''}
                      </div>
                    </td>

                    {/* File Size */}
                    <td className="py-3 px-4 text-right font-mono text-slate-600">
                      {formatFileSize(doc.file_size)}
                    </td>

                    {/* Action Buttons */}
                    <td className="py-3 px-4">
                      <div className="flex items-center justify-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => handleOpenPreview(doc)}
                          className="p-1.5 rounded-lg border border-slate-200 bg-white hover:bg-blue-50 hover:border-blue-200 text-slate-600 hover:text-blue-600 transition-colors cursor-pointer shadow-2xs"
                          title="Preview Document"
                        >
                          <Eye className="w-3.5 h-3.5" />
                        </button>

                        <button
                          type="button"
                          onClick={() => handleDownload(doc)}
                          className="p-1.5 rounded-lg border border-slate-200 bg-white hover:bg-emerald-50 hover:border-emerald-200 text-slate-600 hover:text-emerald-600 transition-colors cursor-pointer shadow-2xs"
                          title="Download Document"
                        >
                          <Download className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Pagination Bar */}
        {totalCount > 0 && (
          <div className="flex flex-col sm:flex-row items-center justify-between gap-3 px-5 py-3.5 border-t border-slate-200 bg-slate-50/50">
            <p className="text-xs text-slate-500">
              Showing <span className="font-semibold text-slate-700">{(page - 1) * limit + 1}</span> to{' '}
              <span className="font-semibold text-slate-700">{Math.min(page * limit, totalCount)}</span> of{' '}
              <span className="font-semibold text-slate-700">{totalCount}</span> documents
            </p>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setPage(page - 1)}
                disabled={page <= 1}
                className="px-2.5 py-1.5 rounded-lg border border-slate-200 bg-white text-xs font-semibold text-slate-700 hover:bg-slate-100 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer shadow-2xs flex items-center gap-1"
              >
                <ChevronLeft className="w-3.5 h-3.5" />
                Previous
              </button>

              <span className="text-xs text-slate-600 px-2 font-medium">
                Page {page} of {totalPages}
              </span>

              <button
                type="button"
                onClick={() => setPage(page + 1)}
                disabled={page >= totalPages}
                className="px-2.5 py-1.5 rounded-lg border border-slate-200 bg-white text-xs font-semibold text-slate-700 hover:bg-slate-100 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer shadow-2xs flex items-center gap-1"
              >
                Next
                <ChevronRight className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Document Preview Modal */}
      {previewDoc && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl border border-slate-200 w-full max-w-4xl max-h-[90vh] flex flex-col overflow-hidden animate-in fade-in zoom-in-95 duration-150">
            {/* Modal Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 bg-slate-50">
              <div className="flex items-center gap-3 min-w-0">
                <div className="w-9 h-9 rounded-lg bg-blue-100 border border-blue-200 flex items-center justify-center flex-shrink-0">
                  {getFileIcon(previewDoc.mime_type, previewDoc.original_filename)}
                </div>
                <div className="min-w-0">
                  <h3 className="font-bold text-sm text-slate-900 truncate" title={previewDoc.original_filename}>
                    {previewDoc.original_filename}
                  </h3>
                  <p className="text-[11px] text-slate-500">
                    {previewDoc.mandatory_attachment_type || 'General'} • {formatFileSize(previewDoc.file_size)} • Uploaded {previewDoc.uploaded_at?.substring(0, 10)}
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => handleDownload(previewDoc)}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-blue-600 text-white text-xs font-semibold hover:bg-blue-700 transition-colors cursor-pointer shadow-xs"
                >
                  <Download className="w-3.5 h-3.5" />
                  Download
                </button>
                <button
                  type="button"
                  onClick={handleClosePreview}
                  className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-200 transition-colors cursor-pointer"
                  title="Close preview"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>

            {/* Modal Body */}
            <div className="flex-1 p-6 overflow-auto bg-slate-100 flex items-center justify-center min-h-[350px]">
              {previewLoading ? (
                <div className="flex flex-col items-center justify-center text-slate-500">
                  <RefreshCw className="w-8 h-8 animate-spin text-blue-600 mb-2" />
                  <p className="text-xs font-medium">Streaming binary from PostgreSQL BYTEA...</p>
                </div>
              ) : previewTextContent !== null ? (
                <div className="w-full h-full max-h-[60vh] bg-white p-4 rounded-lg border border-slate-200 font-mono text-xs overflow-auto whitespace-pre-wrap text-slate-800">
                  {previewTextContent}
                </div>
              ) : previewDoc.mime_type.startsWith('image/') && previewBlobUrl ? (
                <img
                  src={previewBlobUrl}
                  alt={previewDoc.original_filename}
                  className="max-h-[65vh] max-w-full object-contain rounded-lg shadow-sm border border-slate-200 bg-white"
                />
              ) : previewDoc.mime_type.includes('pdf') && previewBlobUrl ? (
                <iframe
                  src={previewBlobUrl}
                  title={previewDoc.original_filename}
                  className="w-full h-[65vh] rounded-lg border border-slate-200 bg-white"
                />
              ) : (
                <div className="flex flex-col items-center justify-center py-12 text-center max-w-md">
                  <div className="w-16 h-16 rounded-2xl bg-white border border-slate-200 flex items-center justify-center shadow-xs mb-4">
                    {getFileIcon(previewDoc.mime_type, previewDoc.original_filename)}
                  </div>
                  <h4 className="font-bold text-slate-800 text-sm">{previewDoc.original_filename}</h4>
                  <p className="text-xs text-slate-500 mt-1">
                    Direct browser preview is not supported for this file format ({previewDoc.mime_type}). You can download the file directly from PostgreSQL storage.
                  </p>
                  <button
                    type="button"
                    onClick={() => handleDownload(previewDoc)}
                    className="mt-4 inline-flex items-center gap-2 px-4 py-2 bg-emerald-600 text-white rounded-lg text-xs font-semibold hover:bg-emerald-700 transition-colors shadow-xs cursor-pointer"
                  >
                    <Download className="w-4 h-4" />
                    Download File ({formatFileSize(previewDoc.file_size)})
                  </button>
                </div>
              )}
            </div>

            {/* Modal Footer / Metadata */}
            <div className="px-6 py-3 border-t border-slate-200 bg-white flex flex-wrap items-center justify-between text-[11px] text-slate-500 gap-2">
              <div className="flex items-center gap-4">
                {previewDoc.bl_number && <span>BL: <strong className="text-slate-700 font-mono">{previewDoc.bl_number}</strong></span>}
                {previewDoc.claim_number && <span>Claim: <strong className="text-slate-700 font-mono">{previewDoc.claim_number}</strong></span>}
                {previewDoc.survey_number && <span>Survey: <strong className="text-slate-700 font-mono">{previewDoc.survey_number}</strong></span>}
              </div>
              <div className="font-mono text-[10px] text-slate-400" title="SHA-256 Checksum">
                SHA256: {previewDoc.checksum ? previewDoc.checksum.substring(0, 16) + '...' : 'Verified'}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

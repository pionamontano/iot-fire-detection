import React, { useState } from 'react';
import { supabase } from '../lib/supabase';
import { X, Send, AlertTriangle, CheckCircle2 } from 'lucide-react';

interface AdminSupportModalProps {
  isOpen: boolean;
  onClose: () => void;
  profile: any;
  userEmail?: string | null;
}

const CATEGORIES = [
  "Role Change",
  "Password Reset",
  "Station Assignment",
  "Account Access / Permissions",
  "Other"
];

export const AdminSupportModal: React.FC<AdminSupportModalProps> = ({ isOpen, onClose, profile, userEmail }) => {
  const [category, setCategory] = useState(CATEGORIES[0]);
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [successMsg, setSuccessMsg] = useState('');

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!message.trim()) {
      setErrorMsg('Please enter a message describing your request.');
      return;
    }

    setLoading(true);
    setErrorMsg('');
    setSuccessMsg('');

    try {
      const { data, error } = await supabase.functions.invoke('admin-support-request', {
        body: { category, message: message.trim() }
      });

      if (error) {
        throw error;
      }

      if (data && data.error) {
        throw new Error(data.error);
      }

      setSuccessMsg('Support request sent to the administrator. We will review your account shortly.');

      // Auto close after showing success for a brief moment
      setTimeout(() => {
        handleClose();
      }, 3000);

    } catch (err: any) {
      console.error('Support request error:', err);
      setErrorMsg(err.message || 'An error occurred while sending the request.');
    } finally {
      setLoading(false);
    }
  };

  const handleClose = () => {
    // Reset state and close
    setCategory(CATEGORIES[0]);
    setMessage('');
    setErrorMsg('');
    setSuccessMsg('');
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
      <div className="bg-surface border border-border w-full max-w-lg rounded-xl shadow-2xl flex flex-col max-h-[90vh]">

        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-border bg-surface-alt rounded-t-xl">
          <h2 className="text-lg font-black tracking-tight text-text-heading flex items-center gap-2">
            Contact System Administrator
          </h2>
          <button
            onClick={handleClose}
            className="p-2 text-text-faint hover:text-text hover:bg-surface-card rounded-md transition-colors disabled:opacity-50"
            disabled={loading && !successMsg}
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 overflow-y-auto">
          {successMsg ? (
            <div className="flex flex-col items-center justify-center py-8 text-center gap-4">
              <div className="w-16 h-16 bg-success-dark/20 rounded-full flex items-center justify-center text-success-dark">
                <CheckCircle2 className="w-8 h-8" />
              </div>
              <div className="space-y-1">
                <h3 className="text-lg font-bold text-text-heading">Request Sent Successfully</h3>
                <p className="text-sm text-text-body">{successMsg}</p>
              </div>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="flex flex-col gap-6">

              {errorMsg && (
                <div className="flex items-center gap-2 p-3 text-sm font-bold text-[#DC2626] bg-[#DC2626]/10 border border-[#DC2626]/20 rounded-lg">
                  <AlertTriangle className="w-4 h-4 flex-shrink-0" />
                  <span>{errorMsg}</span>
                </div>
              )}

              {/* Read-Only Info Box */}
              <div className="bg-surface-alt border border-border rounded-lg p-4 grid grid-cols-2 gap-4">
                <div>
                  <span className="block text-[10px] font-bold uppercase tracking-wider text-text-faint mb-1">User ID</span>
                  <span className="text-xs font-mono text-text-body break-all">{profile.id}</span>
                </div>
                <div>
                  <span className="block text-[10px] font-bold uppercase tracking-wider text-text-faint mb-1">Role</span>
                  <span className="text-sm font-bold text-text-heading capitalize">{profile.role?.replace('_', ' ')}</span>
                </div>
                <div className="col-span-2">
                  <span className="block text-[10px] font-bold uppercase tracking-wider text-text-faint mb-1">Contact / Email</span>
                  <span className="text-sm font-medium text-text-body">
                    {userEmail || 'No email'} {profile.contact_number ? `• ${profile.contact_number}` : ''}
                  </span>
                </div>
              </div>

              {/* Form Fields */}
              <div className="space-y-4">
                <div>
                  <label className="block text-xs font-bold text-text-body mb-1.5 uppercase tracking-[0.1em]">
                    Category / Reason
                  </label>
                  <select
                    value={category}
                    onChange={(e) => setCategory(e.target.value)}
                    disabled={loading}
                    className="w-full px-4 py-3 bg-surface-alt border border-border rounded-md text-sm text-text focus:border-primary focus:ring-1 focus:ring-primary/30 transition-all outline-none"
                  >
                    {CATEGORIES.map(cat => (
                      <option key={cat} value={cat}>{cat}</option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-bold text-text-body mb-1.5 uppercase tracking-[0.1em]">
                    Message <span className="text-primary">*</span>
                  </label>
                  <textarea
                    required
                    value={message}
                    onChange={(e) => setMessage(e.target.value)}
                    disabled={loading}
                    placeholder="Describe what you need help with..."
                    rows={4}
                    className="w-full px-4 py-3 bg-surface-alt border border-border rounded-md text-sm text-text placeholder-text-faint focus:border-primary focus:ring-1 focus:ring-primary/30 transition-all outline-none resize-none"
                  />
                </div>
              </div>

              {/* Actions */}
              <div className="flex gap-3 pt-2 justify-end border-t border-border mt-2">
                <button
                  type="button"
                  onClick={handleClose}
                  disabled={loading}
                  className="px-5 py-2.5 text-sm font-bold text-text-body hover:text-text transition-colors disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={loading || !message.trim()}
                  className="px-6 py-2.5 bg-primary text-white text-sm font-bold rounded-lg hover:bg-primary-dark transition-colors disabled:opacity-50 flex items-center gap-2"
                >
                  {loading ? (
                    <span className="flex items-center gap-2">
                      <svg className="animate-spin -ml-1 mr-2 h-4 w-4 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                      </svg>
                      Sending...
                    </span>
                  ) : (
                    <>
                      <Send className="w-4 h-4" />
                      Send Request
                    </>
                  )}
                </button>
              </div>

            </form>
          )}
        </div>
      </div>
    </div>
  );
};

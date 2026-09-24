import React, { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { ArrowLeft, User, Mail, Lock, Phone, MapPin, MonitorSmartphone, AlertCircle, Loader2 } from 'lucide-react';
import { AuthHero } from '../components/AuthHero';

export const RegisterResident = () => {
  const [formData, setFormData] = useState({
    fullName: '',
    email: '',
    password: '',
    confirmPassword: '',
    contactNumber: '',
    address: '',
    deviceCode: '',
  });
  
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  const handlePhoneChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value.replace(/\D/g, '').slice(0, 11);
    setFormData({ ...formData, contactNumber: value });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      if (formData.password !== formData.confirmPassword) {
        throw new Error("Passwords do not match");
      }

      if (formData.contactNumber && !/^09\d{9}$/.test(formData.contactNumber)) {
        throw new Error("Invalid phone format. Must be 11 digits starting with 09");
      }

      const { data, error: registerError } = await supabase.functions.invoke('register', {
        body: {
          full_name: formData.fullName,
          email: formData.email,
          password: formData.password,
          contact_number: formData.contactNumber,
          address: formData.address,
          device_code: formData.deviceCode,
          requested_role: 'resident',
        }
      });

      if (registerError) {
        // Try to parse the actual error message from the edge function
        if (registerError.context && typeof registerError.context.json === 'function') {
          try {
            const errData = await registerError.context.json();
            throw new Error(errData.error || "Registration failed. Please try again.");
          } catch (e) {
            // Ignore parse error and fall through
          }
        }
        throw new Error(registerError.message);
      }
      if (data?.error) throw new Error(data.error);

      // Registration successful, navigate to pending approval
      navigate('/pending-approval', {
        state: { deviceCodeUnrecognized: data?.device_code_recognized === false }
      });
    } catch (err: any) {
      setError(err.message || "An unexpected error occurred during registration.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen relative flex flex-col items-center justify-center p-4 lg:p-8 font-['Inter',_sans-serif] overflow-x-hidden">
      {/* Background Image */}
      <div 
        className="fixed inset-0 z-0 bg-cover bg-center bg-no-repeat"
        style={{ 
          backgroundImage: 'url(/login_bg.png)',
          filter: 'blur(8px)',
          transform: 'scale(1.05)'
        }}
      />
      {/* Dark Overlay */}
      <div className="fixed inset-0 z-0 bg-[#4D2120]/70 mix-blend-multiply" />
      <div className="fixed inset-0 z-0 bg-black/30" />

      {/* Main Content Container */}
      <div className="relative z-10 w-full max-w-xl flex flex-col items-center my-8">
        
        {/* Header / Logo */}
        <div className="flex flex-col items-center text-center mb-8">
          <div className="flex items-center gap-3 mb-6">
            <svg width="28" height="35" viewBox="0 0 24 30" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M12 0C12 0 4 8 4 16C4 20.4183 7.58172 24 12 24C16.4183 24 20 20.4183 20 16C20 8 12 0 12 0Z" fill="#D32F2F"/>
              <path d="M12 12C12 12 8 16 8 20C8 22.2091 9.79086 24 12 24C14.2091 24 16 22.2091 16 20C16 16 12 12 12 12Z" fill="#FF8A65"/>
            </svg>
            <span className="text-white font-black text-3xl tracking-[-0.05em] uppercase">
              AgapSense
            </span>
          </div>
          <h1 className="font-black text-[32px] leading-tight text-white tracking-[-0.025em] mb-3">
            Resident Registration
          </h1>
          <p className="text-white/80 text-sm font-medium">
            Register as a device owner to monitor alerts in your home.
          </p>
        </div>

        {/* Card */}
        <div className="w-full bg-white rounded-2xl shadow-[0_24px_48px_rgba(0,0,0,0.2)] p-8 lg:p-10 border border-[#E5E2E1]">
          <Link to="/login" className="inline-flex items-center text-[#534341] hover:text-[#D32F2F] text-xs font-bold mb-6 transition-colors uppercase tracking-wider">
            <ArrowLeft className="w-4 h-4 mr-1.5" /> Back to Login
          </Link>
          
          {error && (
            <div className="mb-6 p-4 bg-[#FEF2F2] border border-[#F87171] rounded-lg flex items-start gap-3">
              <AlertCircle className="w-5 h-5 text-[#DC2626] flex-shrink-0 mt-0.5" />
              <p className="text-sm text-[#991B1B] font-medium leading-relaxed">{error}</p>
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-5">
            <div className="space-y-4">
              <div>
                <label className="block text-xs font-bold text-[#534341] uppercase tracking-wider mb-2">Full Name <span className="text-[#D32F2F]">*</span></label>
                <div className="relative">
                  <User className="absolute left-3.5 top-1/2 -translate-y-1/2 w-5 h-5 text-[#8D7F7D]" />
                  <input
                    type="text"
                    required
                    value={formData.fullName}
                    onChange={(e) => setFormData({...formData, fullName: e.target.value})}
                    className="w-full pl-11 pr-4 py-3 bg-[#FCF9F8] border border-[#E5E2E1] rounded-lg text-sm text-[#231918] placeholder-[#8D7F7D] focus:outline-none focus:border-[#D32F2F] focus:ring-1 focus:ring-[#D32F2F] transition-colors"
                    placeholder="Juan Dela Cruz"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-[#534341] uppercase tracking-wider mb-2">Email Address <span className="text-[#D32F2F]">*</span></label>
                <div className="relative">
                  <Mail className="absolute left-3.5 top-1/2 -translate-y-1/2 w-5 h-5 text-[#8D7F7D]" />
                  <input
                    type="email"
                    required
                    value={formData.email}
                    onChange={(e) => setFormData({...formData, email: e.target.value})}
                    className="w-full pl-11 pr-4 py-3 bg-[#FCF9F8] border border-[#E5E2E1] rounded-lg text-sm text-[#231918] placeholder-[#8D7F7D] focus:outline-none focus:border-[#D32F2F] focus:ring-1 focus:ring-[#D32F2F] transition-colors"
                    placeholder="you@example.com"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-[#534341] uppercase tracking-wider mb-2">Contact Number</label>
                <div className="relative">
                  <Phone className="absolute left-3.5 top-1/2 -translate-y-1/2 w-5 h-5 text-[#8D7F7D]" />
                  <input
                    type="tel"
                    value={formData.contactNumber}
                    onChange={handlePhoneChange}
                    maxLength={11}
                    className="w-full pl-11 pr-4 py-3 bg-[#FCF9F8] border border-[#E5E2E1] rounded-lg text-sm text-[#231918] placeholder-[#8D7F7D] focus:outline-none focus:border-[#D32F2F] focus:ring-1 focus:ring-[#D32F2F] transition-colors"
                    placeholder="09XXXXXXXXX"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-[#534341] uppercase tracking-wider mb-2">Address <span className="text-[#D32F2F]">*</span></label>
                <div className="relative">
                  <MapPin className="absolute left-3.5 top-3 w-5 h-5 text-[#8D7F7D]" />
                  <textarea
                    required
                    value={formData.address}
                    onChange={(e) => setFormData({...formData, address: e.target.value})}
                    className="w-full pl-11 pr-4 py-3 bg-[#FCF9F8] border border-[#E5E2E1] rounded-lg text-sm text-[#231918] placeholder-[#8D7F7D] focus:outline-none focus:border-[#D32F2F] focus:ring-1 focus:ring-[#D32F2F] transition-colors resize-none"
                    placeholder="Complete Residential Address"
                    rows={2}
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-[#534341] uppercase tracking-wider mb-2">Device ID (Optional)</label>
                <div className="relative">
                  <MonitorSmartphone className="absolute left-3.5 top-1/2 -translate-y-1/2 w-5 h-5 text-[#8D7F7D]" />
                  <input
                    type="text"
                    value={formData.deviceCode}
                    onChange={(e) => setFormData({...formData, deviceCode: e.target.value})}
                    className="w-full pl-11 pr-4 py-3 bg-[#FCF9F8] border border-[#E5E2E1] rounded-lg text-sm text-[#231918] placeholder-[#8D7F7D] focus:outline-none focus:border-[#D32F2F] focus:ring-1 focus:ring-[#D32F2F] transition-colors"
                    placeholder="e.g. DEV-001"
                  />
                </div>
                <p className="text-[11px] text-[#8D7F7D] mt-1.5 ml-1 font-medium">The admin will verify and link this device to your account.</p>
              </div>

              <div className="grid grid-cols-2 gap-4 pt-2">
                <div>
                  <label className="block text-xs font-bold text-[#534341] uppercase tracking-wider mb-2">Password <span className="text-[#D32F2F]">*</span></label>
                  <div className="relative">
                    <Lock className="absolute left-3.5 top-1/2 -translate-y-1/2 w-5 h-5 text-[#8D7F7D]" />
                    <input
                      type="password"
                      required
                      minLength={6}
                      value={formData.password}
                      onChange={(e) => setFormData({...formData, password: e.target.value})}
                      className="w-full pl-11 pr-4 py-3 bg-[#FCF9F8] border border-[#E5E2E1] rounded-lg text-sm text-[#231918] placeholder-[#8D7F7D] focus:outline-none focus:border-[#D32F2F] focus:ring-1 focus:ring-[#D32F2F] transition-colors"
                      placeholder="••••••••"
                    />
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-bold text-[#534341] uppercase tracking-wider mb-2">Confirm <span className="text-[#D32F2F]">*</span></label>
                  <div className="relative">
                    <Lock className="absolute left-3.5 top-1/2 -translate-y-1/2 w-5 h-5 text-[#8D7F7D]" />
                    <input
                      type="password"
                      required
                      minLength={6}
                      value={formData.confirmPassword}
                      onChange={(e) => setFormData({...formData, confirmPassword: e.target.value})}
                      className="w-full pl-11 pr-4 py-3 bg-[#FCF9F8] border border-[#E5E2E1] rounded-lg text-sm text-[#231918] placeholder-[#8D7F7D] focus:outline-none focus:border-[#D32F2F] focus:ring-1 focus:ring-[#D32F2F] transition-colors"
                      placeholder="••••••••"
                    />
                  </div>
                </div>
              </div>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full flex items-center justify-center py-3.5 px-4 bg-[#D32F2F] text-white font-bold text-sm tracking-[0.1em] uppercase rounded-lg hover:bg-[#B91C1C] focus:ring-4 focus:ring-[#FEF2F2] transition-all disabled:opacity-70 disabled:cursor-not-allowed shadow-[0_4px_12px_rgba(211,47,47,0.2)] mt-8"
            >
              {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : 'Submit Registration'}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
};

import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { supabase } from '../../lib/supabase';
import type { Device } from '../../lib/supabase';
import { CheckCircle2 } from 'lucide-react';
import { isValidCoordinate } from '../../lib/location';
import { DeviceLocationEditor } from '../../components/DeviceLocationEditor';

type SetupDevice = Pick<Device, 'location_desc' | 'latitude' | 'longitude' | 'location_verified'>;

export const ResidentSetup = () => {
  const navigate = useNavigate();
  const { profile } = useAuth();
  const [mobile, setMobile] = useState('');
  const [confirmMobile, setConfirmMobile] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);
  const [loading, setLoading] = useState(false);
  // Step 2 (install address + pin) only when a device is linked and its pin isn't confirmed yet.
  const [step, setStep] = useState<'contact' | 'location'>('contact');
  // undefined while loading, so a quick submit can't skip the location step by accident.
  const [device, setDevice] = useState<SetupDevice | null | undefined>(undefined);

  useEffect(() => {
    // If setup is already complete, redirect to home
    if (profile?.setup_complete) {
      navigate('/home', { replace: true });
    }
  }, [profile, navigate]);

  useEffect(() => {
    if (!profile?.device_id) return;
    supabase
      .from('devices_safe')
      .select('location_desc, latitude, longitude, location_verified')
      .eq('id', profile.device_id)
      .maybeSingle()
      .then(({ data }) => setDevice((data as SetupDevice | null) ?? null));
  }, [profile?.device_id]);

  const needsLocation = !!device && !(device.location_verified && isValidCoordinate(device.latitude, device.longitude));
  const totalSteps = needsLocation ? 2 : 1;

  const finish = () => {
    setSuccess(true);
    setTimeout(() => {
      // Full reload so the auth context picks up setup_complete.
      window.location.href = '/home';
    }, 1500);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    
    // Validate format
    const phoneRegex = /^(09\d{9})$/;
    if (!phoneRegex.test(mobile)) {
      setError('Enter a valid Philippine mobile number (e.g. 09171234567).');
      return;
    }
    
    if (mobile !== confirmMobile) {
      setError('Numbers do not match. Please re-enter.');
      return;
    }
    
    if (!profile) return;

    setLoading(true);
    try {
      const { error: updateError } = await supabase
        .from('profiles')
        .update({
          contact_number: mobile,
          setup_complete: true
        })
        .eq('id', profile.id);

      if (updateError) throw updateError;

      if (needsLocation) setStep('location');
      else finish();

    } catch (err: any) {
      console.error(err);
      setError(err.message || 'Failed to update contact number');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen w-full flex items-center justify-center bg-surface px-4 py-8 font-['Inter',_sans-serif]">
      <div className={`${step === 'location' ? 'max-w-xl' : 'max-w-md'} w-full flex flex-col gap-6`}>
        <div className="text-center flex flex-col gap-2">
          <span className="text-text-warm text-xs font-bold tracking-[0.1em] uppercase">
            Setup ({step === 'contact' ? 1 : 2} of {totalSteps})
          </span>
          {step === 'contact' ? (
            <>
              <h2 className="text-text font-black text-2xl tracking-tight">
                Set up your alert contact
              </h2>
              <p className="text-text-body text-sm leading-5">
                During a fire alert, your AgapSense device texts this number directly. Enter the mobile number you want those alerts on.
              </p>
            </>
          ) : (
            <>
              <h2 className="text-text font-black text-2xl tracking-tight">
                Where is your device installed?
              </h2>
              <p className="text-text-body text-sm leading-5">
                Enter the address and place the pin on the building where the device is installed. Responders use it when the device has no GPS signal.
              </p>
            </>
          )}
        </div>

        <div className="bg-white p-8 rounded-xl shadow-[0_24px_48px_rgba(0,0,0,0.08)] border border-border">
          {success ? (
            <div className="flex flex-col items-center justify-center gap-4 py-8">
              <div className="w-16 h-16 bg-success/10 rounded-full flex items-center justify-center">
                <CheckCircle2 className="w-8 h-8 text-success-dark" />
              </div>
              <p className="text-success-dark font-bold text-center">
                Setup saved. Taking you to your dashboard...
              </p>
            </div>
          ) : step === 'location' && device ? (
            <div className="flex flex-col gap-4">
              <DeviceLocationEditor
                initialAddress={device.location_desc}
                initialLat={device.latitude}
                initialLng={device.longitude}
                saveLabel="Save and continue"
                onSaved={finish}
              />
              <button
                type="button"
                onClick={finish}
                className="text-text-body text-xs font-bold uppercase tracking-[0.1em] hover:underline"
              >
                Skip for now — set it later in Device Information
              </button>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="flex flex-col gap-6">
              <div className="flex flex-col gap-2">
                <label className="text-text-warm text-xs font-bold tracking-[0.1em] uppercase">
                  Mobile number
                </label>
                <input
                  type="tel"
                  required
                  maxLength={11}
                  value={mobile}
                  onChange={(e) => setMobile(e.target.value.replace(/\D/g, ''))}
                  placeholder="09XXXXXXXXX"
                  className="w-full bg-surface border border-border rounded-md px-4 py-3 text-base text-text placeholder-[rgba(83,67,65,0.5)] focus:outline-none focus:ring-2 focus:ring-accent/30 focus:border-accent transition-all"
                />
                <span className="text-[10px] text-text-faint">
                  Philippine number only — e.g. 09171234567
                </span>
              </div>

              <div className="flex flex-col gap-2">
                <label className="text-text-warm text-xs font-bold tracking-[0.1em] uppercase">
                  Confirm mobile number
                </label>
                <input
                  type="tel"
                  required
                  maxLength={11}
                  value={confirmMobile}
                  onChange={(e) => setConfirmMobile(e.target.value.replace(/\D/g, ''))}
                  placeholder="Re-enter your number"
                  className={`w-full bg-surface border rounded-md px-4 py-3 text-base text-text placeholder-[rgba(83,67,65,0.5)] focus:outline-none focus:ring-2 transition-all ${
                    error ? 'border-accent focus:ring-accent/30' : 'border-border focus:border-accent focus:ring-accent/30'
                  }`}
                />
                {error && (
                  <span className="text-accent text-[11px] font-bold mt-1">
                    {error}
                  </span>
                )}
              </div>

              <button
                type="submit"
                disabled={loading || (!!profile?.device_id && device === undefined)}
                className="w-full mt-2 py-4 bg-primary text-white font-bold text-sm tracking-[0.1em] uppercase rounded-lg shadow-[0_4px_6px_-4px_rgba(211,47,47,0.2),0_10px_15px_-3px_rgba(211,47,47,0.2)] hover:bg-primary-dark transition-colors disabled:opacity-50"
              >
                {loading ? 'Saving...' : 'Save and continue'}
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
};
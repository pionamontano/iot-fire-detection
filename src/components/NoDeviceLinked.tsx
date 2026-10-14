import { Link } from 'react-router-dom';
import { Cpu, ArrowRight } from 'lucide-react';

// Shown on resident pages that need a device when none is linked yet. Linking
// happens on the Dashboard, which shows the device-code form in that case.
export const NoDeviceLinked = () => (
  <div className="flex items-center justify-center min-h-[50vh] px-4">
    <div className="bg-white border border-border rounded-lg p-8 max-w-md w-full text-center">
      <div className="w-14 h-14 bg-tier2-bg rounded-full flex items-center justify-center mx-auto mb-5">
        <Cpu className="w-7 h-7 text-primary" />
      </div>
      <h2 className="text-lg font-bold text-text">No device linked yet</h2>
      <p className="text-sm text-text-body mt-2">Link your AgapSense device with its device code to see this page.</p>
      <Link to="/home" className="mt-5 inline-flex items-center gap-1 text-primary-dark font-bold text-sm hover:underline">
        Link a device <ArrowRight className="w-4 h-4" />
      </Link>
    </div>
  </div>
);

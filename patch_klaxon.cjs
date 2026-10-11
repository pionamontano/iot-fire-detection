const fs = require('fs');
const path = 'src/pages/responder/ResponderDashboard.tsx';
let code = fs.readFileSync(path, 'utf8');

// add icons
const oldImports = `  Loader2,
  PhoneCall,
  Navigation,
} from 'lucide-react';`;
const newImports = `  Loader2,
  PhoneCall,
  Navigation,
  Volume2,
  VolumeX,
} from 'lucide-react';`;
code = code.replace(oldImports, newImports);

// add hooks
const hookCode = `
export const ResponderDashboard = () => {
  const [devices, setDevices] = useState<DeviceWithStatus[]>([]);
  const [activeAlerts, setActiveAlerts] = useState<AlertEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [acknowledging, setAcknowledging] = useState<string | null>(null);
  const [klaxonArmed, setKlaxonArmed] = useState(true);

  // Klaxon AudioContext ref
  const audioCtxRef = React.useRef<AudioContext | null>(null);
  const oscillatorRef = React.useRef<OscillatorNode | null>(null);
  const gainNodeRef = React.useRef<GainNode | null>(null);
  const sirenIntervalRef = React.useRef<ReturnType<typeof setInterval> | null>(null);
  const isPlayingRef = React.useRef(false);

  const startKlaxon = useCallback(() => {
    if (isPlayingRef.current) return;
    isPlayingRef.current = true;

    try {
      const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
      if (!audioCtxRef.current && AudioContextClass) {
        audioCtxRef.current = new AudioContextClass();
      }

      const ctx = audioCtxRef.current;
      if (!ctx) return;
      if (ctx.state === 'suspended') ctx.resume();

      const oscillator = ctx.createOscillator();
      const gainNode = ctx.createGain();

      oscillator.type = 'square';
      oscillator.frequency.setValueAtTime(800, ctx.currentTime); // Start at 800Hz

      gainNode.gain.setValueAtTime(0, ctx.currentTime);

      oscillator.connect(gainNode);
      gainNode.connect(ctx.destination);

      oscillator.start();

      oscillatorRef.current = oscillator;
      gainNodeRef.current = gainNode;

      let high = false;
      sirenIntervalRef.current = setInterval(() => {
        if (!ctx) return;
        const targetFreq = high ? 800 : 1200;
        oscillator.frequency.setTargetAtTime(targetFreq, ctx.currentTime, 0.1);
        gainNode.gain.setTargetAtTime(0.3, ctx.currentTime, 0.1);
        high = !high;
      }, 500);

    } catch (err) {
      console.warn("AudioContext failed to start:", err);
    }
  }, []);

  const stopKlaxon = useCallback(() => {
    if (!isPlayingRef.current) return;
    isPlayingRef.current = false;

    if (sirenIntervalRef.current) {
      clearInterval(sirenIntervalRef.current);
      sirenIntervalRef.current = null;
    }

    try {
      if (gainNodeRef.current && audioCtxRef.current) {
        gainNodeRef.current.gain.setTargetAtTime(0, audioCtxRef.current.currentTime, 0.1);
      }
      setTimeout(() => {
        if (oscillatorRef.current) {
          oscillatorRef.current.stop();
          oscillatorRef.current.disconnect();
          oscillatorRef.current = null;
        }
        if (gainNodeRef.current) {
          gainNodeRef.current.disconnect();
          gainNodeRef.current = null;
        }
      }, 200);
    } catch (err) {
       console.warn("Error stopping audio:", err);
    }
  }, []);

  useEffect(() => {
    return () => {
      stopKlaxon();
      if (audioCtxRef.current) {
        audioCtxRef.current.close().catch(console.warn);
      }
    };
  }, [stopKlaxon]);

  // Check if there is an unacknowledged critical fire alert
  const hasUnacknowledgedCriticalFire = useMemo(() => {
    return activeAlerts.some(a => a.alert_tier === 2 && (!a.incident_status || a.incident_status === 'active'));
  }, [activeAlerts]);

  useEffect(() => {
    if (hasUnacknowledgedCriticalFire && klaxonArmed) {
      startKlaxon();
    } else {
      stopKlaxon();
    }
  }, [hasUnacknowledgedCriticalFire, klaxonArmed, startKlaxon, stopKlaxon]);
`;

code = code.replace(`export const ResponderDashboard = () => {
    const [devices, setDevices] = useState<DeviceWithStatus[]>([]);
  const [activeAlerts, setActiveAlerts] = useState<AlertEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [acknowledging, setAcknowledging] = useState<string | null>(null);`, hookCode);


const oldKlaxonUI = `    <div className="space-y-8 pb-10">
      {/* Zero Coverage Alert */}
      {totalDevices > 0 && devicesOnline === 0 && (
        <div className="bg-red-600 text-white font-bold px-4 py-3 rounded-lg flex items-center justify-center gap-2 mb-6">
          <AlertTriangle className="w-5 h-5" />
          CRITICAL: ALL TELEMETRY LOST (0 ONLINE DEVICES)
        </div>
      )}`;

const newKlaxonUI = `    <div className="space-y-8 pb-10">
      {/* Header with Klaxon Toggle */}
      <div className="flex justify-end mb-4">
        <button
          onClick={() => {
            // Need a user gesture to resume audio context reliably if it was suspended
            if (!klaxonArmed && audioCtxRef.current?.state === 'suspended') {
              audioCtxRef.current.resume();
            }
            setKlaxonArmed(!klaxonArmed);
          }}
          className={\`flex items-center gap-2 px-4 py-2 rounded-lg font-bold text-xs uppercase tracking-wider transition-colors \${
            klaxonArmed
              ? 'bg-red-100 text-red-700 border border-red-200 hover:bg-red-200'
              : 'bg-gray-100 text-gray-600 border border-gray-200 hover:bg-gray-200'
          }\`}
        >
          {klaxonArmed ? (
            <>
              <Volume2 className="w-4 h-4" /> Klaxon Armed
            </>
          ) : (
            <>
              <VolumeX className="w-4 h-4" /> Muted
            </>
          )}
        </button>
      </div>

      {/* Zero Coverage Alert */}
      {totalDevices > 0 && devicesOnline === 0 && (
        <div className="bg-red-600 text-white font-bold px-4 py-3 rounded-lg flex items-center justify-center gap-2 mb-6">
          <AlertTriangle className="w-5 h-5" />
          CRITICAL: ALL TELEMETRY LOST (0 ONLINE DEVICES)
        </div>
      )}`;

code = code.replace(oldKlaxonUI, newKlaxonUI);

fs.writeFileSync(path, code);

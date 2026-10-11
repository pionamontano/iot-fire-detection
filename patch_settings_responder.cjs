const fs = require('fs');
const file = 'src/pages/ResponderSettings.tsx';
let code = fs.readFileSync(file, 'utf8');

const importTarget = "import { SettingsFormSkeleton } from '../components/SkeletonLoaders';";
const pushImport = `
import { subscribeUserToPush, unsubscribeUserFromPush, getPushSubscription } from '../lib/pushNotifications';
import { Bell, BellOff, CheckCircle } from 'lucide-react';
`;

if (!code.includes('subscribeUserToPush')) {
  code = code.replace(importTarget, importTarget + "\n" + pushImport);
}

const stateTarget = "const [errorMsg, setErrorMsg] = useState('');";
const pushState = `
  const [isPushSubscribed, setIsPushSubscribed] = useState(false);
  const [pushLoading, setPushLoading] = useState(true);
`;

if (!code.includes('isPushSubscribed')) {
  code = code.replace(stateTarget, stateTarget + "\n" + pushState);
}

const effectTarget = "setLoading(false);";
const pushEffect = `
      getPushSubscription().then(sub => {
        setIsPushSubscribed(!!sub);
        setPushLoading(false);
      });
`;

if (!code.includes('getPushSubscription()')) {
  code = code.replace(effectTarget, pushEffect + "\n" + effectTarget);
}


const toggleTarget = "const handleConnectTelegram = () => {";
const pushToggle = `
  const handleTogglePush = async () => {
    setPushLoading(true);
    try {
      if (isPushSubscribed) {
        await unsubscribeUserFromPush();
        setIsPushSubscribed(false);
      } else {
        const permission = await Notification.requestPermission();
        if (permission === 'granted') {
          await subscribeUserToPush();
          setIsPushSubscribed(true);
        } else {
          setErrorMsg('Notification permission denied by browser.');
          setTimeout(() => setErrorMsg(''), 5000);
        }
      }
    } catch (e: any) {
      console.error(e);
      setErrorMsg('Push error: ' + (e.message || 'Unknown error'));
      setTimeout(() => setErrorMsg(''), 5000);
    } finally {
      setPushLoading(false);
    }
  };
`;

if (!code.includes('handleTogglePush')) {
  code = code.replace(toggleTarget, pushToggle + "\n" + toggleTarget);
}

const uiTarget = "</div>\n\n          {/* Telegram Settings */}";
const pushUI = `
          {/* Web Push Alerts */}
          <div className="bg-white rounded-xl shadow-sm border border-[#E4E4E7] overflow-hidden mb-6">
            <div className="px-6 py-4 border-b border-[#E4E4E7] bg-[#F4F4F5] flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-white rounded-lg border border-[#E4E4E7]">
                  <Bell className="w-5 h-5 text-[#DC2626]" />
                </div>
                <div>
                  <h3 className="font-bold text-[#18181B] tracking-tight">Web Push Alerts</h3>
                  <p className="text-xs text-[#71717A] mt-0.5">Receive incident alerts directly in your browser</p>
                </div>
              </div>
              {isPushSubscribed ? (
                <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-[#10B981]/10 text-[#10B981]">
                  <CheckCircle className="w-4 h-4" />
                  ENABLED
                </span>
              ) : (
                <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-[#F59E0B]/10 text-[#F59E0B]">
                  <BellOff className="w-4 h-4" />
                  DISABLED
                </span>
              )}
            </div>

            <div className="p-6">
              <button
                type="button"
                onClick={handleTogglePush}
                disabled={pushLoading}
                className="inline-flex items-center gap-2 px-5 py-2.5 bg-[#18181B] text-white text-sm font-bold rounded-lg hover:bg-[#27272A] transition-colors focus:ring-2 focus:ring-offset-2 focus:ring-[#18181B] disabled:opacity-50"
              >
                {isPushSubscribed ? <BellOff className="w-4 h-4" /> : <Bell className="w-4 h-4" />}
                {pushLoading ? 'Processing...' : (isPushSubscribed ? 'Disable Push Notifications' : 'Enable Push Notifications')}
              </button>
            </div>
          </div>
`;

if (!code.includes('Web Push Alerts')) {
  code = code.replace(uiTarget, pushUI + "\n" + uiTarget);
}

fs.writeFileSync(file, code);

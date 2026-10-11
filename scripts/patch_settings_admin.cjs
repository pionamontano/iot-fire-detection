const fs = require('fs');
const file = 'src/pages/Settings.tsx';
let code = fs.readFileSync(file, 'utf8');

const importTarget = "import { SettingsFormSkeleton } from '../components/SkeletonLoaders';";
const pushImport = `
import { subscribeUserToPush, unsubscribeUserFromPush, getPushSubscription } from '../lib/pushNotifications';
import { Bell, BellOff } from 'lucide-react';
`;

if (!code.includes('subscribeUserToPush')) {
  code = code.replace(importTarget, importTarget + "\n" + pushImport);
}

const stateTarget = "const [testError, setTestError] = useState('');";
const pushState = `
  const [isPushSubscribed, setIsPushSubscribed] = useState(false);
  const [pushLoading, setPushLoading] = useState(true);
`;

if (!code.includes('isPushSubscribed')) {
  code = code.replace(stateTarget, stateTarget + "\n" + pushState);
}

const effectTarget = "if (error) throw error;";
const pushEffect = `
      getPushSubscription().then(sub => {
        setIsPushSubscribed(!!sub);
        setPushLoading(false);
      });
`;

if (!code.includes('getPushSubscription()')) {
  code = code.replace(effectTarget, effectTarget + "\n" + pushEffect);
}


const toggleTarget = "const handleSendTestMessage = async () => {";
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
          // Handle denied
        }
      }
    } catch (e: any) {
      console.error(e);
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
            <div className="px-6 py-4 border-b border-[#E4E4E7] bg-[#F4F4F5] flex items-center gap-3">
              <div className="p-2 bg-[#E4E4E7] rounded-lg">
                <Bell className="w-5 h-5 text-[#3F3F46]" />
              </div>
              <div>
                <h3 className="text-sm font-bold text-[#18181B] tracking-tight">Web Push Alerts</h3>
                <p className="text-xs text-[#71717A] mt-0.5">Receive notifications directly in your browser</p>
              </div>
              <div className="ml-auto">
                {isPushSubscribed ? (
                  <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-emerald-100 text-emerald-800">
                    <CheckCircle className="w-3.5 h-3.5" />
                    Enabled
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-amber-100 text-amber-800">
                    <BellOff className="w-3.5 h-3.5" />
                    Disabled
                  </span>
                )}
              </div>
            </div>
            <div className="p-6">
              <button
                type="button"
                onClick={handleTogglePush}
                disabled={pushLoading}
                className="inline-flex items-center gap-2 px-4 py-2 bg-[#18181B] text-white text-sm font-semibold rounded-lg hover:bg-[#27272A] transition-colors focus:ring-2 focus:ring-offset-2 focus:ring-[#18181B] disabled:opacity-50"
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

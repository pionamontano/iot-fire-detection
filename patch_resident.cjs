const fs = require('fs');
const file = 'src/pages/ResidentAlertSettings.tsx';
let content = fs.readFileSync(file, 'utf8');

const importReplacement = `import { Thermometer, Wind, MessageSquare, CheckCircle2, ShieldAlert, HelpCircle, AlertTriangle, Save, Send } from 'lucide-react';`;
content = content.replace(/import { Thermometer.*lucide-react';/, importReplacement);

const handleTelegram = `
  const handleConnectTelegram = () => {
    if (!profile) return;
    const botUsername = "AgapSenseAlertBot";
    const telegramUrl = \`https://t.me/\${botUsername}?start=\${profile.id}\`;
    window.open(telegramUrl, '_blank');
  };
`;
content = content.replace(/const fetchDevice/, handleTelegram + '\n  const fetchDevice');

const renderTelegramBlock = `
          {/* Telegram Linking */}
          <div className="bg-white border border-[#E4E4E7] rounded-xl overflow-hidden shadow-sm">
            <div className="bg-[#F4F4F5] px-4 py-3 border-b border-[#E4E4E7] flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Send className="w-4 h-4 text-[#71717A]" />
                <h3 className="font-bold text-[13px] tracking-wide text-[#27272A] uppercase">TELEGRAM ALERTS</h3>
              </div>
              {profile?.telegram_chat_id ? (
                <div className="flex items-center gap-1.5 text-xs font-bold text-[#10B981] bg-[#10B981]/10 px-2.5 py-1 rounded-full">
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  LINKED
                </div>
              ) : (
                <div className="flex items-center gap-1.5 text-xs font-bold text-[#F59E0B] bg-[#F59E0B]/10 px-2.5 py-1 rounded-full">
                  <AlertTriangle className="w-3.5 h-3.5" />
                  NOT LINKED
                </div>
              )}
            </div>

            <div className="p-4 sm:p-5">
              <p className="text-[13px] text-[#52525B] leading-relaxed mb-4">
                Receive instant fire alerts directly to your Telegram app. This is the fastest and most reliable way to get notified during an emergency.
              </p>

              <button
                type="button"
                onClick={handleConnectTelegram}
                className="w-full sm:w-auto px-5 py-2.5 bg-[#27272A] hover:bg-[#18181B] text-white text-[13px] font-bold rounded-lg transition-colors flex items-center justify-center gap-2"
              >
                <Send className="w-4 h-4" />
                {profile?.telegram_chat_id ? 'Reconnect Telegram' : 'Link Telegram Account'}
              </button>
            </div>
          </div>
`;

content = content.replace(/{errorMsg && \(/, renderTelegramBlock + '\n\n            {errorMsg && (');
fs.writeFileSync(file, content);

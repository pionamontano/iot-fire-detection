const fs = require('fs');
const path = 'src/pages/responder/ResponderDashboard.tsx';
let code = fs.readFileSync(path, 'utf8');

const oldImport = `  Loader2,
} from 'lucide-react';`;
const newImport = `  Loader2,
  PhoneCall,
  Navigation,
} from 'lucide-react';`;
code = code.replace(oldImport, newImport);

const oldAlertBody = `              feedAlerts.map(alert => {
                const deviceCode = (alert as any).devices?.device_code || 'Unknown';
                const deviceLabel = (alert as any).devices?.label || '';
                const loc = (alert as any).devices?.location_desc || '';
                return (
                  <div key={alert.id} className="px-5 py-4">
                    <div className="flex items-start justify-between mb-2">
                      <div>
                        <h4 className="text-[#DC2626] font-bold text-sm">
                          {deviceCode} • {deviceLabel}
                        </h4>
                        <p className="text-[#5B403D] text-xs mt-0.5">{loc}</p>
                      </div>
                      <span className={\`text-[9px] font-bold tracking-[0.05em] uppercase px-2 py-0.5 rounded \${
                        timeAgo(alert.triggered_at) === 'JUST NOW' ? 'bg-[#FEE2E2] text-[#DC2626]' : 'text-[#A1A1AA]'
                      }\`}>
                        {timeAgo(alert.triggered_at)}
                      </span>
                    </div>
                    {/* Sensor Readings */}
                    <div className="grid grid-cols-2 gap-2">
                      <div className="bg-[#FEF2F2] rounded px-3 py-2">
                        <span className="text-[9px] text-[#5B403D] uppercase tracking-[0.05em] font-bold block">Temp</span>
                        <span className="text-[#DC2626] font-bold text-sm">{alert.temp_celsius}°C</span>
                      </div>
                      <div className="bg-[#FEF2F2] rounded px-3 py-2">
                        <span className="text-[9px] text-[#5B403D] uppercase tracking-[0.05em] font-bold block">Smoke</span>
                        <span className="text-[#DC2626] font-bold text-sm">{alert.co_ppm > 0 ? \`\${Math.min(99, Math.round(alert.co_ppm / 5))}%\` : '0%'}</span>
                      </div>
                    </div>
                    {alert.latitude && alert.longitude && (
                      <p className="text-[10px] text-[#A1A1AA] mt-2 flex items-center gap-1">
                        <MapPin className="w-3 h-3" />
                        {alert.latitude.toFixed(4)}° N, {alert.longitude.toFixed(4)}° E
                      </p>
                    )}

                    {/* Incident Status / Acknowledge */}
                    <div className="mt-3 pt-3 border-t border-[#E5E2E1] flex flex-col gap-2">
                      <div className="flex items-center justify-between">
                        <span className="text-[10px] font-bold text-[#5B403D] uppercase tracking-[0.05em]">Status</span>
                        <span className={\`text-[10px] font-bold uppercase tracking-[0.05em] \${
                          alert.incident_status === 'active' ? 'text-[#DC2626]' :
                          alert.incident_status === 'acknowledged' ? 'text-[#F59E0B]' :
                          alert.incident_status === 'responding' ? 'text-[#3B82F6]' : 'text-[#10B981]'
                        }\`}>
                          {alert.incident_status || 'active'}
                        </span>
                      </div>
                      <div className="flex items-center justify-end gap-2">
                        {(!alert.incident_status || alert.incident_status === 'active') && (
                          <button
                            onClick={() => handleAcknowledge(alert.id)}
                            disabled={acknowledging === alert.id}
                            className="bg-[#DC2626] hover:bg-[#B91C1C] text-white text-[10px] font-bold tracking-[0.05em] uppercase px-3 py-1.5 rounded transition-colors disabled:opacity-50"
                          >
                            {acknowledging === alert.id ? 'Updating...' : 'Acknowledge'}
                          </button>
                        )}
                        {alert.incident_status === 'acknowledged' && (
                          <button
                            onClick={() => handleUpdateStatus(alert.id, 'responding')}
                            disabled={acknowledging === alert.id}
                            className="bg-[#3B82F6] hover:bg-[#2563EB] text-white text-[10px] font-bold tracking-[0.05em] uppercase px-3 py-1.5 rounded transition-colors disabled:opacity-50"
                          >
                            {acknowledging === alert.id ? 'Updating...' : 'Mark Responding'}
                          </button>
                        )}
                        {(alert.incident_status === 'acknowledged' || alert.incident_status === 'responding') && (
                          <>
                            <button
                              onClick={() => handleUpdateStatus(alert.id, 'resolved')}
                              disabled={acknowledging === alert.id}
                              className="bg-[#10B981] hover:bg-[#059669] text-white text-[10px] font-bold tracking-[0.05em] uppercase px-3 py-1.5 rounded transition-colors disabled:opacity-50"
                            >
                              Resolve
                            </button>
                            <button
                              onClick={() => handleUpdateStatus(alert.id, 'false_alarm')}
                              disabled={acknowledging === alert.id}
                              className="bg-[#6B7280] hover:bg-[#4B5563] text-white text-[10px] font-bold tracking-[0.05em] uppercase px-3 py-1.5 rounded transition-colors disabled:opacity-50"
                            >
                              False Alarm
                            </button>
                          </>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })`;

const newAlertBody = `              feedAlerts.map(alert => {
                const device = (alert as any).devices || {};
                const deviceCode = device.device_code || 'Unknown';
                const deviceLabel = device.label || '';
                const loc = device.location_desc || '';
                const bfpContact = device.bfp_contact || '';

                const isFire = alert.alert_tier === 2;
                const badgeColor = isFire ? 'bg-red-600 text-white' : 'bg-amber-500 text-white';
                const badgeText = isFire ? 'CRITICAL FIRE' : 'ADVISORY';
                const textColor = isFire ? 'text-red-700' : 'text-amber-700';
                const bgLightColor = isFire ? 'bg-red-50' : 'bg-amber-50';

                return (
                  <div key={alert.id} className={\`px-5 py-4 \${bgLightColor}\`}>
                    <div className="flex items-start justify-between mb-2">
                      <div className="flex flex-col gap-1">
                        <span className={\`text-[9px] font-bold tracking-wider uppercase px-2 py-0.5 rounded self-start \${badgeColor}\`}>
                          {badgeText}
                        </span>
                        <h4 className={\`font-bold text-sm \${textColor}\`}>
                          {deviceCode}: {deviceLabel}
                        </h4>
                        <p className="text-[#5B403D] text-xs font-medium">{loc}</p>
                      </div>
                      <span className="text-[10px] font-bold tracking-wider uppercase text-gray-500 whitespace-nowrap">
                        Triggered {timeAgo(alert.triggered_at).toLowerCase()}
                      </span>
                    </div>
                    {/* Sensor Readings */}
                    <div className="grid grid-cols-2 gap-2 mt-3">
                      <div className="bg-white/60 border border-white rounded px-3 py-2">
                        <span className="text-[9px] text-[#5B403D] uppercase tracking-wider font-bold block">Peak Temp</span>
                        <span className={\`font-bold text-sm \${textColor}\`}>{alert.temp_celsius}°C</span>
                      </div>
                      <div className="bg-white/60 border border-white rounded px-3 py-2">
                        <span className="text-[9px] text-[#5B403D] uppercase tracking-wider font-bold block">CO Level</span>
                        <span className={\`font-bold text-sm \${textColor}\`}>{alert.co_ppm} ppm</span>
                      </div>
                    </div>

                    {/* Interactive Dispatch Actions */}
                    <div className="mt-4 flex flex-col gap-2">
                      <div className="grid grid-cols-2 gap-2">
                        {(!alert.incident_status || alert.incident_status === 'active') && (
                          <button
                            onClick={() => handleAcknowledge(alert.id)}
                            disabled={acknowledging === alert.id}
                            className="w-full bg-indigo-600 hover:bg-indigo-700 text-white text-[10px] font-bold tracking-[0.05em] uppercase px-3 py-2 rounded transition-colors disabled:opacity-50 col-span-2"
                          >
                            {acknowledging === alert.id ? 'Updating...' : 'Acknowledge Alarm'}
                          </button>
                        )}
                        {alert.incident_status === 'acknowledged' && (
                          <button
                            onClick={() => handleUpdateStatus(alert.id, 'responding')}
                            disabled={acknowledging === alert.id}
                            className="w-full bg-blue-600 hover:bg-blue-700 text-white text-[10px] font-bold tracking-[0.05em] uppercase px-3 py-2 rounded transition-colors disabled:opacity-50 col-span-2"
                          >
                            {acknowledging === alert.id ? 'Updating...' : 'Dispatch Unit'}
                          </button>
                        )}
                        {(alert.incident_status === 'acknowledged' || alert.incident_status === 'responding') && (
                          <>
                            <button
                              onClick={() => handleUpdateStatus(alert.id, 'resolved')}
                              disabled={acknowledging === alert.id}
                              className="w-full bg-emerald-600 hover:bg-emerald-700 text-white text-[10px] font-bold tracking-[0.05em] uppercase px-3 py-2 rounded transition-colors disabled:opacity-50"
                            >
                              Resolve
                            </button>
                            <button
                              onClick={() => handleUpdateStatus(alert.id, 'false_alarm')}
                              disabled={acknowledging === alert.id}
                              className="w-full bg-gray-600 hover:bg-gray-700 text-white text-[10px] font-bold tracking-[0.05em] uppercase px-3 py-2 rounded transition-colors disabled:opacity-50"
                            >
                              False Alarm
                            </button>
                          </>
                        )}
                      </div>

                      <div className="grid grid-cols-2 gap-2 mt-1">
                        <a
                          href={alert.latitude && alert.longitude ? \`https://www.google.com/maps/dir/?api=1&destination=\${alert.latitude},\${alert.longitude}\` : '#'}
                          target="_blank"
                          rel="noreferrer"
                          className={\`flex items-center justify-center gap-1.5 w-full bg-white border border-gray-200 hover:bg-gray-50 text-gray-700 text-[10px] font-bold tracking-[0.05em] uppercase px-3 py-2 rounded transition-colors \${!(alert.latitude && alert.longitude) && 'opacity-50 pointer-events-none'}\`}
                        >
                          <Navigation className="w-3 h-3" /> Navigation
                        </a>
                        <a
                          href={bfpContact ? \`tel:\${bfpContact}\` : '#'}
                          className={\`flex items-center justify-center gap-1.5 w-full bg-white border border-gray-200 hover:bg-gray-50 text-gray-700 text-[10px] font-bold tracking-[0.05em] uppercase px-3 py-2 rounded transition-colors \${!bfpContact && 'opacity-50 pointer-events-none'}\`}
                        >
                          <PhoneCall className="w-3 h-3" /> Call Contact
                        </a>
                      </div>
                    </div>
                  </div>
                );
              })`;

// we need to also make sure bfp_contact is selected in the initial query. Let's check `fetchData`.
const fetchQueryOld = `supabase.from('alert_events').select('*, devices(device_code, label, location_desc)').order('triggered_at', { ascending: false }),`;
const fetchQueryNew = `supabase.from('alert_events').select('*, devices(device_code, label, location_desc, bfp_contact)').order('triggered_at', { ascending: false }),`;

code = code.replace(oldAlertBody, newAlertBody);
code = code.replace(fetchQueryOld, fetchQueryNew);

fs.writeFileSync(path, code);

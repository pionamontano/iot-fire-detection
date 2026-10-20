import React, { createContext, useContext, useEffect, useState } from 'react';
import type { Session, User } from '@supabase/supabase-js';
import { supabase, realtimeChannel } from '../lib/supabase';
import type { Profile } from '../lib/supabase';

interface AuthContextType {
  session: Session | null;
  user: User | null;
  profile: Profile | null;
  loading: boolean;
  signOut: () => Promise<void>;
}

// Fallback interval for re-reading the signed-in profile when no realtime
// event arrives (see the profile-sync effect below).
const PROFILE_RECHECK_MS = 60_000;

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider = ({ children }: { children: React.ReactNode }) => {
  const [session, setSession] = useState<Session | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Get initial session
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setUser(session?.user ?? null);
      if (session?.user) {
        fetchProfile(session.user.id);
      } else {
        setLoading(false);
      }
    });

    // Listen for auth changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (_event, session) => {
        setSession(session);
        setUser(session?.user ?? null);
        if (session?.user) {
          fetchProfile(session.user.id);
        } else {
          setProfile(null);
          setLoading(false);
        }
      }
    );

    return () => subscription.unsubscribe();
  }, []);

  // Keep the signed-in profile current, so an admin deactivating the account
  // (or changing its role/status) takes effect in an already-open app
  // instead of only on the next reload. Realtime pushes the change when the
  // profiles table is in the realtime publication; the focus check and the
  // poll cover projects where it is not, and dropped sockets.
  const userId = user?.id;
  useEffect(() => {
    if (!userId) return;
    const recheck = () => refreshProfile(userId);

    const channel = realtimeChannel(`own_profile_${userId}`)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'profiles', filter: `id=eq.${userId}` }, recheck)
      .subscribe();
    const onVisible = () => { if (document.visibilityState === 'visible') recheck(); };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', recheck);
    const timer = window.setInterval(recheck, PROFILE_RECHECK_MS);

    return () => {
      supabase.removeChannel(channel);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', recheck);
      window.clearInterval(timer);
    };
  }, [userId]);

  const fetchProfile = async (userId: string) => {
    try {
      const { data, error } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', userId)
        .single();

      if (error) throw error;
      setProfile(data);
    } catch (error) {
      console.error('Error fetching profile:', error);
      setProfile(null);
    } finally {
      setLoading(false);
    }
  };

  // Background re-check: unlike fetchProfile, a failed read (e.g. offline)
  // keeps the profile we have instead of dropping to the error screen.
  const refreshProfile = async (userId: string) => {
    const { data, error } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', userId)
      .single();
    if (error || !data) return;
    setProfile(prev => (prev && JSON.stringify(prev) === JSON.stringify(data) ? prev : data));
  };

  const signOut = async () => {
    await supabase.auth.signOut();
  };

  const value = {
    session,
    user,
    profile,
    loading,
    signOut,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};

import { useEffect, useRef } from 'react';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { getAccessToken } from '../api/client';
import { getTokenExpiry } from '../utils/jwt';

const WARN_BEFORE_MS = 2 * 60 * 1000;

export default function SessionWarning() {
  const { user } = useAuth();
  const toast = useToast();
  const warnedRef = useRef(false);

  useEffect(() => {
    if (!user) {
      warnedRef.current = false;
      return undefined;
    }

    const scheduleWarning = () => {
      const token = getAccessToken();
      const expiry = getTokenExpiry(token);
      if (!expiry) return undefined;

      const msUntilWarn = expiry - Date.now() - WARN_BEFORE_MS;
      if (msUntilWarn <= 0) {
        if (!warnedRef.current) {
          warnedRef.current = true;
          toast.warning('Your session will expire soon. Save your work or refresh the page.');
        }
        return undefined;
      }

      const timer = setTimeout(() => {
        if (!warnedRef.current) {
          warnedRef.current = true;
          toast.warning('Your session will expire in about 2 minutes. Save your work or refresh the page.');
        }
      }, msUntilWarn);

      return timer;
    };

    let timer = scheduleWarning();
    const interval = setInterval(() => {
      if (timer) clearTimeout(timer);
      timer = scheduleWarning();
    }, 30000);

    return () => {
      if (timer) clearTimeout(timer);
      clearInterval(interval);
    };
  }, [user, toast]);

  return null;
}

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react';
import {
  fetchCurrentUser,
  getStoredToken,
  loginUser,
  registerUser,
  setStoredToken,
  setUnauthorizedHandler,
} from '../services/api';
import type { PublicUser } from '../types';

export type AppRoute = '/login' | '/register' | '/chat';

interface AuthContextValue {
  user: PublicUser | null;
  token: string | null;
  isCheckingAuth: boolean;
  route: AppRoute;
  guardNotice: string | null;
  clearGuardNotice: () => void;
  navigate: (to: AppRoute) => void;
  login: (email: string, password: string) => Promise<void>;
  register: (params: {
    name: string;
    email: string;
    password: string;
    role?: string;
  }) => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

function normalizePathname(pathname: string): AppRoute {
  if (pathname === '/register') return '/register';
  if (pathname === '/chat') return '/chat';
  if (pathname === '/login') return '/login';
  return '/chat';
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<PublicUser | null>(null);
  const [token, setToken] = useState<string | null>(() => getStoredToken());
  const [isCheckingAuth, setIsCheckingAuth] = useState<boolean>(true);
  const [guardNotice, setGuardNotice] = useState<string | null>(null);
  const [route, setRoute] = useState<AppRoute>(() =>
    normalizePathname(window.location.pathname),
  );

  const navigate = useCallback((to: AppRoute) => {
    if (window.location.pathname !== to) {
      window.history.pushState({}, '', to);
    }
    setRoute(to);
  }, []);

  const logout = useCallback(() => {
    setStoredToken(null);
    setToken(null);
    setUser(null);
    navigate('/login');
  }, [navigate]);

  useEffect(() => {
    setUnauthorizedHandler(() => {
      setStoredToken(null);
      setToken(null);
      setUser(null);
      setGuardNotice('Your session expired. Please sign in again.');
      navigate('/login');
    });
    return () => setUnauthorizedHandler(null);
  }, [navigate]);

  // Verify existing token on initial load
  useEffect(() => {
    let active = true;
    const existingToken = getStoredToken();

    if (!existingToken) {
      setIsCheckingAuth(false);
      return;
    }

    fetchCurrentUser()
      .then(({ user: currentUser }) => {
        if (!active) return;
        setUser(currentUser);
        setToken(existingToken);
      })
      .catch(() => {
        if (!active) return;
        setStoredToken(null);
        setToken(null);
        setUser(null);
      })
      .finally(() => {
        if (active) setIsCheckingAuth(false);
      });

    return () => {
      active = false;
    };
  }, []);

  // Browser back/forward navigation support
  useEffect(() => {
    const handlePopState = () => {
      setRoute(normalizePathname(window.location.pathname));
    };
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  // Route guard: protect /chat and redirect authenticated users away from /login or /register
  useEffect(() => {
    if (isCheckingAuth) return;

    if (!user && route === '/chat') {
      if (window.location.pathname === '/chat') {
        setGuardNotice('Please sign in to access the chat dashboard.');
      }
      navigate('/login');
    } else if (user && (route === '/login' || route === '/register')) {
      setGuardNotice(null);
      navigate('/chat');
    }
  }, [isCheckingAuth, user, route, navigate]);

  const login = useCallback(
    async (email: string, password: string) => {
      const res = await loginUser(email, password);
      setStoredToken(res.token);
      setToken(res.token);
      setUser(res.user);
      setGuardNotice(null);
      navigate('/chat');
    },
    [navigate],
  );

  const register = useCallback(
    async (params: { name: string; email: string; password: string; role?: string }) => {
      const res = await registerUser(params);
      setStoredToken(res.token);
      setToken(res.token);
      setUser(res.user);
      setGuardNotice(null);
      navigate('/chat');
    },
    [navigate],
  );

  return (
    <AuthContext.Provider
      value={{
        user,
        token,
        isCheckingAuth,
        route,
        guardNotice,
        clearGuardNotice: () => setGuardNotice(null),
        navigate,
        login,
        register,
        logout,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth must be used inside AuthProvider');
  }
  return ctx;
}

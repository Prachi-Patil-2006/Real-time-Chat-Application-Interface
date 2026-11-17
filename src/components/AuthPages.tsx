import { useState, type FormEvent } from 'react';
import { Eye, EyeOff, Lock, Mail, MessageSquare, User, AlertCircle } from 'lucide-react';
import { useAuth } from '../context/AuthContext';

const TEAM_ACCOUNTS = [
  {
    name: 'Maya Lin',
    role: 'Product Designer',
    email: 'maya@relaychat.dev',
    avatarUrl: '/src/assets/images/avatar_maya_lin_1794927879498.jpg',
  },
  {
    name: 'Marcus Cole',
    role: 'Platform Engineer',
    email: 'marcus@relaychat.dev',
    avatarUrl: '/src/assets/images/avatar_marcus_cole_1794927879084.jpg',
  },
  {
    name: 'Elena Rostova',
    role: 'Engineering Lead',
    email: 'elena@relaychat.dev',
    avatarUrl: '/src/assets/images/avatar_elena_rostova_1794927879809.jpg',
  },
];

export function AuthPages() {
  const { route, navigate, login, register, guardNotice, clearGuardNotice } = useAuth();
  const isRegister = route === '/register';

  const [name, setName] = useState('');
  const [role, setRole] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const switchMode = (target: '/login' | '/register') => {
    setError(null);
    clearGuardNotice();
    navigate(target);
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);

    if (isRegister && name.trim().length < 2) {
      setError('Please enter your full name (at least 2 characters).');
      return;
    }
    if (!email.trim()) {
      setError('Please enter your email address.');
      return;
    }
    if (password.length < 6) {
      setError('Password must be at least 6 characters.');
      return;
    }

    setIsSubmitting(true);
    try {
      if (isRegister) {
        await register({
          name: name.trim(),
          email: email.trim(),
          password,
          role: role.trim() || undefined,
        });
      } else {
        await login(email.trim(), password);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Authentication failed.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleQuickFill = async (accountEmail: string) => {
    setError(null);
    setEmail(accountEmail);
    setPassword('password123');
    setIsSubmitting(true);
    try {
      await login(accountEmail, 'password123');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sign in failed.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col justify-center px-4 py-10 sm:px-6 lg:px-8">
      <div className="w-full max-w-5xl mx-auto grid grid-cols-1 lg:grid-cols-12 gap-10 lg:gap-12 items-center">
        {/* Left column: Brand context and multi-account quick testing */}
        <div className="lg:col-span-6 space-y-6">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-xl bg-teal-700 text-white flex items-center justify-center shrink-0">
              <MessageSquare className="h-5 w-5" />
            </div>
            <span className="text-xl font-bold tracking-tight text-slate-900 font-display">
              RelayChat
            </span>
          </div>

          <div className="space-y-3">
            <h1 className="text-3xl sm:text-4xl font-bold tracking-tight text-slate-900 text-balance leading-tight">
              Direct team messaging with live presence and instant file sharing.
            </h1>
            <p className="text-base text-slate-600 leading-relaxed max-w-lg">
              Sign in with your account or register a new profile. Open a second browser tab to test real-time WebSocket delivery and online status changes across two users simultaneously.
            </p>
          </div>

          {!isRegister && (
            <div className="pt-2 space-y-3">
              <p className="text-xs font-medium text-slate-500">
                Sample team accounts (password: password123)
              </p>
              <div className="divide-y divide-slate-200 border border-slate-200 rounded-xl bg-white overflow-hidden">
                {TEAM_ACCOUNTS.map((acct) => (
                  <button
                    key={acct.email}
                    type="button"
                    disabled={isSubmitting}
                    onClick={() => handleQuickFill(acct.email)}
                    className="w-full px-4 py-3 flex items-center justify-between gap-3 text-left hover:bg-slate-50 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-teal-600 disabled:opacity-60"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <img
                        src={acct.avatarUrl}
                        alt={acct.name}
                        referrerPolicy="no-referrer"
                        className="h-9 w-9 rounded-full object-cover border border-slate-200 shrink-0"
                      />
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-slate-900 truncate">
                          {acct.name}
                        </p>
                        <p className="text-xs text-slate-500 truncate">
                          {acct.role} · {acct.email}
                        </p>
                      </div>
                    </div>
                    <span className="text-xs font-semibold text-teal-700 whitespace-nowrap shrink-0">
                      Sign in
                    </span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Right column: Auth form card */}
        <div className="lg:col-span-6">
          <div className="bg-white border border-slate-200 rounded-2xl p-6 sm:p-8 max-w-md mx-auto w-full">
            <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg mb-6">
              <button
                type="button"
                onClick={() => switchMode('/login')}
                className={`flex-1 py-2 px-3 text-sm font-semibold rounded-md transition-colors whitespace-nowrap ${
                  !isRegister
                    ? 'bg-white text-slate-900 shadow-sm'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                Sign In
              </button>
              <button
                type="button"
                onClick={() => switchMode('/register')}
                className={`flex-1 py-2 px-3 text-sm font-semibold rounded-md transition-colors whitespace-nowrap ${
                  isRegister
                    ? 'bg-white text-slate-900 shadow-sm'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                Create Account
              </button>
            </div>

            <div className="mb-6">
              <h2 className="text-xl font-bold text-slate-900">
                {isRegister ? 'Create your account' : 'Welcome back'}
              </h2>
              <p className="text-sm text-slate-500 mt-1">
                {isRegister
                  ? 'Register to join the real-time workspace.'
                  : 'Enter your credentials to access your conversations.'}
              </p>
            </div>

            {guardNotice && (
              <div
                role="status"
                className="mb-4 px-3.5 py-2.5 rounded-lg bg-amber-50 border border-amber-200 text-amber-900 text-sm flex items-start gap-2.5"
              >
                <AlertCircle className="h-4 w-4 text-amber-700 shrink-0 mt-0.5" />
                <span>{guardNotice}</span>
              </div>
            )}

            {error && (
              <div
                role="alert"
                className="mb-4 px-3.5 py-2.5 rounded-lg bg-red-50 border border-red-200 text-red-800 text-sm flex items-start gap-2.5"
              >
                <AlertCircle className="h-4 w-4 text-red-600 shrink-0 mt-0.5" />
                <span>{error}</span>
              </div>
            )}

            <form onSubmit={handleSubmit} className="space-y-4" noValidate>
              {isRegister && (
                <>
                  <div>
                    <label
                      htmlFor="auth-name"
                      className="block text-sm font-medium text-slate-700 mb-1.5"
                    >
                      Full name
                    </label>
                    <div className="relative">
                      <User className="h-4 w-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                      <input
                        id="auth-name"
                        type="text"
                        autoComplete="name"
                        required
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        placeholder="Alex Rivera"
                        className="w-full h-11 pl-10 pr-3.5 rounded-lg border border-slate-300 bg-white text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:border-teal-700 focus:ring-2 focus:ring-teal-700/20"
                      />
                    </div>
                  </div>

                  <div>
                    <label
                      htmlFor="auth-role"
                      className="block text-sm font-medium text-slate-700 mb-1.5"
                    >
                      Role <span className="text-slate-400 font-normal">(optional)</span>
                    </label>
                    <input
                      id="auth-role"
                      type="text"
                      value={role}
                      onChange={(e) => setRole(e.target.value)}
                      placeholder="Frontend Engineer"
                      className="w-full h-11 px-3.5 rounded-lg border border-slate-300 bg-white text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:border-teal-700 focus:ring-2 focus:ring-teal-700/20"
                    />
                  </div>
                </>
              )}

              <div>
                <label
                  htmlFor="auth-email"
                  className="block text-sm font-medium text-slate-700 mb-1.5"
                >
                  Email address
                </label>
                <div className="relative">
                  <Mail className="h-4 w-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                  <input
                    id="auth-email"
                    type="email"
                    autoComplete="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="name@company.com"
                    className="w-full h-11 pl-10 pr-3.5 rounded-lg border border-slate-300 bg-white text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:border-teal-700 focus:ring-2 focus:ring-teal-700/20"
                  />
                </div>
              </div>

              <div>
                <label
                  htmlFor="auth-password"
                  className="block text-sm font-medium text-slate-700 mb-1.5"
                >
                  Password
                </label>
                <div className="relative">
                  <Lock className="h-4 w-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                  <input
                    id="auth-password"
                    type={showPassword ? 'text' : 'password'}
                    autoComplete={isRegister ? 'new-password' : 'current-password'}
                    required
                    minLength={6}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Minimum 6 characters"
                    className="w-full h-11 pl-10 pr-11 rounded-lg border border-slate-300 bg-white text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:border-teal-700 focus:ring-2 focus:ring-teal-700/20"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((prev) => !prev)}
                    aria-label={showPassword ? 'Hide password' : 'Show password'}
                    className="absolute right-2 top-1/2 -translate-y-1/2 h-8 w-8 flex items-center justify-center rounded-md text-slate-400 hover:text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-600"
                  >
                    {showPassword ? (
                      <EyeOff className="h-4 w-4" />
                    ) : (
                      <Eye className="h-4 w-4" />
                    )}
                  </button>
                </div>
              </div>

              <button
                type="submit"
                disabled={isSubmitting}
                className="w-full h-11 px-4 rounded-lg bg-teal-700 hover:bg-teal-800 text-white text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-teal-700 disabled:opacity-60 disabled:cursor-not-allowed"
              >
                {isSubmitting
                  ? isRegister
                    ? 'Creating account...'
                    : 'Signing in...'
                  : isRegister
                    ? 'Create account'
                    : 'Sign in to chat'}
              </button>
            </form>
          </div>
        </div>
      </div>
    </div>
  );
}

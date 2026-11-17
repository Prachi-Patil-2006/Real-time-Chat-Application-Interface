import { AuthPages } from './components/AuthPages';
import { ChatDashboard } from './components/ChatDashboard';
import { AuthProvider, useAuth } from './context/AuthContext';

function AppRouter() {
  const { user, isCheckingAuth, route } = useAuth();

  if (isCheckingAuth) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <div className="text-sm font-medium text-slate-600">
          Verifying session...
        </div>
      </div>
    );
  }

  if (!user || route === '/login' || route === '/register') {
    return <AuthPages />;
  }

  return <ChatDashboard />;
}

export default function App() {
  return (
    <AuthProvider>
      <AppRouter />
    </AuthProvider>
  );
}

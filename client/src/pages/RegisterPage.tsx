import React, { useState, useEffect } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { Loader2, KeyRound, Shield, Check, AlertCircle, RefreshCw } from 'lucide-react';

export const RegisterPage: React.FC = () => {
  const { register, verifyOtp, resendOtp, loginWithGoogle } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  const [step, setStep] = useState<'register' | 'otp'>(
    searchParams.get('step') === 'otp' ? 'otp' : 'register'
  );
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState(searchParams.get('email') || '');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState('agency');
  const [otp, setOtp] = useState('');

  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  // OTP Timers
  const [cooldown, setCooldown] = useState(60);
  const [otpExpiresIn, setOtpExpiresIn] = useState(600); // 10 minutes in seconds

  useEffect(() => {
    let timer: any;
    if (step === 'otp') {
      timer = setInterval(() => {
        setCooldown((prev) => (prev > 0 ? prev - 1 : 0));
        setOtpExpiresIn((prev) => (prev > 0 ? prev - 1 : 0));
      }, 1000);
    }
    return () => clearInterval(timer);
  }, [step]);

  // Password strength evaluation
  const hasMinLength = password.length >= 8;
  const hasLetter = /[a-zA-Z]/.test(password);
  const hasNumber = /[0-9]/.test(password);
  const hasSpecial = /[^a-zA-Z0-9]/.test(password);
  const isPasswordValid = hasMinLength && hasLetter && hasNumber;

  const getStrengthLevel = () => {
    let score = 0;
    if (hasMinLength) score++;
    if (hasLetter) score++;
    if (hasNumber) score++;
    if (hasSpecial) score++;
    if (password.length >= 12) score++;
    if (score <= 2) return { text: 'Weak', color: 'bg-rose-500', width: 'w-1/3' };
    if (score <= 4) return { text: 'Good', color: 'bg-amber-500', width: 'w-2/3' };
    return { text: 'Strong', color: 'bg-emerald-500', width: 'w-full' };
  };

  const strength = getStrengthLevel();

  const handleRegisterSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccessMsg(null);

    if (!isPasswordValid) {
      setError('Password must be at least 8 characters and contain both letters and numbers.');
      return;
    }

    setIsLoading(true);
    try {
      await register(fullName, email, password, role);
      setStep('otp');
      setCooldown(60);
      setOtpExpiresIn(600);
      setSuccessMsg('A 6-digit verification code has been dispatched to your email address.');
    } catch (err: any) {
      setError(err.error || 'Registration failed');
    } finally {
      setIsLoading(false);
    }
  };

  const handleOtpSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setIsLoading(true);
    try {
      await verifyOtp(email, otp);
      window.location.href = '/';
    } catch (err: any) {
      setError(err.error || 'OTP verification failed');
    } finally {
      setIsLoading(false);
    }
  };

  const handleResendOtp = async () => {
    if (cooldown > 0 || isLoading) return;
    setError(null);
    setSuccessMsg(null);
    setIsLoading(true);
    try {
      await resendOtp(email);
      setCooldown(60);
      setOtpExpiresIn(600);
      setSuccessMsg('A fresh verification code has been dispatched to your email address.');
    } catch (err: any) {
      setError(err.error || 'Failed to resend verification code');
    } finally {
      setIsLoading(false);
    }
  };

  const handleGoogleRegister = async () => {
    setError(null);
    setIsLoading(true);
    try {
      await loginWithGoogle();
      window.location.href = '/';
    } catch (err: any) {
      setError(err.error || 'Google OAuth is temporarily disabled. Please register with your PIL email and password.');
    } finally {
      setIsLoading(false);
    }
  };

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs < 10 ? '0' : ''}${secs}`;
  };

  return (
    <div className="min-h-screen bg-slate-100 flex flex-col justify-center py-12 sm:px-6 lg:px-8">
      <div className="sm:mx-auto sm:w-full sm:max-w-md">
        <div className="flex justify-center items-center gap-3">
          <div className="w-12 h-12 rounded-xl bg-[#ED1C24] flex items-center justify-center font-black text-white text-2xl shadow-md">
            PIL
          </div>
        </div>
        <h2 className="mt-4 text-center text-2xl font-bold tracking-tight text-slate-900">
          Create PIL Account
        </h2>
        <p className="mt-1 text-center text-xs font-semibold uppercase tracking-wider text-slate-500">
          Cargo Claim & Survey Management Platform
        </p>
      </div>

      <div className="mt-8 sm:mx-auto sm:w-full sm:max-w-md">
        <div className="bg-white py-8 px-6 shadow-sm border border-slate-200 rounded-2xl sm:px-10">
          {error && (
            <div className="mb-5 p-3 rounded-lg bg-rose-50 border border-rose-200 text-xs text-rose-700 flex items-start gap-2">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          {successMsg && (
            <div className="mb-5 p-3 rounded-lg bg-emerald-50 border border-emerald-200 text-xs text-emerald-800 flex items-start gap-2">
              <Check className="w-4 h-4 shrink-0 mt-0.5 text-emerald-600" />
              <span>{successMsg}</span>
            </div>
          )}

          {step === 'register' ? (
            <form className="space-y-4" onSubmit={handleRegisterSubmit}>
              <div>
                <label className="block text-[11px] font-semibold uppercase tracking-wider text-slate-600 mb-1">
                  Full Name
                </label>
                <input
                  type="text"
                  required
                  placeholder="e.g. John Doe"
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  className="w-full rounded-lg border border-slate-200 px-3.5 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div>
                <label className="block text-[11px] font-semibold uppercase tracking-wider text-slate-600 mb-1">
                  Work Email Address
                </label>
                <input
                  type="email"
                  required
                  placeholder="name@pilship.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full rounded-lg border border-slate-200 px-3.5 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div>
                <label className="block text-[11px] font-semibold uppercase tracking-wider text-slate-600 mb-1">
                  Password
                </label>
                <input
                  type="password"
                  required
                  placeholder="••••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full rounded-lg border border-slate-200 px-3.5 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />

                {/* Password strength indicator */}
                {password && (
                  <div className="mt-2 space-y-1.5">
                    <div className="flex items-center justify-between text-[11px] text-slate-500">
                      <span>Strength: <strong className="font-semibold text-slate-700">{strength.text}</strong></span>
                      <span>Min 8 characters &bull; letters + numbers</span>
                    </div>
                    <div className="w-full bg-slate-100 h-1.5 rounded-full overflow-hidden">
                      <div className={`h-full ${strength.color} ${strength.width} transition-all duration-300`} />
                    </div>
                  </div>
                )}
              </div>

              <div>
                <label className="block text-[11px] font-semibold uppercase tracking-wider text-slate-600 mb-1">
                  Organization Role
                </label>
                <select
                  value={role}
                  onChange={(e) => setRole(e.target.value)}
                  className="w-full rounded-lg border border-slate-200 px-3.5 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="agency">Agency (Port / Line Agent)</option>
                  <option value="mid">MID (Marine Insurance Dept)</option>
                  <option value="mid_gcc">MID GCC</option>
                  <option value="admin">System Administrator</option>
                </select>
                <p className="mt-1 text-[10px] text-slate-400">
                  Note: Public accounts default to Agency role. Elevated permissions require admin assignment.
                </p>
              </div>

              <div className="pt-2">
                <button
                  type="submit"
                  disabled={isLoading}
                  className="w-full flex justify-center items-center gap-2 py-2.5 px-4 border border-transparent rounded-lg shadow-xs text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 cursor-pointer disabled:opacity-50"
                >
                  {isLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Register Account'}
                </button>
              </div>

              {/* Google OAuth button */}
              <div className="pt-2">
                <div className="relative my-3">
                  <div className="absolute inset-0 flex items-center">
                    <div className="w-full border-t border-slate-200" />
                  </div>
                  <div className="relative flex justify-center text-xs uppercase">
                    <span className="bg-white px-2 text-slate-400">Or register with</span>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={handleGoogleRegister}
                  disabled={isLoading}
                  title="Google OAuth is temporarily disabled pending production identity provider integration"
                  className="w-full flex items-center justify-center gap-2 py-2 px-4 border border-slate-200 rounded-lg text-xs font-medium text-slate-700 bg-white hover:bg-slate-50 cursor-pointer"
                >
                  <svg className="w-4 h-4" viewBox="0 0 24 24">
                    <path
                      fill="#4285F4"
                      d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                    />
                    <path
                      fill="#34A853"
                      d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                    />
                    <path
                      fill="#FBBC05"
                      d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"
                    />
                    <path
                      fill="#EA4335"
                      d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"
                    />
                  </svg>
                  Google OAuth
                </button>
              </div>

              <div className="text-center pt-2">
                <span className="text-xs text-slate-500">Already have an account? </span>
                <Link to="/login" className="text-xs font-semibold text-blue-600 hover:text-blue-800">
                  Sign in
                </Link>
              </div>
            </form>
          ) : (
            <form className="space-y-4" onSubmit={handleOtpSubmit}>
              <div className="text-center pb-2">
                <div className="w-12 h-12 bg-blue-50 text-blue-600 rounded-full flex items-center justify-center mx-auto mb-2">
                  <KeyRound className="w-6 h-6" />
                </div>
                <h3 className="text-sm font-bold text-slate-900">Verify Your Email Address</h3>
                <p className="text-xs text-slate-500 mt-1">
                  We've dispatched a 6-digit verification code to <strong className="text-slate-700">{email}</strong>
                </p>
                <div className="mt-2 text-[11px] text-slate-500">
                  Code expires in: <strong className="text-slate-700 font-mono">{formatTime(otpExpiresIn)}</strong>
                </div>
              </div>

              <div>
                <label className="block text-[11px] font-semibold uppercase tracking-wider text-slate-600 mb-1 text-center">
                  Enter 6-Digit Code
                </label>
                <input
                  type="text"
                  required
                  maxLength={6}
                  placeholder="000000"
                  value={otp}
                  onChange={(e) => setOtp(e.target.value.replace(/\D/g, ''))}
                  className="w-full text-center tracking-widest text-2xl font-mono font-bold rounded-lg border border-slate-200 px-3.5 py-2.5 focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div className="pt-2">
                <button
                  type="submit"
                  disabled={isLoading || otp.length < 6 || otpExpiresIn === 0}
                  className="w-full flex justify-center items-center gap-2 py-2.5 px-4 border border-transparent rounded-lg shadow-xs text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 cursor-pointer disabled:opacity-50"
                >
                  {isLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Verify Code & Sign In'}
                </button>
              </div>

              {/* Resend OTP button with cooldown */}
              <div className="text-center pt-2">
                <button
                  type="button"
                  onClick={handleResendOtp}
                  disabled={cooldown > 0 || isLoading}
                  className="inline-flex items-center gap-1.5 text-xs font-medium text-blue-600 hover:text-blue-800 disabled:text-slate-400 cursor-pointer disabled:cursor-not-allowed"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : ''}`} />
                  {cooldown > 0 ? `Resend code in ${cooldown}s` : 'Resend verification code'}
                </button>
              </div>

              <div className="text-center pt-1 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setStep('register')}
                  className="text-xs text-slate-500 hover:text-slate-700 cursor-pointer"
                >
                  ← Back to registration
                </button>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  );
};

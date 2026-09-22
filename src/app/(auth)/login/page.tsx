'use client';

import { Suspense, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { createClient } from '@/lib/supabase/client';
import { Button, buttonVariants } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Eye, EyeOff, UsersRound } from 'lucide-react';
import { BrandLogoMark } from '@/components/brand/brand-logo';

// `useSearchParams` opts the component out of static prerendering
// unless it sits under a Suspense boundary. We split the form into
// a child component so the outer page can prerender the chrome
// (background, card frame) while the form hydrates with the query
// string on the client.
export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginPageInner />
    </Suspense>
  );
}

function LoginPageInner() {
  const searchParams = useSearchParams();
  // Forwarded from `/join/<token>` when the visitor already has an
  // account. After a successful sign-in we send them to the join
  // page to accept rather than to /dashboard.
  const inviteToken = searchParams.get('invite');
  const t = useTranslations('LoginPage');

  const dashboardUrl = (
    process.env.NEXT_PUBLIC_RECOVER_AGENT_DASHBOARD_URL ||
    'https://dashboard.recoveragent.ai'
  ).replace(/\/+$/, '');
  const dashboardSsoUrl = `${dashboardUrl}/?sso=wa`;
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showLegacyLogin, setShowLegacyLogin] = useState(() =>
    Boolean(inviteToken || searchParams.get('error'))
  );
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const supabase = createClient();

  useEffect(() => {
    const urlError = searchParams.get('error');
    if (urlError) setError(urlError);
  }, [searchParams]);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    const { error: signInError } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (signInError) {
      setError(signInError.message);
      setLoading(false);
      return;
    }

    // Confirm the browser client persisted the session before we
    // navigate — otherwise middleware can miss the cookies on the
    // first /dashboard request and bounce back to /login.
    const {
      data: { session },
      error: sessionError,
    } = await supabase.auth.getSession();

    if (sessionError || !session) {
      setError(
        sessionError?.message ??
          'Sign-in succeeded but the session could not be established. Try again.'
      );
      setLoading(false);
      return;
    }

    const target = inviteToken
      ? `/join/${encodeURIComponent(inviteToken)}`
      : '/dashboard';
    // Full navigation so proxy/middleware reads the fresh auth cookies.
    window.location.assign(target);
  };

  return (
    <div className="bg-background flex min-h-screen items-center justify-center px-4">
      <Card className="border-border bg-card w-full max-w-md">
        <CardHeader className="items-center text-center">
          {inviteToken ? (
            <div className="bg-primary/10 mb-2 flex h-12 w-12 items-center justify-center rounded-xl">
              <UsersRound className="text-primary h-6 w-6" />
            </div>
          ) : (
            <BrandLogoMark className="mb-3" />
          )}
          <CardTitle className="text-foreground text-xl">
            {inviteToken
              ? t('titleAccept')
              : showLegacyLogin
                ? t('legacyTitle')
                : t('dashboardTitle')}
          </CardTitle>
          <CardDescription className="text-muted-foreground">
            {inviteToken
              ? t('descAccept')
              : showLegacyLogin
                ? t('legacyDesc')
                : t('dashboardDesc')}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {!showLegacyLogin && !inviteToken ? (
            <div className="flex flex-col gap-4">
              <a
                href={dashboardSsoUrl}
                className={buttonVariants({
                  className: 'h-10 w-full',
                })}
              >
                {t('continueDashboard')}
              </a>
              <button
                type="button"
                onClick={() => setShowLegacyLogin(true)}
                className="text-primary mx-auto text-sm underline-offset-4 hover:underline"
              >
                {t('useLegacy')}
              </button>
            </div>
          ) : (
            <>
              <form onSubmit={handleLogin} className="flex flex-col gap-4">
                {error && (
                  <div className="border-destructive/40 bg-destructive/10 text-destructive rounded-md border px-4 py-3 text-sm">
                    {error}
                  </div>
                )}

                <div className="flex flex-col gap-2">
                  <Label htmlFor="email" className="text-muted-foreground">
                    {t('emailLabel')}
                  </Label>
                  <Input
                    id="email"
                    type="email"
                    placeholder={t('emailPlaceholder')}
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                    className="border-border bg-background text-foreground placeholder:text-muted-foreground"
                  />
                </div>

                <div className="flex flex-col gap-2">
                  <div className="flex items-center justify-between">
                    <Label htmlFor="password" className="text-muted-foreground">
                      {t('passwordLabel')}
                    </Label>
                    <Link
                      href="/forgot-password"
                      className="text-primary hover:text-primary/80 text-sm"
                    >
                      {t('forgotPassword')}
                    </Link>
                  </div>
                  <div className="relative">
                    <Input
                      id="password"
                      type={showPassword ? 'text' : 'password'}
                      placeholder={t('passwordPlaceholder')}
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      required
                      className="border-border bg-background text-foreground placeholder:text-muted-foreground pr-10"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword((v) => !v)}
                      className="text-muted-foreground hover:text-foreground absolute top-1/2 right-2 -translate-y-1/2 transition-colors"
                      aria-label={
                        showPassword ? 'Hide password' : 'Show password'
                      }
                    >
                      {showPassword ? (
                        <EyeOff className="size-4" />
                      ) : (
                        <Eye className="size-4" />
                      )}
                    </button>
                  </div>
                </div>

                <Button
                  type="submit"
                  disabled={loading}
                  className="bg-primary text-primary-foreground hover:bg-primary/90 mt-2 h-10 w-full disabled:opacity-50"
                >
                  {loading ? t('signingIn') : t('signIn')}
                </Button>
              </form>

              <p className="text-muted-foreground mt-6 text-center text-sm">
                {t('noAccount')}{' '}
                <Link
                  href={
                    inviteToken
                      ? `/signup?invite=${encodeURIComponent(inviteToken)}`
                      : '/signup'
                  }
                  className="text-primary hover:text-primary/80"
                >
                  {t('createAccount')}
                </Link>
              </p>
              {!inviteToken && (
                <button
                  type="button"
                  onClick={() => setShowLegacyLogin(false)}
                  className="text-primary mx-auto mt-4 block text-sm underline-offset-4 hover:underline"
                >
                  {t('backDashboard')}
                </button>
              )}
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

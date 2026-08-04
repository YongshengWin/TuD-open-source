"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, Check, ChevronDown, Fingerprint, KeyRound, LockKeyhole, Mail, Megaphone, RotateCw } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { authClient } from "../../lib/auth-client";
import { composeRegistrationEmail, isAllowedRegistrationEmail, REGISTRATION_EMAIL_DOMAIN_ERROR, REGISTRATION_EMAIL_LOCAL_ERROR, REGISTRATION_EMAIL_OPTIONS } from "../../lib/email-domain-policy";

type EmailCapacity = { available: boolean; resetsAt: string | null; temporarilyUnavailable?: boolean; announcement?: string | null };

export default function LoginPage() {
  const [mode, setMode] = useState<"login" | "register">("login");
  const [recoveryStep, setRecoveryStep] = useState<"request" | "reset" | null>(null);
  const [recoveryEmail, setRecoveryEmail] = useState("");
  const [recoveryCode, setRecoveryCode] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [verificationEmail, setVerificationEmail] = useState("");
  const [verificationCode, setVerificationCode] = useState("");
  const [resendIn, setResendIn] = useState(0);
  const [emailCapacity, setEmailCapacity] = useState<EmailCapacity | null>(null);
  const [registrationDomain, setRegistrationDomain] = useState("gmail.com");
  const [domainPickerOpen, setDomainPickerOpen] = useState(false);
  const domainPickerRef = useRef<HTMLDivElement>(null);

  const emailIntakeAvailable = emailCapacity?.available === true;
  const capacityMessage = "今日邮件系统已经关闭，注册、密码找回功能不可用";
  const authAnnouncement = emailCapacity && !emailCapacity.available
    ? capacityMessage
    : emailCapacity?.announcement;

  useEffect(() => {
    let active = true;
    void fetch("/api/email-capacity", { cache: "no-store" })
      .then(async (response) => ({ response, data: await response.json() as EmailCapacity }))
      .then(({ data }) => {
        if (!active) return;
        setEmailCapacity(data);
        if (!data.available) {
          setMode((current) => current === "register" ? "login" : current);
          setRecoveryStep((current) => current === "request" ? null : current);
        }
      })
      .catch(() => {
        if (!active) return;
        setEmailCapacity({ available: false, resetsAt: null, temporarilyUnavailable: true });
        setMode((current) => current === "register" ? "login" : current);
        setRecoveryStep((current) => current === "request" ? null : current);
      });
    return () => { active = false; };
  }, []);

  function showAuthError(authError: { code?: string; message?: string }, fallback: string) {
    if (authError.code === "EMAIL_DAILY_QUOTA_EXHAUSTED") {
      setEmailCapacity({ available: false, resetsAt: null, announcement: emailCapacity?.announcement });
    }
    setError(authError.message ?? fallback);
  }

  useEffect(() => {
    if (resendIn <= 0) return;
    const timer = window.setInterval(() => setResendIn((value) => Math.max(0, value - 1)), 1000);
    return () => window.clearInterval(timer);
  }, [resendIn]);

  useEffect(() => {
    if (!domainPickerOpen) return;
    function closeDomainPicker(event: PointerEvent) {
      if (!domainPickerRef.current?.contains(event.target as Node)) setDomainPickerOpen(false);
    }
    function closeDomainPickerWithKeyboard(event: KeyboardEvent) {
      if (event.key === "Escape") setDomainPickerOpen(false);
    }
    document.addEventListener("pointerdown", closeDomainPicker);
    document.addEventListener("keydown", closeDomainPickerWithKeyboard);
    return () => {
      document.removeEventListener("pointerdown", closeDomainPicker);
      document.removeEventListener("keydown", closeDomainPickerWithKeyboard);
    };
  }, [domainPickerOpen]);

  useEffect(() => {
    if (typeof PublicKeyCredential === "undefined" || !PublicKeyCredential.isConditionalMediationAvailable) return;
    void PublicKeyCredential.isConditionalMediationAvailable().then((available) => {
      if (available) void authClient.signIn.passkey({ autoFill: true, fetchOptions: { onSuccess: () => { window.location.href = "/"; } } });
    });
  }, []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (mode === "register" && !emailIntakeAvailable) return;
    setPending(true);
    setError("");
    const data = new FormData(event.currentTarget);
    const registrationEmail = mode === "register"
      ? composeRegistrationEmail(String(data.get("emailLocal") ?? ""), String(data.get("emailDomain") ?? ""))
      : null;
    if (mode === "register" && !registrationEmail) {
      setError(REGISTRATION_EMAIL_LOCAL_ERROR);
      setPending(false);
      return;
    }
    const email = registrationEmail ?? String(data.get("email") ?? "");
    const password = String(data.get("password") ?? "");
    if (mode === "register" && !isAllowedRegistrationEmail(email)) {
      setError(REGISTRATION_EMAIL_DOMAIN_ERROR);
      setPending(false);
      return;
    }
    const result = mode === "register"
      ? await authClient.signUp.email({ email, password, name: String(data.get("name") ?? "") })
      : await authClient.signIn.email({ email, password });
    if (result.error) {
      if (mode === "login" && result.error.code === "EMAIL_NOT_VERIFIED") {
        setVerificationEmail(email.trim().toLowerCase());
        setNotice("验证码已发送到你的邮箱，请以最新一封为准。");
        setResendIn(60);
        setPending(false);
        return;
      }
      showAuthError(result.error, "操作失败，请稍后再试");
      setPending(false);
      return;
    }
    if (mode === "register") {
      setVerificationEmail(email.trim().toLowerCase());
      setNotice("验证码已发送，10 分钟内有效。");
      setResendIn(60);
      setPending(false);
      return;
    }
    window.location.href = "/";
  }

  async function verifyEmail(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError("");
    const result = await authClient.emailOtp.verifyEmail({ email: verificationEmail, otp: verificationCode });
    if (result.error) {
      setError(result.error.message ?? "验证码无效或已过期");
      setPending(false);
      return;
    }
    window.location.href = "/";
  }

  async function resendVerification() {
    if (resendIn > 0 || !emailIntakeAvailable) return;
    setPending(true);
    setError("");
    setNotice("");
    const result = await authClient.emailOtp.sendVerificationOtp({ email: verificationEmail, type: "email-verification" });
    setPending(false);
    if (result.error) {
      showAuthError(result.error, "暂时无法发送验证码");
      return;
    }
    setVerificationCode("");
    setNotice("新的验证码已发送，请以最新一封为准。");
    setResendIn(60);
  }

  function leaveVerification() {
    setVerificationEmail("");
    setVerificationCode("");
    setNotice("");
    setError("");
    setPending(false);
  }

  function leaveRecovery(successMessage = "") {
    setRecoveryStep(null);
    setRecoveryEmail("");
    setRecoveryCode("");
    setMode("login");
    setNotice(successMessage);
    setError("");
    setResendIn(0);
    setPending(false);
  }

  async function requestPasswordReset(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!emailIntakeAvailable) return;
    setPending(true);
    setError("");
    setNotice("");
    const data = new FormData(event.currentTarget);
    const email = String(data.get("email") ?? "").trim().toLowerCase();
    const result = await authClient.emailOtp.requestPasswordReset({ email });
    setPending(false);
    if (result.error) {
      showAuthError(result.error, "暂时无法发送验证码，请稍后再试");
      return;
    }
    setRecoveryEmail(email);
    setRecoveryCode("");
    setRecoveryStep("reset");
    setNotice("如果该邮箱已注册，重置验证码已发送，10 分钟内有效。");
    setResendIn(60);
  }

  async function resendPasswordReset() {
    if (resendIn > 0 || !recoveryEmail || !emailIntakeAvailable) return;
    setPending(true);
    setError("");
    setNotice("");
    const result = await authClient.emailOtp.requestPasswordReset({ email: recoveryEmail });
    setPending(false);
    if (result.error) {
      showAuthError(result.error, "暂时无法发送验证码，请稍后再试");
      return;
    }
    setRecoveryCode("");
    setNotice("新的重置验证码已发送，请以最新一封为准。");
    setResendIn(60);
  }

  async function resetPassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError("");
    const data = new FormData(event.currentTarget);
    const password = String(data.get("password") ?? "");
    const confirmation = String(data.get("passwordConfirmation") ?? "");
    if (password !== confirmation) {
      setError("两次输入的密码不一致");
      setPending(false);
      return;
    }
    const result = await authClient.emailOtp.resetPassword({ email: recoveryEmail, otp: recoveryCode, password });
    if (result.error) {
      setError(result.error.message ?? "验证码无效或已过期");
      setPending(false);
      return;
    }
    leaveRecovery("密码已重置，请使用新密码登录。");
  }

  async function signInWithPasskey() {
    setPending(true);
    setError("");
    const result = await authClient.signIn.passkey();
    if (result.error) {
      setError(result.error.message ?? "未找到可用的 Passkey");
      setPending(false);
      return;
    }
    window.location.href = "/";
  }

  return (
    <main className="auth-page">
      <div className="auth-topbar">
        <Link className="auth-brand auth-brand-minimal" href="/"><Image src="/tud-mark.png" alt="" width={32} height={32} unoptimized />TuD</Link>
      </div>
      <section className="auth-panel">
        <div className="auth-card">
          {recoveryStep === "request" ? (
            <>
              <div className="auth-title auth-title-with-copy"><h2>找回密码</h2><p>输入注册邮箱，我们会发送一枚 6 位重置验证码。</p></div>
              <form className="auth-form auth-recovery-form" onSubmit={requestPasswordReset}>
                <label><span>邮箱</span><div><Mail size={17} /><input name="email" type="email" required autoFocus placeholder="you@example.com" autoComplete="email" /></div></label>
                {error && <p className="auth-error" role="alert">{error}</p>}
                <button className="auth-primary" disabled={pending}>{pending ? "正在发送…" : "发送重置验证码"}<ArrowRight size={17} /></button>
              </form>
              <div className="auth-verify-actions"><button type="button" onClick={() => leaveRecovery()}><ArrowLeft size={14} />返回登录</button></div>
            </>
          ) : recoveryStep === "reset" ? (
            <>
              <div className="auth-title auth-title-with-copy"><h2>设置新密码</h2><p>输入发送至 <strong>{recoveryEmail}</strong> 的验证码。</p></div>
              <form className="auth-form auth-recovery-form" onSubmit={resetPassword}>
                <label><span>验证码</span><div><KeyRound size={17} /><input className="auth-code-input" value={recoveryCode} onChange={(event) => setRecoveryCode(event.target.value.replace(/\D/g, "").slice(0, 6))} inputMode="numeric" pattern="[0-9]{6}" minLength={6} maxLength={6} required autoFocus autoComplete="one-time-code" placeholder="000000" /></div></label>
                <label><span>新密码</span><div><LockKeyhole size={17} /><input name="password" type="password" required minLength={10} maxLength={128} autoComplete="new-password" placeholder="至少 10 位" /></div></label>
                <label><span>确认新密码</span><div><LockKeyhole size={17} /><input name="passwordConfirmation" type="password" required minLength={10} maxLength={128} autoComplete="new-password" placeholder="再次输入新密码" /></div></label>
                {notice && <p className="auth-notice">{notice}</p>}
                {error && <p className="auth-error" role="alert">{error}</p>}
                <button className="auth-primary" disabled={pending || recoveryCode.length !== 6}>{pending ? "正在重置…" : "重置密码"}<ArrowRight size={17} /></button>
              </form>
              <div className="auth-verify-actions">
                <button type="button" onClick={() => leaveRecovery()}><ArrowLeft size={14} />返回登录</button>
                <button type="button" disabled={pending || resendIn > 0 || !emailIntakeAvailable} onClick={resendPasswordReset}><RotateCw size={14} />{resendIn > 0 ? `${resendIn} 秒后重发` : "重新发送"}</button>
              </div>
            </>
          ) : verificationEmail ? (
            <>
              <div className="auth-title auth-title-with-copy"><h2>验证邮箱</h2><p>输入发送至 <strong>{verificationEmail}</strong> 的 6 位验证码。</p></div>
              <form className="auth-form auth-verify-form" onSubmit={verifyEmail}>
                <label><span>验证码</span><div><KeyRound size={17} /><input value={verificationCode} onChange={(event) => setVerificationCode(event.target.value.replace(/\D/g, "").slice(0, 6))} inputMode="numeric" pattern="[0-9]{6}" minLength={6} maxLength={6} required autoFocus autoComplete="one-time-code" placeholder="000000" /></div></label>
                {notice && <p className="auth-notice">{notice}</p>}
                {error && <p className="auth-error" role="alert">{error}</p>}
                <button className="auth-primary" disabled={pending || verificationCode.length !== 6}>{pending ? "正在验证…" : "验证并进入"}<ArrowRight size={17} /></button>
              </form>
              <div className="auth-verify-actions">
                <button type="button" onClick={leaveVerification}><ArrowLeft size={14} />返回</button>
                <button type="button" disabled={pending || resendIn > 0 || !emailIntakeAvailable} onClick={resendVerification}><RotateCw size={14} />{resendIn > 0 ? `${resendIn} 秒后重发` : "重新发送"}</button>
              </div>
            </>
          ) : (
            <>
              <div className="auth-title"><h2>{mode === "login" ? "登录" : "注册"}</h2></div>
              {authAnnouncement && <div className="auth-announcement" role="status"><Megaphone size={15} /><p>{authAnnouncement}</p></div>}
              <div className="auth-switch"><button className={mode === "login" ? "active" : ""} onClick={() => { setMode("login"); setError(""); setNotice(""); }}>登录</button><button className={mode === "register" ? "active" : ""} disabled={!emailIntakeAvailable} onClick={() => { setMode("register"); setError(""); setNotice(""); }}>注册</button></div>
              <form className="auth-form" onSubmit={submit}>
                {mode === "register" && <label><span>昵称</span><div><input name="name" required maxLength={40} placeholder="怎么称呼你" autoComplete="name" /></div></label>}
                {mode === "register" ? <label><span>邮箱</span><div className="auth-email-composer"><Mail size={17} /><input name="emailLocal" required maxLength={64} placeholder="邮箱账号" autoComplete="off" /><div className="auth-domain-picker" ref={domainPickerRef}><input type="hidden" name="emailDomain" value={registrationDomain} /><button type="button" className="auth-domain-trigger" aria-haspopup="listbox" aria-expanded={domainPickerOpen} onClick={() => setDomainPickerOpen((open) => !open)}>@{registrationDomain}<ChevronDown size={14} /></button>{domainPickerOpen && <div className="auth-domain-menu" role="listbox" aria-label="邮箱后缀">{REGISTRATION_EMAIL_OPTIONS.map(([domain, domainLabel]) => <button key={domain} type="button" role="option" aria-selected={domain === registrationDomain} onClick={() => { setRegistrationDomain(domain); setDomainPickerOpen(false); }}><span><strong>{domainLabel}</strong><small>@{domain}</small></span>{domain === registrationDomain && <Check size={15} />}</button>)}</div>}</div></div></label> : <label><span>邮箱</span><div><Mail size={17} /><input name="email" type="email" required placeholder="you@example.com" autoComplete="username webauthn" /></div></label>}
                <div className="auth-form-field"><span className="auth-field-label"><label htmlFor="auth-password">密码</label>{mode === "login" && <button type="button" disabled={!emailIntakeAvailable} onClick={() => { setRecoveryStep("request"); setError(""); setNotice(""); }}>忘记密码？</button>}</span><div className="auth-input-shell"><LockKeyhole size={17} /><input id="auth-password" name="password" type="password" required minLength={10} maxLength={128} placeholder="至少 10 位" autoComplete={mode === "login" ? "current-password webauthn" : "new-password"} /></div></div>
                {notice && <p className="auth-notice">{notice}</p>}
                {error && <p className="auth-error" role="alert">{error}</p>}
                <button className="auth-primary" disabled={pending}>{pending ? "请稍候…" : mode === "login" ? "登录" : "创建账号"}<ArrowRight size={17} /></button>
              </form>
              {mode === "login" && <button className="passkey-button" disabled={pending} onClick={signInWithPasskey}><Fingerprint size={19} /><strong>使用 Passkey</strong></button>}
            </>
          )}
        </div>
      </section>
    </main>
  );
}

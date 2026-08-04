"use client";

import { useEffect, useState } from "react";
import { Check, Fingerprint, House, KeyRound, Laptop, LockKeyhole, Mail, Plus, RotateCw, ShieldCheck, Trash2, X } from "lucide-react";
import Link from "next/link";
import { authClient } from "../../../lib/auth-client";

type PasskeyItem = { id: string; name?: string | null; createdAt?: Date | string | null; deviceType: string };

export function SecurityPanel({ name, email, initialHasPassword }: { name: string; email: string; initialHasPassword: boolean }) {
  const [items, setItems] = useState<PasskeyItem[]>([]);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");
  const [currentEmail, setCurrentEmail] = useState(email);
  const [emailStep, setEmailStep] = useState<"closed" | "prepare" | "current" | "new">("closed");
  const [newEmail, setNewEmail] = useState("");
  const [currentCode, setCurrentCode] = useState("");
  const [newCode, setNewCode] = useState("");
  const [emailPending, setEmailPending] = useState(false);
  const [emailMessage, setEmailMessage] = useState("");
  const [emailError, setEmailError] = useState("");
  const [emailCooldown, setEmailCooldown] = useState(0);
  const [passwordOpen, setPasswordOpen] = useState(false);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [passwordConfirmation, setPasswordConfirmation] = useState("");
  const [passwordPending, setPasswordPending] = useState(false);
  const [passwordMessage, setPasswordMessage] = useState("");
  const [passwordError, setPasswordError] = useState("");
  const [hasPassword, setHasPassword] = useState(initialHasPassword);
  const [passwordDeleteOpen, setPasswordDeleteOpen] = useState(false);
  const [deletePassword, setDeletePassword] = useState("");
  const [deletePasswordPending, setDeletePasswordPending] = useState(false);

  useEffect(() => {
    if (emailCooldown <= 0) return;
    const timer = window.setInterval(() => setEmailCooldown((value) => Math.max(0, value - 1)), 1000);
    return () => window.clearInterval(timer);
  }, [emailCooldown]);

  async function load() {
    const result = await authClient.passkey.listUserPasskeys();
    if (result.data) setItems(result.data as PasskeyItem[]);
  }

  useEffect(() => {
    void authClient.passkey.listUserPasskeys().then((result) => {
      if (result.data) setItems(result.data as PasskeyItem[]);
    });
  }, []);

  async function addPasskey() {
    if (!(window.isSecureContext && "PublicKeyCredential" in window)) {
      setMessage("当前浏览器环境不支持 Passkey，请使用 HTTPS 或 localhost，并升级浏览器。");
      return;
    }
    setPending(true); setMessage("请在系统弹窗中完成 Touch ID、Face ID、Windows Hello 或设备密码验证。不要关闭此页面。");
    const result = await authClient.passkey.addPasskey({ name: "当前设备", authenticatorAttachment: "platform" });
    setPending(false);
    if (result.error) {
      const code = "code" in result.error ? result.error.code : "";
      if (/ABORT|CANCEL/i.test(code)) return setMessage("Passkey 创建已取消，请重新点击添加并完成系统验证。");
      if (/TIMEOUT|TIMED_OUT|NOT_ALLOWED/i.test(code) || /timed?\s*out|timeout/i.test(result.error.message ?? "")) {
        return setMessage("Passkey 创建超时。请重新尝试，并在系统弹窗出现后立即完成验证。");
      }
      return setMessage(result.error.message ?? "Passkey 添加失败");
    }
    setMessage("Passkey 已添加，可以用它登录了。");
    await load();
  }

  async function removePasskey(id: string) {
    setPending(true); setMessage("");
    const result = await authClient.passkey.deletePasskey({ id });
    setPending(false);
    if (result.error) return setMessage(result.error.message ?? "删除失败");
    await load();
  }

  function resetEmailFlow() {
    setEmailStep("closed");
    setNewEmail("");
    setCurrentCode("");
    setNewCode("");
    setEmailError("");
    setEmailMessage("");
    setEmailPending(false);
  }

  async function sendCurrentEmailCode() {
    const normalized = newEmail.trim().toLowerCase();
    setEmailError("");
    setEmailMessage("");
    if (!/^\S+@\S+\.\S+$/.test(normalized)) return setEmailError("请输入有效的新邮箱地址");
    if (normalized === currentEmail.toLowerCase()) return setEmailError("新邮箱不能与当前邮箱相同");
    setEmailPending(true);
    const result = await authClient.emailOtp.sendVerificationOtp({ email: currentEmail, type: "email-verification" });
    setEmailPending(false);
    if (result.error) return setEmailError(result.error.message ?? "暂时无法发送验证码");
    setNewEmail(normalized);
    setCurrentCode("");
    setEmailStep("current");
    setEmailCooldown(60);
    setEmailMessage("验证码已发送到当前邮箱，10 分钟内有效。");
  }

  async function verifyCurrentAndSendNew() {
    setEmailError("");
    setEmailMessage("");
    setEmailPending(true);
    const result = await authClient.emailOtp.requestEmailChange({ newEmail, otp: currentCode });
    setEmailPending(false);
    if (result.error) return setEmailError(result.error.message ?? "当前邮箱验证码无效或已过期");
    setEmailStep("new");
    setNewCode("");
    setEmailMessage("当前邮箱已确认。验证码已发送到新邮箱。");
  }

  async function confirmNewEmail() {
    setEmailError("");
    setEmailMessage("");
    setEmailPending(true);
    const result = await authClient.emailOtp.changeEmail({ newEmail, otp: newCode });
    setEmailPending(false);
    if (result.error) return setEmailError(result.error.message ?? "新邮箱验证码无效或已过期");
    setCurrentEmail(newEmail);
    setEmailStep("closed");
    setCurrentCode("");
    setNewCode("");
    setEmailMessage(`登录邮箱已更新为 ${newEmail}`);
  }

  function closePasswordFlow() {
    setPasswordOpen(false);
    setCurrentPassword("");
    setNewPassword("");
    setPasswordConfirmation("");
    setPasswordError("");
    setPasswordPending(false);
  }

  async function changePassword() {
    setPasswordError("");
    setPasswordMessage("");
    if (newPassword.length < 10) return setPasswordError("新密码至少需要 10 位");
    if (newPassword !== passwordConfirmation) return setPasswordError("两次输入的新密码不一致");
    if (newPassword === currentPassword) return setPasswordError("新密码不能与当前密码相同");
    setPasswordPending(true);
    const result = await authClient.changePassword({ currentPassword, newPassword, revokeOtherSessions: true });
    setPasswordPending(false);
    if (result.error) return setPasswordError(result.error.message ?? "当前密码不正确或修改失败");
    closePasswordFlow();
    setPasswordMessage("密码已更新，其他设备上的登录会话已退出。");
  }

  function closeDeletePassword() {
    setPasswordDeleteOpen(false);
    setDeletePassword("");
    setPasswordError("");
    setDeletePasswordPending(false);
  }

  async function removePasswordLogin() {
    setPasswordError("");
    setPasswordMessage("");
    if (!items.length) return setPasswordError("必须先添加至少一个 Passkey，才能删除密码登录");
    setDeletePasswordPending(true);
    const response = await fetch("/api/security/password", {
      method: "DELETE",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ currentPassword: deletePassword }),
    });
    const result = await response.json().catch(() => ({})) as { error?: string };
    setDeletePasswordPending(false);
    if (!response.ok) return setPasswordError(result.error ?? "暂时无法删除密码登录");
    setHasPassword(false);
    closeDeletePassword();
    setPasswordMessage("密码登录已关闭，请使用 Passkey 登录。需要恢复时可通过“忘记密码”重新设置。");
  }

  return <main className="security-page">
    <header className="security-header"><Link href="/" className="back-link"><House size={16} />返回</Link></header>
    <div className="security-wrap">
      <div className="security-heading"><span>ACCOUNT SECURITY</span><h1>账户与安全</h1><p>{name} · {currentEmail}</p></div>
      <section className="security-card-main email-security-card">
        <div className="security-card-title">
          <span><Mail size={22} /></span>
          <div><h2>登录邮箱</h2><p>{currentEmail}</p></div>
          {emailStep === "closed" ? <button onClick={() => { setEmailStep("prepare"); setEmailError(""); setEmailMessage(""); }}>修改邮箱</button> : <button className="security-quiet-button" onClick={resetEmailFlow}><X size={15} />取消</button>}
        </div>

        {emailStep !== "closed" && (
          <div className="email-change-flow">
            <ol aria-label="修改邮箱进度">
              <li className={emailStep === "prepare" || emailStep === "current" || emailStep === "new" ? "active" : ""}><span>1</span>新邮箱</li>
              <li className={emailStep === "current" || emailStep === "new" ? "active" : ""}><span>2</span>确认当前邮箱</li>
              <li className={emailStep === "new" ? "active" : ""}><span>3</span>确认新邮箱</li>
            </ol>

            {emailStep === "prepare" && (
              <div className="email-change-stage">
                <label><span>新邮箱</span><div><Mail size={16} /><input type="email" value={newEmail} onChange={(event) => setNewEmail(event.target.value)} autoComplete="email" placeholder="new@example.com" autoFocus /></div></label>
                <button onClick={sendCurrentEmailCode} disabled={emailPending}>{emailPending ? "正在发送…" : "发送验证邮件"}</button>
                <p>先确认当前邮箱，再向新邮箱发送最终验证码。</p>
              </div>
            )}

            {emailStep === "current" && (
              <div className="email-change-stage">
                <label><span>当前邮箱验证码</span><div><KeyRound size={16} /><input value={currentCode} onChange={(event) => setCurrentCode(event.target.value.replace(/\D/g, "").slice(0, 6))} inputMode="numeric" autoComplete="one-time-code" placeholder="6 位验证码" autoFocus /></div></label>
                <button onClick={verifyCurrentAndSendNew} disabled={emailPending || currentCode.length !== 6}>{emailPending ? "正在验证…" : "确认并发送到新邮箱"}</button>
                <button className="email-inline-action" onClick={sendCurrentEmailCode} disabled={emailPending || emailCooldown > 0}><RotateCw size={14} />{emailCooldown > 0 ? `${emailCooldown} 秒后可重发` : "重新发送当前邮箱验证码"}</button>
              </div>
            )}

            {emailStep === "new" && (
              <div className="email-change-stage">
                <label><span>新邮箱验证码</span><div><ShieldCheck size={16} /><input value={newCode} onChange={(event) => setNewCode(event.target.value.replace(/\D/g, "").slice(0, 6))} inputMode="numeric" autoComplete="one-time-code" placeholder="6 位验证码" autoFocus /></div></label>
                <button onClick={confirmNewEmail} disabled={emailPending || newCode.length !== 6}>{emailPending ? "正在更新…" : "确认更换邮箱"}</button>
                <button className="email-inline-action" onClick={() => { setEmailStep("prepare"); setCurrentCode(""); setNewCode(""); setEmailMessage(""); setEmailError(""); }}><RotateCw size={14} />重新开始</button>
              </div>
            )}
          </div>
        )}
        {emailMessage && <p className="security-message"><Check size={15} />{emailMessage}</p>}
        {emailError && <p className="security-message error" role="alert">{emailError}</p>}
      </section>
      <section className="security-card-main password-security-card">
        <div className="security-card-title">
          <span><LockKeyhole size={22} /></span>
          <div><h2>登录密码</h2><p>{hasPassword ? "可以修改密码，或在 Passkey 可用后关闭密码登录。" : "密码登录已关闭，当前账户仅使用 Passkey 登录。"}</p></div>
          {hasPassword && <div className="security-card-actions">
            {passwordOpen || passwordDeleteOpen ? <button className="security-quiet-button" onClick={() => { closePasswordFlow(); closeDeletePassword(); }}><X size={15} />取消</button> : <>
              <button onClick={() => { setPasswordOpen(true); setPasswordError(""); setPasswordMessage(""); }}>修改密码</button>
              {items.length > 0 && <button className="danger" onClick={() => { setPasswordDeleteOpen(true); setPasswordOpen(false); setPasswordError(""); setPasswordMessage(""); }}><Trash2 size={15} />删除密码登录</button>}
            </>}
          </div>}
        </div>
        {passwordOpen && <div className="password-change-flow">
          <div className="password-change-form">
            <label><span>当前密码</span><div><LockKeyhole size={16} /><input type="password" value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} minLength={10} maxLength={128} autoComplete="current-password" autoFocus /></div></label>
            <label><span>新密码</span><div><KeyRound size={16} /><input type="password" value={newPassword} onChange={(event) => setNewPassword(event.target.value)} minLength={10} maxLength={128} autoComplete="new-password" placeholder="至少 10 位" /></div></label>
            <label><span>确认新密码</span><div><KeyRound size={16} /><input type="password" value={passwordConfirmation} onChange={(event) => setPasswordConfirmation(event.target.value)} minLength={10} maxLength={128} autoComplete="new-password" /></div></label>
            <button onClick={changePassword} disabled={passwordPending || !currentPassword || !newPassword || !passwordConfirmation}>{passwordPending ? "正在更新…" : "确认修改密码"}</button>
          </div>
        </div>}
        {passwordDeleteOpen && <div className="password-change-flow">
          <div className="password-delete-confirmation">
            <div><strong>确认删除密码登录</strong><p>删除后只能使用 Passkey 登录。为确认是你本人，请输入当前密码。</p></div>
            <label><span>当前密码</span><div><LockKeyhole size={16} /><input type="password" value={deletePassword} onChange={(event) => setDeletePassword(event.target.value)} minLength={10} maxLength={128} autoComplete="current-password" autoFocus /></div></label>
            <button onClick={removePasswordLogin} disabled={deletePasswordPending || deletePassword.length < 10 || !items.length}>{deletePasswordPending ? "正在删除…" : items.length ? "确认删除密码登录" : "请先添加 Passkey"}</button>
          </div>
        </div>}
        {passwordMessage && <p className="security-message"><Check size={15} />{passwordMessage}</p>}
        {passwordError && <p className="security-message error" role="alert">{passwordError}</p>}
      </section>
      <section className="security-card-main">
        <div className="security-card-title"><span><Fingerprint size={23} /></span><div><h2>Passkey</h2><p>用当前设备的 Touch ID、Face ID、Windows Hello 或设备密码快速登录。</p></div><button onClick={addPasskey} disabled={pending}><Plus size={17} />{pending ? "等待系统验证…" : "添加 Passkey"}</button></div>
        <div className="passkey-list">
          {items.length ? items.map((item) => {
            const isOnlyLoginMethod = !hasPassword && items.length === 1;
            return <article key={item.id}><span><Laptop size={19} /></span><div><strong>{item.name || "Passkey"}</strong><small>{item.deviceType === "multiDevice" ? "可同步设备" : "当前设备"}{item.createdAt ? ` · ${new Date(item.createdAt).toLocaleDateString("zh-CN")}` : ""}{isOnlyLoginMethod ? " · 唯一登录方式" : ""}</small></div><button aria-label={isOnlyLoginMethod ? "无法删除唯一的 Passkey" : "删除 Passkey"} title={isOnlyLoginMethod ? "请先恢复密码登录或添加另一个 Passkey" : "删除 Passkey"} onClick={() => removePasskey(item.id)} disabled={pending || isOnlyLoginMethod}><Trash2 size={17} /></button></article>;
          }) : <div className="passkey-empty"><KeyRound size={22} /><div><strong>还没有 Passkey</strong><p>添加后，你可以不输入密码直接登录。</p></div></div>}
        </div>
        {message && <p className="security-message"><Check size={15} />{message}</p>}
      </section>
    </div>
  </main>;
}

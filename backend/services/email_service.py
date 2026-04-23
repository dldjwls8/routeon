"""
루트온 이메일 발송 서비스
Gmail SMTP + aiosmtplib (비동기)

.env 필수 항목:
  SMTP_EMAIL    = routeon@gmail.com
  SMTP_PASSWORD = 앱비밀번호 (Gmail 2단계 인증 후 발급)
"""

import os
import aiosmtplib
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart

SMTP_HOST     = "smtp.gmail.com"
SMTP_PORT     = 587
SMTP_EMAIL    = os.getenv("SMTP_EMAIL", "")
SMTP_PASSWORD = os.getenv("SMTP_PASSWORD", "")
FROM_NAME     = "루트온(RouteOn)"


async def _send(to_email: str, subject: str, html_body: str) -> bool:
    """내부 발송 함수. 실패 시 False 반환 (앱 중단 없이)"""
    if not SMTP_EMAIL or not SMTP_PASSWORD:
        print(f"[Email] SMTP 설정 없음 — 발송 건너뜀 (수신: {to_email})")
        return False
    try:
        msg = MIMEMultipart("alternative")
        msg["Subject"] = subject
        msg["From"]    = f"{FROM_NAME} <{SMTP_EMAIL}>"
        msg["To"]      = to_email
        msg.attach(MIMEText(html_body, "html", "utf-8"))

        await aiosmtplib.send(
            msg,
            hostname  = SMTP_HOST,
            port      = SMTP_PORT,
            username  = SMTP_EMAIL,
            password  = SMTP_PASSWORD,
            start_tls = True,
        )
        print(f"[Email] 발송 완료 → {to_email} / {subject}")
        return True
    except Exception as e:
        print(f"[Email] 발송 실패 → {to_email} / 오류: {e}")
        return False


# ── 템플릿 ──────────────────────────────────────────

def _base_template(title: str, body: str) -> str:
    return f"""
    <div style="font-family:'Apple SD Gothic Neo',sans-serif; max-width:560px; margin:0 auto;
                background:#fff; border:1px solid #e5e7eb; border-radius:8px; overflow:hidden;">
      <div style="background:#111; padding:24px 32px;">
        <span style="color:#FFE812; font-size:20px; font-weight:900; letter-spacing:-0.02em;">RouteOn</span>
      </div>
      <div style="padding:32px;">
        <h2 style="margin:0 0 16px; font-size:20px; color:#111; letter-spacing:-0.01em;">{title}</h2>
        {body}
      </div>
      <div style="padding:16px 32px; background:#f9fafb; border-top:1px solid #e5e7eb;
                  font-size:12px; color:#9ca3af;">
        이 메일은 루트온 서비스에서 자동 발송된 메일입니다.
      </div>
    </div>
    """


async def send_approved(to_email: str, org_name: str, org_code: str):
    """기업 승인 완료 이메일"""
    body = f"""
    <p style="color:#374151; line-height:1.7; margin:0 0 20px;">
      안녕하세요.<br>
      <strong>{org_name}</strong>의 기업 등록 신청이 <strong style="color:#22c55e;">승인</strong>되었습니다. 🎉
    </p>
    <div style="background:#f0fdf4; border:1px solid #bbf7d0; border-radius:6px;
                padding:16px 20px; margin-bottom:24px;">
      <div style="font-size:12px; color:#16a34a; margin-bottom:6px; font-weight:600;">
        📋 기사 가입용 조직코드
      </div>
      <div style="font-size:28px; font-weight:900; color:#111; letter-spacing:0.08em;
                  font-family:monospace;">
        {org_code}
      </div>
    </div>
    <p style="color:#6b7280; font-size:14px; line-height:1.7; margin:0 0 20px;">
      이 조직코드를 기사님들에게 공유해주세요.<br>
      기사님들은 앱에서 해당 코드를 입력하여 가입할 수 있습니다.
    </p>
    <a href="http://168.138.45.63:3000/login.html"
       style="display:inline-block; background:#FFE812; color:#111; font-weight:700;
              padding:12px 28px; border-radius:6px; text-decoration:none; font-size:14px;">
      대시보드 바로가기 →
    </a>
    """
    await _send(
        to_email = to_email,
        subject  = f"[루트온] {org_name} 기업 등록 승인 완료",
        html_body = _base_template("기업 등록이 승인되었습니다", body),
    )


async def send_rejected(to_email: str, org_name: str, reason: str):
    """기업 반려 이메일"""
    body = f"""
    <p style="color:#374151; line-height:1.7; margin:0 0 20px;">
      안녕하세요.<br>
      <strong>{org_name}</strong>의 기업 등록 신청이 <strong style="color:#ef4444;">반려</strong>되었습니다.
    </p>
    <div style="background:#fef2f2; border:1px solid #fecaca; border-radius:6px;
                padding:16px 20px; margin-bottom:24px;">
      <div style="font-size:12px; color:#dc2626; margin-bottom:6px; font-weight:600;">
        반려 사유
      </div>
      <div style="font-size:14px; color:#374151; line-height:1.6;">
        {reason}
      </div>
    </div>
    <p style="color:#6b7280; font-size:14px; line-height:1.7; margin:0;">
      서류를 보완하신 후 다시 등록 신청해 주시기 바랍니다.<br>
      문의사항은 루트온 고객센터로 연락해주세요.
    </p>
    """
    await _send(
        to_email  = to_email,
        subject   = f"[루트온] {org_name} 기업 등록 반려 안내",
        html_body = _base_template("기업 등록 신청이 반려되었습니다", body),
    )